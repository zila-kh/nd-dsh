import { randomUUID } from 'node:crypto'
import type { Extension, Session } from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  BrowserExtensionCatalogItem,
  BrowserExtensionRecord,
  BrowserExtensionSource,
} from '../../shared/browser-platform.js'

interface PersistedExtension {
  path: string
  enabled: boolean
  installedAt: number
  source?: BrowserExtensionSource
  storeId?: string
  publisher?: string
}

interface Snapshot {
  version: 1
  browserUseEnabled: boolean
  developerMode: boolean
  extensions: PersistedExtension[]
}

interface CatalogDefinition {
  id: string
  name: string
  publisher: string
  description: string
  storeId: string
  storeUrl: string
  compatibility: 'experimental' | 'limited'
  note: string
}

const CATALOG: CatalogDefinition[] = [
  {
    id: 'openai-chatgpt',
    name: 'ChatGPT',
    publisher: 'OpenAI',
    description: 'Official ChatGPT browser extension. ND can import a locally installed Chrome copy into its built-in browser profile for compatibility testing.',
    storeId: 'hehggadaopoacecdllhhajmbjkdcmajg',
    storeUrl: 'https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg?hl=en',
    compatibility: 'experimental',
    note: 'The official listing currently targets Google Chrome. Electron supports only a subset of Chrome extension APIs, so ND never claims full compatibility.',
  },
]

export class BrowserExtensionManager {
  private loaded = false
  private value: Snapshot = {
    version: 1,
    browserUseEnabled: true,
    developerMode: false,
    extensions: [],
  }
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
        this.records.set(id, recordFromManifest(id, item, false, manifest))
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

  catalog(): BrowserExtensionCatalogItem[] {
    return CATALOG.map((item) => {
      const installed = this.list().find((record) => record.storeId === item.storeId)
      return {
        ...item,
        installed: Boolean(installed),
        ...(installed ? { installedExtensionId: installed.id } : {}),
      }
    })
  }

  browserUseEnabled(): boolean {
    return this.value.browserUseEnabled
  }

  developerMode(): boolean {
    return this.value.developerMode
  }

  async setBrowserUseEnabled(enabled: boolean): Promise<void> {
    this.value.browserUseEnabled = enabled
    await this.persist()
    this.onChanged()
  }

  async setDeveloperMode(enabled: boolean): Promise<void> {
    this.value.developerMode = enabled
    await this.persist()
    this.onChanged()
  }

  async install(path: string): Promise<BrowserExtensionRecord> {
    return this.installPath(resolve(path), {
      source: 'unpacked',
    })
  }

  async importCatalog(catalogId: string): Promise<BrowserExtensionRecord> {
    const definition = CATALOG.find((item) => item.id === catalogId)
    if (!definition) throw new Error('Unknown built-in browser extension catalog item')

    const sourcePath = await findChromeExtensionPath(definition.storeId)
    if (!sourcePath) {
      throw new Error(
        `${definition.name} is not installed in a local Google Chrome profile. Install it in Chrome first, then retry Import into ND.`,
      )
    }

    for (const [id, record] of [...this.records]) {
      if (record.storeId !== definition.storeId) continue
      const loaded = this.browserSession.getExtension(id)
      if (loaded) this.browserSession.removeExtension(id)
      this.records.delete(id)
    }
    this.value.extensions = this.value.extensions.filter((item) => item.storeId !== definition.storeId)

    const catalogRoot = resolve(dirname(this.filePath), 'browser-extension-imports', definition.id)
    await fs.rm(catalogRoot, { recursive: true, force: true })
    await fs.mkdir(catalogRoot, { recursive: true, mode: 0o700 })
    const destination = resolve(catalogRoot, basename(sourcePath))
    await fs.cp(sourcePath, destination, { recursive: true, force: true })

    return this.installPath(destination, {
      source: 'chrome-import',
      storeId: definition.storeId,
      publisher: definition.publisher,
    })
  }

  async reloadAll(): Promise<BrowserExtensionRecord[]> {
    for (const record of this.records.values()) {
      const loaded = this.browserSession.getExtension(record.id)
      if (loaded) this.browserSession.removeExtension(record.id)
    }
    this.records.clear()

    for (const item of this.value.extensions) {
      const manifest = await readManifest(item.path).catch(() => undefined)
      if (!item.enabled) {
        const id = persistedId(item.path)
        this.records.set(id, recordFromManifest(id, item, false, manifest))
        continue
      }
      if (!manifest) {
        const id = persistedId(item.path)
        this.records.set(id, recordFromManifest(id, item, true, undefined))
        continue
      }
      await this.loadOne(item, manifest).catch(() => undefined)
    }
    this.onChanged()
    return this.list()
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
    if (record.source === 'chrome-import') {
      const managedRoot = resolve(dirname(this.filePath), 'browser-extension-imports')
      if (record.path.startsWith(managedRoot)) await fs.rm(dirname(record.path), { recursive: true, force: true }).catch(() => undefined)
    }
    this.onChanged()
    return this.list()
  }

