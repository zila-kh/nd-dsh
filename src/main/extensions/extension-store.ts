import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import {
  AGENT_EXTENSION_SURFACES,
  EXTENSION_ADAPTERS,
  cloneBuiltinExtensionDemos,
  type AgentExtensionManifest,
  type AgentExtensionSurface,
  type ExtensionAdapter,
} from '../../shared/extensions.js'

interface ExtensionSnapshot {
  version: 1
  extensions: AgentExtensionManifest[]
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/

/**
 * Durable ND-owned extension catalog. Built-in demos are seeded on first run,
 * while user-created manifests and routing overrides survive app restarts.
 * The renderer never writes this file directly.
 */
export class ExtensionStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: ExtensionSnapshot = { version: 1, extensions: cloneBuiltinExtensionDemos() }
  private onChanged: ((extensions: AgentExtensionManifest[]) => void) | undefined

  constructor(private readonly filePath: string) {}

  setOnChanged(listener: ((extensions: AgentExtensionManifest[]) => void) | undefined): void {
    this.onChanged = listener
  }

  async list(): Promise<AgentExtensionManifest[]> {
    await this.load()
    return structuredClone(this.value.extensions)
  }

  async get(id: string): Promise<AgentExtensionManifest | undefined> {
    return (await this.list()).find((item) => item.id === id)
  }

  async save(manifest: AgentExtensionManifest): Promise<AgentExtensionManifest[]> {
    await this.load()
    const next = sanitizeManifest(manifest)
    const existingIndex = this.value.extensions.findIndex((item) => item.id === next.id)
    if (existingIndex >= 0) {
      const existing = this.value.extensions[existingIndex]!
      // Built-in demo identity/content is product-owned; users may change only
      // enablement and route policy so reset/migration remains deterministic.
      this.value.extensions[existingIndex] = existing.builtInDemo
        ? {
            ...existing,
            enabled: next.enabled,
            engineRoutes: next.engineRoutes,
            providerRoutes: next.providerRoutes,
          }
        : next
    } else {
      if (next.builtInDemo) throw new Error('Only ND may create built-in demo extensions')
      this.value.extensions.push(next)
    }
    await this.persistAndEmit()
    return this.list()
  }

  async remove(id: string): Promise<AgentExtensionManifest[]> {
    await this.load()
    const normalized = asId(id)
    const existing = this.value.extensions.find((item) => item.id === normalized)
    if (!existing) return this.list()
    if (existing.builtInDemo) throw new Error('Built-in demo extensions cannot be deleted; disable them or reset the demo pack')
    this.value.extensions = this.value.extensions.filter((item) => item.id !== normalized)
    await this.persistAndEmit()
    return this.list()
  }

  async resetDemos(): Promise<AgentExtensionManifest[]> {
    await this.load()
    const custom = this.value.extensions.filter((item) => !item.builtInDemo)
    this.value.extensions = [...cloneBuiltinExtensionDemos(), ...custom]
    await this.persistAndEmit()
    return this.list()
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.loadFromDisk().finally(() => { this.loadPromise = undefined })
    return this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') throw new Error('extension catalog is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || !Array.isArray(record.extensions)) throw new Error('extension catalog has an unsupported schema')
      const loaded = record.extensions.flatMap((item) => {
        try { return [sanitizeManifest(item as AgentExtensionManifest)] } catch { return [] }
      })
      this.value = { version: 1, extensions: mergeBuiltinDemos(loaded) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable extension catalog; restoring built-in demos:', error)
      }
      this.value = { version: 1, extensions: cloneBuiltinExtensionDemos() }
    }
    this.loaded = true
  }

  private async persistAndEmit(): Promise<void> {
    await this.save()
    this.onChanged?.(await this.list())
  }

  private async save(): Promise<void> {
    const snapshot = structuredClone(this.value)
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    const write = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, serialized, 'utf8')
        await fs.rename(temp, this.filePath)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    })
    this.saveChain = write
    return write
  }
}

