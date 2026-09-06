import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  maskApiKey,
  validateZcodeCliConfigUpdate,
  ZCODE_PROVIDER_KINDS,
  type ZcodeCliConfigSnapshot,
  type ZcodeCliConfigUpdate,
  type ZcodeProviderKind,
  type ZcodeProviderModelSpec,
  type ZcodeProviderUpdate,
  type ZcodeProviderView,
} from '../../../shared/zcode-config.js'

/**
 * ND-owned read/modify/write access to the ZCode CLI's own
 * `~/.zcode/cli/config.json`. ZCode fails sessions with `ModelConfigMissing`
 * until that file resolves an explicit model provider, and hand-editing JSON
 * with an API key is exactly the kind of setup friction ND removes with its
 * provider dialog. The write path is deliberately conservative:
 *
 * - Only the `model` and `provider` keys are touched; every other key the
 *   user or the CLI maintains (`plugins`, `skills`, `mcp`, …) is carried over
 *   byte-for-byte from the parsed document.
 * - Unknown passthrough fields inside existing provider/model entries survive
 *   a write, so ND never flattens a hand-tuned config.
 * - Existing API keys are kept unless the update sets or clears them, and
 *   reads never return secrets to the renderer.
 * - A file that fails to parse is reported, never rewritten, and the previous
 *   content is backed up before the first ND write.
 */

const BACKUP_SUFFIX = '.nd-backup'

export function zcodeCliConfigPath(homeDir = homedir()): string {
  return join(homeDir, '.zcode', 'cli', 'config.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readProviderKind(value: unknown): ZcodeProviderKind | undefined {
  return ZCODE_PROVIDER_KINDS.find((kind) => kind === value)
}

function readModels(value: unknown): ZcodeProviderModelSpec[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([id, entry]) => {
    if (!isRecord(entry)) return []
    const model: ZcodeProviderModelSpec = { id }
    if (typeof entry.name === 'string' && entry.name.trim()) model.name = entry.name
    if (typeof entry.contextWindow === 'number' && Number.isInteger(entry.contextWindow) && entry.contextWindow > 0) {
      model.contextWindow = entry.contextWindow
    }
    if (typeof entry.maxOutputTokens === 'number' && Number.isInteger(entry.maxOutputTokens) && entry.maxOutputTokens > 0) {
      model.maxOutputTokens = entry.maxOutputTokens
    }
    if (typeof entry.reasoning === 'boolean') model.reasoning = entry.reasoning
    if (typeof entry.tool_call === 'boolean') model.toolCall = entry.tool_call
    return [model]
  })
}

function readProviderView(id: string, raw: Record<string, unknown>): ZcodeProviderView {
  const options = isRecord(raw.options) ? raw.options : {}
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : ''
  const kind = readProviderKind(raw.kind)
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : undefined
  const baseURL = typeof options.baseURL === 'string' && options.baseURL.trim() ? options.baseURL : undefined
  return {
    id,
    ...(kind !== undefined ? { kind } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(baseURL !== undefined ? { baseURL } : {}),
    apiKeySet: apiKey.length > 0,
    ...(apiKey ? { apiKeyHint: maskApiKey(apiKey) } : {}),
    models: readModels(raw.models),
  }
}

/** Read the current snapshot. A missing file is an empty snapshot, not an error. */
export async function readZcodeCliConfig(homeDir = homedir()): Promise<ZcodeCliConfigSnapshot> {
  const path = zcodeCliConfigPath(homeDir)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return { path, exists: false, providers: [] }
  }
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch (error) {
    return {
      path,
      exists: true,
      providers: [],
      parseError: error instanceof Error ? error.message : String(error),
    }
  }
  if (!isRecord(document)) {
    return { path, exists: true, providers: [], parseError: 'Config root must be a JSON object' }
  }
  const providers = Object.entries(isRecord(document.provider) ? document.provider : {})
    .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
    .map(([id, entry]) => readProviderView(id, entry))
  const model = document.model
  const mainModel = typeof model === 'string' ? model : isRecord(model) && typeof model.main === 'string' ? model.main : undefined
  const liteModel = isRecord(model) && typeof model.lite === 'string' ? model.lite : undefined
  return {
    path,
    exists: true,
    ...(mainModel !== undefined ? { mainModel } : {}),
    ...(liteModel !== undefined ? { liteModel } : {}),
    providers,
  }
}

