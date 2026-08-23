import { createHash } from 'node:crypto'
import type { ModelProvider } from '../shared/contracts.js'

export type HarnessProviderProtocol = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export interface HarnessPiAiModelProfile {
  id: string
  contextWindow?: number
}

export interface HarnessPiAiProviderProfile {
  displayName: string
  apiKeyEnv?: string
  api?: HarnessProviderProtocol
  baseURL?: string
  models?: HarnessPiAiModelProfile[]
}

export interface ProviderRuntimeConfig {
  /** Provider profiles owned by Harness's generic pi-ai adapter. */
  profiles: Record<string, HarnessPiAiProviderProfile>
  /** Ephemeral process environment. Secrets never enter the profile JSON. */
  environment: Record<string, string>
  /** Route/model used by newly-created sessions. */
  defaultProvider?: string
  defaultModel?: string
}

/** The Harness native DeepSeek route key; ND's `deepseek` provider compiles to it. */
export const DIRECT_DEEPSEEK_ROUTE = 'deepseek-official'

/**
 * Compile ND provider settings into the runtime-neutral facts Harness needs.
 *
 * DeepSeek remains on Harness's native adapter for beta compatibility. Every
 * additional enabled provider is compiled into the generic pi-ai adapter,
 * whose route key is the ND provider id. That keeps the ND domain independent
 * from one vendor while preserving the already-tested DeepSeek execution path.
 */
export function buildProviderRuntime(providers: readonly ModelProvider[]): ProviderRuntimeConfig {
  const profiles: Record<string, HarnessPiAiProviderProfile> = {}
  const environment: Record<string, string> = {}
  let defaultProvider: string | undefined
  let defaultModel: string | undefined

  for (const provider of providers) {
    if (!provider.enabled) continue
    const route = provider.id.trim()
    if (!route) continue

    const model = provider.models.find((item) => item.id.trim())?.id.trim()
    if (defaultProvider === undefined && model) {
      defaultProvider = route === 'deepseek' ? DIRECT_DEEPSEEK_ROUTE : route
      defaultModel = model
    }

    const apiKey = provider.apiKey.trim()
    if (route === 'deepseek') {
      // Compatibility driver: Harness's native DeepSeek adapter remains the
      // owner of deepseek-official while ND's other routes use pi-ai.
      if (apiKey) environment.DEEPSEEK_API_KEY = apiKey
      const baseURL = normalizeBaseUrl(provider.baseUrl, route)
      if (baseURL) environment.DEEPSEEK_BASE_URL = baseURL
      continue
    }

    if (profiles[route]) throw new Error(`Duplicate enabled provider id: ${route}`)
    const keyEnv = apiKey ? providerCredentialEnvName(route) : undefined
    if (keyEnv) environment[keyEnv] = apiKey

    const protocol = protocolFromApiFormat(provider.apiFormat)
    const baseURL = normalizeBaseUrl(provider.baseUrl, route)
    const models = provider.models
      .map((item): HarnessPiAiModelProfile | undefined => {
        const id = item.id.trim()
        if (!id) return undefined
        const contextWindow = parseContextWindow(item.context)
        return { id, ...(contextWindow ? { contextWindow } : {}) }
      })
      .filter((item): item is HarnessPiAiModelProfile => item !== undefined)

    profiles[route] = {
      displayName: provider.name.trim() || route,
      ...(keyEnv ? { apiKeyEnv: keyEnv } : {}),
      ...(protocol ? { api: protocol } : {}),
      ...(baseURL ? { baseURL } : {}),
      ...(models.length ? { models } : {}),
    }
  }

  return {
    profiles,
    environment,
    ...(defaultProvider ? { defaultProvider } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  }
}

/** Stable, route-scoped environment key. The provider id itself never becomes an env variable name. */
export function providerCredentialEnvName(providerId: string): string {
  const digest = createHash('sha256').update(providerId).digest('hex').slice(0, 16).toUpperCase()
  return `ND_DSH_LLM_KEY_${digest}`
}

/** Map the renderer's friendly format label (and future raw protocol ids) to the Harness protocol. */
export function protocolFromApiFormat(value: string): HarnessProviderProtocol | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'auto' || normalized.includes('native') || normalized.includes('catalog')) return undefined
  if (normalized === 'anthropic-messages' || normalized.includes('anthropic')) return 'anthropic-messages'
  if (normalized === 'openai-responses' || normalized.includes('responses')) return 'openai-responses'
  if (
    normalized === 'openai-completions'
    || normalized.includes('chat/completions')
    || normalized.includes('chat completions')
    || normalized.includes('openai compatible')
  ) return 'openai-completions'
  throw new Error(`Unsupported provider API format: ${value}`)
}

/** Convert UI context labels such as 128K / 1M into Harness numeric metadata. */
export function parseContextWindow(value: string): number | undefined {
  const normalized = value.trim().replaceAll(',', '')
  if (!normalized) return undefined
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(normalized)
  if (!match) return undefined
  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const suffix = match[2]?.toLowerCase()
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1
  const result = Math.round(amount * multiplier)
  return Number.isSafeInteger(result) && result > 0 ? result : undefined
}

function normalizeBaseUrl(value: string, route: string): string | undefined {
  const text = value.trim()
  if (!text) return undefined
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error(`Provider ${route} base URL must be an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Provider ${route} base URL must use http or https`)
  }
  return parsed.toString().replace(/\/$/, '')
}