function mergeBuiltinDemos(loaded: AgentExtensionManifest[]): AgentExtensionManifest[] {
  const byId = new Map(loaded.map((item) => [item.id, item]))
  const demos = cloneBuiltinExtensionDemos().map((demo) => {
    const saved = byId.get(demo.id)
    if (!saved) return demo
    byId.delete(demo.id)
    return {
      ...demo,
      enabled: saved.enabled,
      engineRoutes: saved.engineRoutes,
      providerRoutes: saved.providerRoutes,
    }
  })
  return [...demos, ...[...byId.values()].filter((item) => !item.builtInDemo)]
}

function sanitizeManifest(value: AgentExtensionManifest): AgentExtensionManifest {
  if (!value || typeof value !== 'object') throw new Error('Extension manifest is required')
  const surface = asSurface(value.surface)
  const version = text(value.version, 'Version', 64)
  const description = text(value.description, 'Description', 4_000)
  const name = text(value.name, 'Name', 256)
  const id = asId(value.id)
  const engineRoutes = Array.isArray(value.engineRoutes)
    ? dedupeEngineRoutes(value.engineRoutes.flatMap((route) => {
        if (!route || typeof route !== 'object') return []
        const engineId = typeof route.engineId === 'string' ? route.engineId.trim().slice(0, 256) : ''
        if (!engineId) return []
        const adapter = asAdapter(route.adapter)
        return adapter === 'auto' ? [] : [{ engineId, adapter }]
      }))
    : []
  const providerRoutes = Array.isArray(value.providerRoutes)
    ? dedupeProviderRoutes(value.providerRoutes.flatMap((route) => {
        if (!route || typeof route !== 'object' || typeof route.providerId !== 'string' || !route.providerId.trim()) return []
        return [{ providerId: route.providerId.trim().slice(0, 256), enabled: route.enabled === true }]
      }))
    : []
  return {
    id,
    name,
    description,
    surface,
    version,
    enabled: value.enabled === true,
    ...(value.builtInDemo === true ? { builtInDemo: true } : {}),
    ...(typeof value.demoPrompt === 'string' && value.demoPrompt.trim() ? { demoPrompt: value.demoPrompt.trim().slice(0, 4_000) } : {}),
    ...(typeof value.instructions === 'string' && value.instructions.trim() ? { instructions: value.instructions.trim().slice(0, 16_000) } : {}),
    engineRoutes,
    providerRoutes,
  }
}

function dedupeEngineRoutes(routes: Array<{ engineId: string; adapter: ExtensionAdapter }>): Array<{ engineId: string; adapter: ExtensionAdapter }> {
  const out = new Map<string, ExtensionAdapter>()
  for (const route of routes) out.set(route.engineId, route.adapter)
  return [...out.entries()].map(([engineId, adapter]) => ({ engineId, adapter }))
}

function dedupeProviderRoutes(routes: Array<{ providerId: string; enabled: boolean }>): Array<{ providerId: string; enabled: boolean }> {
  const out = new Map<string, boolean>()
  for (const route of routes) out.set(route.providerId, route.enabled)
  return [...out.entries()].map(([providerId, enabled]) => ({ providerId, enabled }))
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value.trim())) throw new Error('Extension id must use lowercase letters, numbers, dots, dashes, or underscores')
  return value.trim()
}

function asSurface(value: unknown): AgentExtensionSurface {
  if (typeof value !== 'string' || !AGENT_EXTENSION_SURFACES.includes(value as AgentExtensionSurface)) throw new Error('Unknown extension surface')
  return value as AgentExtensionSurface
}

function asAdapter(value: unknown): ExtensionAdapter {
  if (typeof value !== 'string' || !EXTENSION_ADAPTERS.includes(value as ExtensionAdapter)) throw new Error('Unknown extension adapter')
  return value as ExtensionAdapter
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`)
  return value.trim().slice(0, max)
}
