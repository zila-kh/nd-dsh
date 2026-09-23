import { randomUUID } from 'node:crypto'
import type { Extension, Session } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { BrowserExtensionRecord } from '../../shared/browser-platform.js'

interface PersistedExtension {
  path: string
  enabled: boolean
  installedAt: number
}

interface Snapshot {
  version: 1
  extensions: PersistedExtension[]
}

export class BrowserExtensionManager {
  private loaded = false
  private value: Snapshot = { version: 1, extensions: [] }
  private records = new Map<string, BrowserExtensionRecord>()
  private saveChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly browserSession: Session,
    private readonly filePath: string,
    private readonly onChanged: () => void,
  ) {}

  async initialize(): Promise<void> {
    await this.load()
    for (const item of this.value.extensions) {
      if (!item.enabled) {
        const manifest = await readManifest(item.path).catch(() => undefined)
        const id = persistedId(item.path)
        this.records.set(id, recordFromManifest(id, item.path, item.installedAt, false, manifest))
        continue
      }
      await this.loadOne(item).catch(() => undefined)
    }
    this.onChanged()
  }

  list(): BrowserExtensionRecord[] {
    return [...this.records.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((record) => structuredClone(record))
  }

  async install(path: string): Promise<BrowserExtensionRecord> {
    const extensionPath = resolve(path)
    const manifest = await readManifest(extensionPath)
    const existing = this.value.extensions.find((item) => item.path === extensionPath)
    const item: PersistedExtension = existing ?? { path: extensionPath, enabled: true, installedAt: Date.now() }
    item.enabled = true
    if (!existing) this.value.extensions.push(item)
    await this.persist()
    for (const [id, record] of [...this.records]) {
      if (record.path === extensionPath) this.records.delete(id)
    }
    const record = await this.loadOne(item, manifest)
    this.onChanged()
    return structuredClone(record)
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<BrowserExtensionRecord[]> {
    const record = this.records.get(extensionId)
    if (!record) throw new Error('Built-in browser extension not found')
    const item = this.value.extensions.find((candidate) => candidate.path === record.path)
    if (!item) throw new Error('Built-in browser extension persistence record is missing')

    if (enabled) {
      item.enabled = true
      await this.persist()
      this.records.delete(extensionId)
      await this.loadOne(item)
    } else {
      item.enabled = false
      const loaded = this.browserSession.getExtension(extensionId)
      if (loaded) this.browserSession.removeExtension(extensionId)
      this.records.set(extensionId, { ...record, enabled: false })
      await this.persist()
    }
    this.onChanged()
    return this.list()
  }

  async remove(extensionId: string): Promise<BrowserExtensionRecord[]> {
    const record = this.records.get(extensionId)
    if (!record) return this.list()
    const loaded = this.browserSession.getExtension(extensionId)
    if (loaded) this.browserSession.removeExtension(extensionId)
    this.records.delete(extensionId)
    this.value.extensions = this.value.extensions.filter((item) => item.path !== record.path)
    await this.persist()
    this.onChanged()
    return this.list()
  }

  private async loadOne(item: PersistedExtension, manifestInput?: Record<string, unknown>): Promise<BrowserExtensionRecord> {
    const manifest = manifestInput ?? await readManifest(item.path)
    let extension: Extension | undefined
    try {
      extension = await this.browserSession.loadExtension(item.path, { allowFileAccess: false })
      const record = recordFromExtension(extension, item.path, item.installedAt, true, manifest)
      this.records.set(record.id, record)
      return record
    } catch (cause) {
      const id = persistedId(item.path)
      const record: BrowserExtensionRecord = {
        ...recordFromManifest(id, item.path, item.installedAt, item.enabled, manifest),
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
      }
      this.records.set(id, record)
      return record
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<Snapshot>
      if (parsed?.version === 1 && Array.isArray(parsed.extensions)) {
        this.value = {
          version: 1,
          extensions: parsed.extensions.filter((item): item is PersistedExtension =>
            Boolean(item && typeof item.path === 'string' && typeof item.enabled === 'boolean' && typeof item.installedAt === 'number')),
        }
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.value, null, 2)}\n`
    const operation = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temp, this.filePath)
      } catch (cause) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw cause
      }
    })
    this.saveChain = operation
    await operation
  }
}

async function readManifest(extensionPath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(resolve(extensionPath, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as Record<string, unknown>
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') throw new Error('Extension manifest needs name and version')
  return manifest
}

function recordFromExtension(
  extension: Extension,
  path: string,
  installedAt: number,
  enabled: boolean,
  manifest: Record<string, unknown>,
): BrowserExtensionRecord {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    path,
    enabled,
    status: 'limited',
    permissions: manifestPermissions(manifest),
    ...(typeof manifest.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    installedAt,
  }
}

function recordFromManifest(
  id: string,
  path: string,
  installedAt: number,
  enabled: boolean,
  manifest: Record<string, unknown> | undefined,
): BrowserExtensionRecord {
  return {
    id,
    name: typeof manifest?.name === 'string' ? manifest.name : path,
    version: typeof manifest?.version === 'string' ? manifest.version : 'unknown',
    path,
    enabled,
    status: manifest ? 'limited' : 'error',
    permissions: manifest ? manifestPermissions(manifest) : [],
    ...(typeof manifest?.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    ...(!manifest ? { error: 'Extension manifest could not be read' } : {}),
    installedAt,
  }
}

function manifestPermissions(manifest: Record<string, unknown>): string[] {
  const values = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ]
  return values.filter((item): item is string => typeof item === 'string').slice(0, 256)
}

function persistedId(path: string): string {
  return `pending:${Buffer.from(path).toString('base64url').slice(0, 48)}`
}
