import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelProvider, ProviderModel } from '../shared/contracts.js'

const PROVIDERS_FILE = 'providers.json'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_API_FORMAT = 'Chat completions (/chat/completions)'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_CONTEXT = '1M'

function defaultProvider(): ModelProvider {
  const model = process.env.ND_DSH_MODEL?.trim() || DEFAULT_MODEL
  return {
    id: 'deepseek',
    name: 'deepseek',
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
  return JSON.parse(JSON.stringify(providers)) as ModelProvider[]
}

/**
 * Persists the user's model providers to userData/providers.json. On first run
 * it seeds the real deepseek provider (defaults from the environment), and it
 * never allows an empty list — the agent needs at least one provider.
 */
export class ProviderStore {
  private readonly filePath: string
  private providers: ModelProvider[]

  constructor() {
    this.filePath = join(app.getPath('userData'), PROVIDERS_FILE)
    this.providers = this.read()
  }

  list(): ModelProvider[] {
    return cloneProviders(this.providers)
  }

  save(value: unknown): ModelProvider[] {
    const sanitized = Array.isArray(value) ? value.map(sanitizeProvider).filter((p): p is ModelProvider => p !== undefined) : []
    this.providers = sanitized.length > 0 ? sanitized : [defaultProvider()]
    this.persist()
    return this.list()
  }

  /** The first enabled provider, used to drive the Harness runtime. */
  enabled(): ModelProvider | undefined {
    return cloneProviders(this.providers).find((provider) => provider.enabled)
  }

  private read(): ModelProvider[] {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      const sanitized = Array.isArray(parsed) ? parsed.map(sanitizeProvider).filter((p): p is ModelProvider => p !== undefined) : []
      if (sanitized.length > 0) return sanitized
    } catch {
      // Missing or unreadable settings fall back to the default provider.
    }
    return [defaultProvider()]
  }

  private persist(): void {
    try {
      writeFileSync(this.filePath, `${JSON.stringify(this.providers, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn('Failed to persist model providers:', error)
    }
  }
}
