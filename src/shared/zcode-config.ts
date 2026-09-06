/**
 * ZCode CLI model-provider configuration contract.
 *
 * The ZCode CLI fails a session with `ModelConfigMissing` when
 * `~/.zcode/cli/config.json` does not resolve an explicit model provider.
 * ND owns a narrow IPC surface that reads and writes exactly the
 * model-provider slice of that file (see
 * `src/main/engines/zcode/zcode-config.ts`); every other key the user or the
 * CLI maintains (`plugins`, `skills`, `mcp`, …) is preserved untouched.
 *
 * The shapes below mirror the schema the ZCode CLI validates itself:
 * - `model` is a `provider/model` reference string, or `{ main, lite }`.
 * - `provider` is a record keyed by provider id. Each entry carries `kind`
 *   (`anthropic` | `openai` | `openai-compatible`), an `options` block with
 *   `baseURL`/`apiKey`, and a `models` record. Provider packages (`npm`) are
 *   explicitly unsupported by ZCode, so ND never writes them.
 */

export const ZCODE_PROVIDER_KINDS = ['anthropic', 'openai', 'openai-compatible'] as const
export type ZcodeProviderKind = (typeof ZCODE_PROVIDER_KINDS)[number]

/** One model row on a provider, as edited in the ND dialog. */
export interface ZcodeProviderModelSpec {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoning?: boolean
  toolCall?: boolean
}

/**
 * A provider as the renderer submits it. An omitted `apiKey` keeps whatever
 * credential the existing config already holds for that provider id;
 * `clearApiKey: true` removes it. Secrets travel only renderer → main.
 */
export interface ZcodeProviderUpdate {
  id: string
  kind: ZcodeProviderKind
  name?: string
  baseURL?: string
  apiKey?: string
  clearApiKey?: boolean
  models: ZcodeProviderModelSpec[]
}

/** A provider as ND renders it back: never carries the API key itself. */
export interface ZcodeProviderView {
  id: string
  kind?: ZcodeProviderKind
  name?: string
  baseURL?: string
  /** Whether the existing config holds an API key for this provider. */
  apiKeySet: boolean
  /** Masked hint like `sk-…f4a2`, present only when a key is stored. */
  apiKeyHint?: string
  models: ZcodeProviderModelSpec[]
}

export interface ZcodeCliConfigUpdate {
  providers: ZcodeProviderUpdate[]
  /** Default model reference (`provider/model`); required when the config must become runnable. */
  mainModel?: string
  liteModel?: string
}

export interface ZcodeCliConfigSnapshot {
  /** Absolute path of the config file on this machine. */
  path: string
  exists: boolean
  mainModel?: string
  liteModel?: string
  providers: ZcodeProviderView[]
  /** Present when the file exists but is not valid JSON; ND never rewrites such a file. */
  parseError?: string
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const MODEL_ID_PATTERN = /^\S{1,128}$/

/** Parse a `provider/model` reference; ZCode rejects anything else. */
export function parseModelReference(value: string | undefined): { provider: string; model: string } | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return undefined
  const provider = trimmed.slice(0, separator)
  const model = trimmed.slice(separator + 1)
  if (!PROVIDER_ID_PATTERN.test(provider) || !MODEL_ID_PATTERN.test(model)) return undefined
  return { provider, model }
}

export function formatModelReference(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function validateModelSpec(model: ZcodeProviderModelSpec, providerId: string, problems: string[]): void {
  if (typeof model.id !== 'string' || !MODEL_ID_PATTERN.test(model.id.trim())) {
    problems.push(`Provider "${providerId}" has a model row without a usable id`)
    return
  }
  if (model.contextWindow !== undefined && !isPositiveInt(model.contextWindow)) {
    problems.push(`Provider "${providerId}" model "${model.id}" has an invalid context window`)
  }
  if (model.maxOutputTokens !== undefined && !isPositiveInt(model.maxOutputTokens)) {
    problems.push(`Provider "${providerId}" model "${model.id}" has an invalid max output token count`)
  }
  for (const key of ['name'] as const) {
    const value = model[key]
    if (value !== undefined && typeof value !== 'string') {
      problems.push(`Provider "${providerId}" model "${model.id}" has an invalid ${key}`)
    }
  }
}

function validateHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Validate an update before it reaches disk. Returns human-readable problems;
 * an empty list means the update is writable. Main process is authoritative;
 * the dialog runs the same check for inline feedback.
 */
export function validateZcodeCliConfigUpdate(update: ZcodeCliConfigUpdate): string[] {
  const problems: string[] = []
  if (!isRecord(update) || !Array.isArray(update.providers)) {
    return ['The provider list is required']
  }
  if (update.providers.length > 32) problems.push('At most 32 providers are supported')

  const ids = new Set<string>()
  for (const provider of update.providers) {
    if (!isRecord(provider)) {
      problems.push('Every provider entry must be an object')
      continue
    }
    if (typeof provider.id !== 'string' || !PROVIDER_ID_PATTERN.test(provider.id)) {
      problems.push(`Provider id "${String(provider.id)}" must be short letters/digits/dots/dashes without slashes or spaces`)
      continue
    }
    if (ids.has(provider.id)) problems.push(`Provider id "${provider.id}" is duplicated`)
    ids.add(provider.id)
    if (!ZCODE_PROVIDER_KINDS.includes(provider.kind)) {
      problems.push(`Provider "${provider.id}" must have kind one of: ${ZCODE_PROVIDER_KINDS.join(', ')}`)
    }
    if (provider.name !== undefined && (typeof provider.name !== 'string' || provider.name.length > 128)) {
      problems.push(`Provider "${provider.id}" has an invalid display name`)
    }
    if (provider.baseURL !== undefined && (typeof provider.baseURL !== 'string' || !validateHttpUrl(provider.baseURL))) {
      problems.push(`Provider "${provider.id}" Base URL must be an http(s) URL`)
    }
    if (provider.apiKey !== undefined && (typeof provider.apiKey !== 'string' || provider.apiKey.length > 8192)) {
      problems.push(`Provider "${provider.id}" has an invalid API key`)
    }
    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      problems.push(`Provider "${provider.id}" needs at least one model`)
      continue
    }
    if (provider.models.length > 128) problems.push(`Provider "${provider.id}" has too many models`)
    const modelIds = new Set<string>()
    for (const model of provider.models) {
      if (!isRecord(model)) {
        problems.push(`Provider "${provider.id}" has an invalid model row`)
        continue
      }
      if (typeof model.id !== 'string' || modelIds.has(model.id)) {
        problems.push(`Provider "${provider.id}" has a missing or duplicate model id`)
        continue
      }
      modelIds.add(model.id)
      validateModelSpec(model as ZcodeProviderModelSpec, provider.id, problems)
    }
  }

  const main = parseModelReference(update.mainModel)
  if (update.mainModel !== undefined && !main) {
    problems.push('Default model must be a provider/model reference')
  } else if (main && !ids.has(main.provider)) {
    problems.push(`Default model references unknown provider "${main.provider}"`)
  }
  const lite = parseModelReference(update.liteModel)
  if (update.liteModel !== undefined && !lite) {
    problems.push('Lite model must be a provider/model reference')
  } else if (lite && !ids.has(lite.provider)) {
    problems.push(`Lite model references unknown provider "${lite.provider}"`)
  }
  return problems
}

/** Masked hint for a stored key; never returns more than the last four characters. */
export function maskApiKey(apiKey: string): string {
  const clean = apiKey.trim()
  if (!clean) return ''
  const prefix = clean.startsWith('sk-') ? 'sk-…' : '…'
  return `${prefix}${clean.slice(-4)}`
}
