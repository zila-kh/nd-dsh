import { randomUUID } from 'node:crypto'
import { app, type Extension, type Session } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type {
  BrowserExtensionCatalogItem,
  BrowserExtensionInstallPreview,
  BrowserExtensionRecord,
  BrowserExtensionSource,
} from '../../shared/browser-platform.js'
import { analyzeBrowserExtensionManifest, extensionIdFromManifestKey } from './browser-extension-compatibility.js'

interface PersistedExtension {
  path: string
  enabled: boolean
  installedAt: number
  source?: BrowserExtensionSource
  catalogId?: string
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
  storeId?: string
  storeUrl?: string
  packagePolicy: 'bundled' | 'verified-chrome-id'
  compatibility: 'experimental' | 'limited' | 'compatible'
  note: string
}

const CATALOG: CatalogDefinition[] = [
  {
    id: 'nd-browser-tools',
    name: 'ND Browser Tools',
    publisher: 'ND',
    description: 'First-party browser tools that run entirely inside the ND built-in Chromium profile.',
    packagePolicy: 'bundled',
    compatibility: 'compatible',
    note: 'Bundled with ND as the Method 2 reference extension; it does not use external Chrome or Native Messaging.',
  },
  {
    id: 'openai-chatgpt',
    name: 'ChatGPT',
    publisher: 'OpenAI',
    description: 'Compatibility reference for the official standalone-Chrome extension, not the ND Method 2 runtime.',
    storeId: 'hehggadaopoacecdllhhajmbjkdcmajg',
    storeUrl: 'https://chromewebstore.google.com/detail/chatgpt/hehggadaopoacecdllhhajmbjkdcmajg?hl=en',
    packagePolicy: 'verified-chrome-id',
    compatibility: 'experimental',
    note: 'This package targets the standalone Chrome integration and may require APIs Electron does not expose. ND never launches external Chrome for built-in extension execution.',
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
      const installed = this.list().find((record) =>
        record.catalogId === item.id || (item.storeId !== undefined && record.storeId === item.storeId))
      return {
        ...item,
        bundleAvailable: bundledExtensionCandidates(item.id)
          .some((candidate) => existsSync(resolve(candidate, 'manifest.json'))),
        installed: Boolean(installed),
        ...(installed ? {
          installedExtensionId: installed.id,
          ...(installed.source ? { installedSource: installed.source } : {}),
        } : {}),
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

  async preview(path: string): Promise<BrowserExtensionInstallPreview> {
    const extensionPath = resolve(path)
    const manifest = await readManifest(extensionPath)
    return previewFromManifest(extensionPath, manifest)
  }

  async install(path: string): Promise<BrowserExtensionRecord> {
    return this.installPath(resolve(path), {
      source: 'unpacked',
    })
  }

  async previewCatalog(catalogId: string, selectedPath?: string): Promise<BrowserExtensionInstallPreview> {
    const { definition, sourcePath, manifest } = await this.resolveCatalogPackage(catalogId, selectedPath)
    verifyCatalogManifest(definition, manifest)
    return previewFromManifest(sourcePath, manifest)
  }

  async installCatalog(catalogId: string, selectedPath?: string): Promise<BrowserExtensionRecord> {
    const { definition, sourcePath, manifest } = await this.resolveCatalogPackage(catalogId, selectedPath)
    verifyCatalogManifest(definition, manifest)

    for (const [id, record] of [...this.records]) {
      if (!matchesCatalogRecord(record, definition)) continue
      const loaded = this.browserSession.extensions.getExtension(id)
      if (loaded) this.browserSession.extensions.removeExtension(id)
      this.records.delete(id)
    }
    this.value.extensions = this.value.extensions.filter((item) =>
      !matchesCatalogPersisted(item, definition))

    return this.installPath(sourcePath, {
      source: selectedPath ? 'unpacked' : 'bundled',
      catalogId: definition.id,
      storeId: definition.storeId,
      publisher: definition.publisher,
    })
  }

  private async resolveCatalogPackage(
    catalogId: string,
    selectedPath?: string,
  ): Promise<{ definition: CatalogDefinition; sourcePath: string; manifest: Record<string, unknown> }> {
    const definition = CATALOG.find((item) => item.id === catalogId)
    if (!definition) throw new Error('Unknown built-in browser extension catalog item')
    if (selectedPath && definition.packagePolicy === 'bundled') {
      throw new Error(`${definition.name} is a bundled ND extension and cannot be replaced by an arbitrary folder.`)
    }
    const sourcePath = selectedPath
      ? resolve(selectedPath)
      : await findBundledExtensionPath(definition.id)
    if (!sourcePath) {
      if (definition.packagePolicy === 'bundled') {
        throw new Error(`${definition.name} is missing from this ND build.`)
      }
      throw new Error(
        `${definition.name} is not bundled in this ND build. Choose an authorized unpacked package to test it directly in the ND browser.`,
      )
    }
    return {
      definition,
      sourcePath,
      manifest: await readManifest(sourcePath),
    }
  }

  async reloadAll(): Promise<BrowserExtensionRecord[]> {
    for (const record of this.records.values()) {
      const loaded = this.browserSession.extensions.getExtension(record.id)
      if (loaded) this.browserSession.extensions.removeExtension(record.id)
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
      const loaded = this.browserSession.extensions.getExtension(extensionId)
      if (loaded) this.browserSession.extensions.removeExtension(extensionId)
      this.records.set(extensionId, { ...record, enabled: false })
      await this.persist()
    }
    this.onChanged()
    return this.list()
  }

  async remove(extensionId: string): Promise<BrowserExtensionRecord[]> {
    const record = this.records.get(extensionId)
    if (!record) return this.list()
    const loaded = this.browserSession.extensions.getExtension(extensionId)
    if (loaded) this.browserSession.extensions.removeExtension(extensionId)
    this.records.delete(extensionId)
    this.value.extensions = this.value.extensions.filter((item) => item.path !== record.path)
    await this.persist()
    this.onChanged()
    return this.list()
  }

  private async installPath(
    extensionPath: string,
    metadata: Pick<PersistedExtension, 'source' | 'catalogId' | 'storeId' | 'publisher'>,
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
    item.catalogId = metadata.catalogId
    item.storeId = metadata.storeId
    item.publisher = metadata.publisher
    if (!existing) this.value.extensions.push(item)
    await this.persist()

    for (const [id, record] of [...this.records]) {
      if (record.path === extensionPath) {
        const loaded = this.browserSession.extensions.getExtension(id)
        if (loaded) this.browserSession.extensions.removeExtension(id)
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
      extension = await this.browserSession.extensions.loadExtension(item.path, { allowFileAccess: false })
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

function matchesCatalogRecord(record: BrowserExtensionRecord, definition: CatalogDefinition): boolean {
  return record.catalogId === definition.id
    || (definition.storeId !== undefined && record.storeId === definition.storeId)
}

function matchesCatalogPersisted(item: PersistedExtension, definition: CatalogDefinition): boolean {
  return item.catalogId === definition.id
    || (definition.storeId !== undefined && item.storeId === definition.storeId)
}

function verifyCatalogManifest(definition: CatalogDefinition, manifest: Record<string, unknown>): void {
  if (definition.packagePolicy === 'bundled') return
  if (!definition.storeId) throw new Error(`${definition.name} catalog entry is missing its expected extension id.`)
  const manifestKey = typeof manifest.key === 'string' ? manifest.key : undefined
  const verifiedId = manifestKey ? extensionIdFromManifestKey(manifestKey) : undefined
  if (verifiedId !== definition.storeId) {
    throw new Error(
      `${definition.name} package could not be verified as extension ${definition.storeId}. Use Load unpacked for unverified packages.`,
    )
  }
}

function previewFromManifest(
  extensionPath: string,
  manifest: Record<string, unknown>,
): BrowserExtensionInstallPreview {
  const compatibility = analyzeBrowserExtensionManifest(manifest)
  return {
    path: extensionPath,
    name: typeof manifest.name === 'string' ? manifest.name : 'Browser extension',
    version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
    permissions: manifestPermissions(manifest),
    ...(typeof manifest.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    status: compatibility.status,
    compatibilityNotes: compatibility.notes,
    ...manifestAction(manifest),
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
  const compatibility = analyzeBrowserExtensionManifest(manifest)
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    path: item.path,
    enabled,
    status: compatibility.status,
    permissions: manifestPermissions(manifest),
    ...(typeof manifest.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.catalogId ? { catalogId: item.catalogId } : {}),
    ...(item.storeId ? { storeId: item.storeId } : {}),
    ...(item.publisher ? { publisher: item.publisher } : {}),
    ...manifestAction(manifest),
    ...(compatibility.notes.length > 0 ? { compatibilityNotes: compatibility.notes } : {}),
    installedAt: item.installedAt,
  }
}

function recordFromManifest(
  id: string,
  item: PersistedExtension,
  enabled: boolean,
  manifest: Record<string, unknown> | undefined,
): BrowserExtensionRecord {
  const compatibility = manifest ? analyzeBrowserExtensionManifest(manifest) : undefined
  return {
    id,
    name: typeof manifest?.name === 'string' ? manifest.name : item.path,
    version: typeof manifest?.version === 'string' ? manifest.version : 'unknown',
    path: item.path,
    enabled,
    status: compatibility?.status ?? 'error',
    permissions: manifest ? manifestPermissions(manifest) : [],
    ...(typeof manifest?.manifest_version === 'number' ? { manifestVersion: manifest.manifest_version } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.catalogId ? { catalogId: item.catalogId } : {}),
    ...(item.storeId ? { storeId: item.storeId } : {}),
    ...(item.publisher ? { publisher: item.publisher } : {}),
    ...(manifest ? manifestAction(manifest) : {}),
    ...(compatibility && compatibility.notes.length > 0 ? { compatibilityNotes: compatibility.notes } : {}),
    ...(!manifest ? { error: 'Extension manifest could not be read' } : {}),
    installedAt: item.installedAt,
  }
}

function manifestAction(manifest: Record<string, unknown>): Pick<BrowserExtensionRecord, 'actionTitle' | 'actionPopup'> {
  const action = objectValue(manifest.action)
    ?? objectValue(manifest.browser_action)
    ?? objectValue(manifest.page_action)
  if (!action) return {}
  const title = typeof action.default_title === 'string' && action.default_title.trim()
    ? action.default_title.trim()
    : undefined
  const popup = typeof action.default_popup === 'string' && action.default_popup.trim()
    ? action.default_popup.trim().replace(/^\/+/, '')
    : undefined
  return {
    ...(title ? { actionTitle: title } : {}),
    ...(popup ? { actionPopup: popup } : {}),
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function manifestPermissions(manifest: Record<string, unknown>): string[] {
  const values = [
    ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ]
  return values.filter((item): item is string => typeof item === 'string').slice(0, 256)
}

function bundledExtensionCandidates(catalogId: string): string[] {
  return [
    resolve(process.resourcesPath, 'browser-extensions', catalogId),
    resolve(app.getAppPath(), 'resources', 'browser-extensions', catalogId),
  ]
}

async function findBundledExtensionPath(catalogId: string): Promise<string | undefined> {
  for (const candidate of bundledExtensionCandidates(catalogId)) {
    if (await readManifest(candidate).then(() => true).catch(() => false)) return candidate
  }
  return undefined
}

function persistedId(path: string): string {
  return `pending:${Buffer.from(path).toString('base64url').slice(0, 48)}`
}