function providerEntryFromUpdate(update: ZcodeProviderUpdate, existing: Record<string, unknown> | undefined): Record<string, unknown> {
  // Unknown passthrough fields on an existing entry survive; known fields are
  // owned by the update from here on.
  const entry: Record<string, unknown> = { ...(existing ?? {}) }
  entry.kind = update.kind
  if (update.name !== undefined && update.name.trim()) entry.name = update.name.trim()
  else delete entry.name

  const previousOptions = isRecord(existing?.options) ? existing.options : {}
  const options: Record<string, unknown> = { ...previousOptions }
  if (update.baseURL !== undefined && update.baseURL.trim()) options.baseURL = update.baseURL.trim()
  else delete options.baseURL
  if (typeof update.apiKey === 'string' && update.apiKey.trim()) options.apiKey = update.apiKey.trim()
  else if (update.clearApiKey === true) delete options.apiKey
  // An omitted apiKey keeps whatever credential the previous entry held.
  if (Object.keys(options).length > 0) entry.options = options
  else delete entry.options

  const previousModels = isRecord(existing?.models) ? existing.models : {}
  const models: Record<string, unknown> = {}
  for (const model of update.models) {
    // Unknown fields on a previously-known model row survive the rewrite.
    const priorRaw = previousModels[model.id]
    const record: Record<string, unknown> = isRecord(priorRaw) ? { ...priorRaw } : {}
    if (model.name !== undefined && model.name.trim()) record.name = model.name.trim()
    else delete record.name
    if (model.contextWindow !== undefined) record.contextWindow = model.contextWindow
    else delete record.contextWindow
    if (model.maxOutputTokens !== undefined) record.maxOutputTokens = model.maxOutputTokens
    else delete record.maxOutputTokens
    if (model.reasoning !== undefined) record.reasoning = model.reasoning
    else delete record.reasoning
    if (model.toolCall !== undefined) record.tool_call = model.toolCall
    else delete record.tool_call
    record.id = model.id
    models[model.id] = record
  }
  entry.models = models
  return entry
}

/**
 * Apply an update and return the fresh snapshot. Throws (leaving the file
 * untouched) when the update is invalid or the existing file does not parse.
 */
export async function writeZcodeCliConfig(update: ZcodeCliConfigUpdate, homeDir = homedir()): Promise<ZcodeCliConfigSnapshot> {
  const problems = validateZcodeCliConfigUpdate(update)
  if (problems.length > 0) throw new Error(problems[0])

  const path = zcodeCliConfigPath(homeDir)
  let document: Record<string, unknown> = {}
  let hadFile = false
  try {
    const raw = await readFile(path, 'utf8')
    hadFile = true
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) throw new Error('Config root must be a JSON object')
    document = parsed
  } catch (error) {
    if (hadFile) {
      // Never clobber a config ND cannot parse; the user may have hand-edits
      // in flight that ZCode itself would still accept.
      throw new Error(`The existing ZCode config could not be parsed and was left untouched: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const existingProviders = isRecord(document.provider) ? document.provider : {}
  const nextProviders: Record<string, unknown> = {}
  for (const provider of update.providers) {
    nextProviders[provider.id] = providerEntryFromUpdate(
      provider,
      isRecord(existingProviders[provider.id]) ? existingProviders[provider.id] as Record<string, unknown> : undefined,
    )
  }
  document.provider = nextProviders

  // `model` resolution: an unset default in the update preserves whatever the
  // config already resolves (clearing it would re-break a working ZCode); the
  // dialog always seeds from the snapshot, so an explicit change wins.
  const existingModel = document.model
  const existingMain = typeof existingModel === 'string'
    ? existingModel
    : isRecord(existingModel) && typeof existingModel.main === 'string' ? existingModel.main : undefined
  const existingLite = isRecord(existingModel) && typeof existingModel.lite === 'string' ? existingModel.lite : undefined
  const main = update.mainModel ?? existingMain
  const lite = update.liteModel ?? existingLite
  if (main !== undefined && lite !== undefined) {
    document.model = { main, lite }
  } else if (main !== undefined) {
    document.model = main
  }

  const serialized = `${JSON.stringify(document, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true })
  if (hadFile) {
    // One-generation backup: the previous content is the rollback path if the
    // merged result ever surprises the user.
    const previous = await readFile(path, 'utf8')
    await writeFile(`${path}${BACKUP_SUFFIX}`, previous, 'utf8')
  }
  const staging = `${path}.nd-staging-${process.pid}`
  await writeFile(staging, serialized, 'utf8')
  await rename(staging, path)
  return readZcodeCliConfig(homeDir)
}

/** Whether a config file is already present (used by tests and diagnostics). */
export function zcodeCliConfigExists(homeDir = homedir()): boolean {
  return existsSync(zcodeCliConfigPath(homeDir))
}
