import { randomUUID } from 'node:crypto'
import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ModelProvider, ProviderModel } from '../shared/contracts.js'
import { buildProviderRuntime, type ProviderRuntimeConfig } from './provider-runtime.js'

const PROVIDERS_FILE = 'providers.json'
const PROVIDER_SECRETS_FILE = 'provider-secrets.json'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_API_FORMAT = 'Chat completions (/chat/completions)'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_CONTEXT = '1M'

interface ProviderSecretsFile {
  version: 1
  keys: Record<string, string>
}

interface ProviderReadResult {
  providers: ModelProvider[]
  hadPlaintextSecrets: boolean
}

function defaultProvider(): ModelProvider {
  const model = process.env.ND_DSH_MODEL?.trim() || DEFAULT_MODEL
  return {
    id: 'deepseek',
    name: 'DeepSeek',
    enabled: true,
    baseUrl: process.env.ND_DSH_BASE_URL?.trim() || DEFAULT_BASE_URL,
    apiFormat: DEFAULT_API_FORMAT,
    apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? '',
    models: [{ id: model, context: DEFAULT_CONTEXT }],
  }
}

function sanitizeProvider(value: unknown): ModelProvider | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!id || !name) return undefined
  const models = Array.isArray(record.models)
    ? record.models
        .map((model): ProviderModel | undefined => {
          if (!model || typeof model !== 'object') return undefined
          const entry = model as Record<string, unknown>
          const modelId = typeof entry.id === 'string' ? entry.id.trim() : ''
          if (!modelId) return undefined
          return { id: modelId, context: typeof entry.context === 'string' ? entry.context : DEFAULT_CONTEXT }
        })
        .filter((model): model is ProviderModel => model !== undefined)
    : []
  return {
    id,
    name,
    enabled: record.enabled !== false,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : '',
    apiFormat: typeof record.apiFormat === 'string' ? record.apiFormat : DEFAULT_API_FORMAT,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    models,
  }
}

function cloneProviders(providers: ModelProvider[]): ModelProvider[] {
  return structuredClone(providers)
}

/**
 * Provider metadata lives in userData/providers.json, but API keys do not.
 * Keys are encrypted with Electron safeStorage into provider-secrets.json.
 * On Linux we deliberately refuse safeStorage's `basic_text` fallback: when
 * no real desktop keyring is available the key stays memory-only rather than
 * being written with a known plaintext encryption password.
 *
 * ProviderStore is the ND control plane. It does not expose vendor-specific
 * runtime configuration to the renderer; `runtimeConfig()` compiles the stored
 * providers into the Harness adapter routes used for the next runtime launch.
 *
 * This store must be constructed after `app.whenReady()` so safeStorage can
 * correctly report its operating-system encryption backend.
 */
export class ProviderStore {
  private readonly filePath: string
  private readonly secretsPath: string
  private providers: ModelProvider[]
  private revisionValue = 0

  constructor() {
    if (!app.isReady()) throw new Error('ProviderStore must be created after the Electron app is ready')
    this.filePath = join(app.getPath('userData'), PROVIDERS_FILE)
    this.secretsPath = join(app.getPath('userData'), PROVIDER_SECRETS_FILE)
    const loaded = this.readProviders()
    this.providers = this.hydrateSecrets(loaded.providers)

    // Migrate older ND-DSH builds that persisted apiKey directly inside
    // providers.json. The current process keeps the value in memory, then the
    // rewrite removes plaintext from metadata and encrypts it when possible.
    if (loaded.hadPlaintextSecrets) this.persist()
  }

  list(): ModelProvider[] {
    return cloneProviders(this.providers)
  }

  save(value: unknown): ModelProvider[] {
    const sanitized = Array.isArray(value) ? value.map(sanitizeProvider).filter((p): p is ModelProvider => p !== undefined) : []
    this.providers = sanitized.length > 0 ? sanitized : [defaultProvider()]
    this.revisionValue += 1
    this.persist()
    return this.list()
  }

  /** Incremented whenever the ND provider configuration changes in this process. */
  revision(): number {
    return this.revisionValue
  }

  /** Compile all enabled providers into provider-neutral Harness runtime routes. */
  runtimeConfig(): ProviderRuntimeConfig {
    return buildProviderRuntime(this.providers)
  }

  /** The first enabled provider, used for status/UI summaries. */
  enabled(): ModelProvider | undefined {
    return cloneProviders(this.providers).find((provider) => provider.enabled)
  }

  private readProviders(): ProviderReadResult {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      const hadPlaintextSecrets = Array.isArray(parsed) && parsed.some((value) => {
        if (!value || typeof value !== 'object') return false
        const apiKey = (value as Record<string, unknown>).apiKey
        return typeof apiKey === 'string' && apiKey.trim().length > 0
      })
      const sanitized = Array.isArray(parsed) ? parsed.map(sanitizeProvider).filter((p): p is ModelProvider => p !== undefined) : []
      if (sanitized.length > 0) return { providers: sanitized, hadPlaintextSecrets }
    } catch {
      // Missing or unreadable metadata falls back to the default provider.
    }
    return { providers: [defaultProvider()], hadPlaintextSecrets: false }
  }

  private hydrateSecrets(providers: ModelProvider[]): ModelProvider[] {
    const secrets = this.readSecureSecrets()
    const environmentKey = process.env.DEEPSEEK_API_KEY?.trim() ?? ''
    return providers.map((provider) => ({
      ...provider,
      apiKey: secrets[provider.id] ?? provider.apiKey ?? (provider.id === 'deepseek' ? environmentKey : ''),
    })).map((provider) => ({
      ...provider,
      apiKey: provider.apiKey || (provider.id === 'deepseek' ? environmentKey : ''),
    }))
  }

  private readSecureSecrets(): Record<string, string> {
    if (!this.canPersistSecrets()) return {}
    try {
      const parsed = JSON.parse(readFileSync(this.secretsPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return {}
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || !record.keys || typeof record.keys !== 'object') return {}
      const decrypted: Record<string, string> = {}
      for (const [providerId, encoded] of Object.entries(record.keys as Record<string, unknown>)) {
        if (typeof encoded !== 'string' || !encoded) continue
        try {
          decrypted[providerId] = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
        } catch (error) {
          console.warn(`Could not decrypt API key for provider ${providerId}:`, error)
        }
      }
      return decrypted
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Failed to read encrypted provider secrets:', error)
      return {}
    }
  }

  private persist(): void {
    try {
      const metadata = this.providers.map(({ apiKey: _apiKey, ...provider }) => provider)
      writeJsonAtomic(this.filePath, metadata)
    } catch (error) {
      console.warn('Failed to persist model providers:', error)
      return
    }

    if (!this.canPersistSecrets()) {
      if (this.providers.some((provider) => provider.apiKey.trim())) {
        console.warn('OS-backed secure storage is unavailable; provider API keys will remain memory-only for this app session.')
      }
      return
    }

    try {
      const keys: Record<string, string> = {}
      for (const provider of this.providers) {
        const apiKey = provider.apiKey.trim()
        if (!apiKey) continue
        keys[provider.id] = safeStorage.encryptString(apiKey).toString('base64')
      }
      const payload: ProviderSecretsFile = { version: 1, keys }
      writeJsonAtomic(this.secretsPath, payload)
    } catch (error) {
      console.warn('Failed to persist encrypted provider secrets:', error)
    }
  }

  private canPersistSecrets(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}