  private async installPath(
    extensionPath: string,
    metadata: Pick<PersistedExtension, 'source' | 'storeId' | 'publisher'>,
  ): Promise<BrowserExtensionRecord> {
    const manifest = await readManifest(extensionPath)
    const existing = this.value.extensions.find((item) => item.path === extensionPath)
    const item: PersistedExtension = existing ?? {
      path: extensionPath,
      enabled: true,
      installedAt: Date.now(),
      ...metadata,
    }
    item.enabled = true
    item.source = metadata.source
    item.storeId = metadata.storeId
    item.publisher = metadata.publisher
    if (!existing) this.value.extensions.push(item)
    await this.persist()

    for (const [id, record] of [...this.records]) {
      if (record.path === extensionPath) {
        const loaded = this.browserSession.getExtension(id)
        if (loaded) this.browserSession.removeExtension(id)
        this.records.delete(id)
      }
    }

    const record = await this.loadOne(item, manifest)
    this.onChanged()
    return structuredClone(record)
  }

  private async loadOne(item: PersistedExtension, manifestInput?: Record<string, unknown>): Promise<BrowserExtensionRecord> {
    const manifest = manifestInput ?? await readManifest(item.path)
    let extension: Extension | undefined
    try {
      extension = await this.browserSession.loadExtension(item.path, { allowFileAccess: false })
      const record = recordFromExtension(extension, item, true, manifest)
      this.records.set(record.id, record)
      return record
    } catch (cause) {
      const id = persistedId(item.path)
      const record: BrowserExtensionRecord = {
        ...recordFromManifest(id, item, item.enabled, manifest),
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
          browserUseEnabled: parsed.browserUseEnabled !== false,
          developerMode: parsed.developerMode === true,
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
  item: PersistedExtension,
  enabled: boolean,
  manifest: Record<string, unknown>,
): BrowserExtensionRecord {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    path: item.path,
    enabled,
    status: 'limited',
    permissions: manifestPermissions(manifest),
    ...(typeof manifest.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.storeId ? { storeId: item.storeId } : {}),
    ...(item.publisher ? { publisher: item.publisher } : {}),
    installedAt: item.installedAt,
  }
}

function recordFromManifest(
  id: string,
  item: PersistedExtension,
  enabled: boolean,
  manifest: Record<string, unknown> | undefined,
): BrowserExtensionRecord {
  return {
    id,
    name: typeof manifest?.name === 'string' ? manifest.name : item.path,
    version: typeof manifest?.version === 'string' ? manifest.version : 'unknown',
    path: item.path,
    enabled,
    status: manifest ? 'limited' : 'error',
    permissions: manifest ? manifestPermissions(manifest) : [],
    ...(typeof manifest?.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.storeId ? { storeId: item.storeId } : {}),
    ...(item.publisher ? { publisher: item.publisher } : {}),
    ...(!manifest ? { error: 'Extension manifest could not be read' } : {}),
    installedAt: item.installedAt,
  }
}

function manifestPermissions(manifest: Record<string, unknown>): string[] {
  const values = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ]
  return values.filter((item): item is string => typeof item === 'string').slice(0, 256)
}

async function findChromeExtensionPath(storeId: string): Promise<string | undefined> {
  const roots = chromeUserDataRoots()
  for (const root of roots) {
    const profiles = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    for (const profile of profiles) {
      if (!profile.isDirectory() || (profile.name !== 'Default' && !profile.name.startsWith('Profile '))) continue
      const extensionRoot = join(root, profile.name, 'Extensions', storeId)
      const versions = (await fs.readdir(extensionRoot, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const version of versions) {
        const candidate = join(extensionRoot, version)
        if (await readManifest(candidate).then(() => true).catch(() => false)) return candidate
      }
    }
  }
  return undefined
}

function chromeUserDataRoots(): string[] {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    return localAppData ? [join(localAppData, 'Google', 'Chrome', 'User Data')] : []
  }
  if (process.platform === 'darwin') {
    return [join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')]
  }
  return [join(homedir(), '.config', 'google-chrome')]
}

function persistedId(path: string): string {
  return `pending:${Buffer.from(path).toString('base64url').slice(0, 48)}`
}
