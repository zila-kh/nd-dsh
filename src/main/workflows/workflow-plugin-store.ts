import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import {
  workflowSnapshotKeyId,
  type InstalledWorkflowPlugin,
  type ProjectWorkflowBinding,
  type ProjectWorkflowSnapshot,
  type WorkflowPluginManifest,
  type WorkflowPluginsState,
  type WorkflowSnapshotEntry,
} from '../../shared/workflow-plugins.js'

interface WorkflowPluginFile {
  version: 1
  plugins: InstalledWorkflowPlugin[]
  bindings: ProjectWorkflowBinding[]
  snapshots: WorkflowSnapshotEntry[]
}

const EMPTY: WorkflowPluginFile = { version: 1, plugins: [], bindings: [], snapshots: [] }

/**
 * Durable ND-owned workflow plugin catalog: installed plugin packages,
 * explicit company/project bindings, and each binding's last-known board
 * snapshot. The renderer never writes this file directly, and none of this
 * state touches project repositories.
 */
export class WorkflowPluginStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: WorkflowPluginFile = structuredClone(EMPTY)
  private onChanged: ((state: WorkflowPluginsState) => void) | undefined

  constructor(readonly filePath: string) {}

  setOnChanged(listener: ((state: WorkflowPluginsState) => void) | undefined): void {
    this.onChanged = listener
  }

  async state(): Promise<WorkflowPluginsState> {
    await this.load()
    return { version: 1, plugins: structuredClone(this.value.plugins), bindings: structuredClone(this.value.bindings), snapshots: structuredClone(this.value.snapshots) }
  }

  async upsertPlugin(manifest: WorkflowPluginManifest, source: InstalledWorkflowPlugin['source'], now = Date.now()): Promise<InstalledWorkflowPlugin> {
    await this.load()
    const existing = this.value.plugins.find((item) => item.id === manifest.id)
    const record: InstalledWorkflowPlugin = {
      id: manifest.id,
      version: manifest.version,
      manifest,
      source,
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    }
    this.value.plugins = [...this.value.plugins.filter((item) => item.id !== manifest.id), record]
    await this.persist()
    return structuredClone(record)
  }

  async getPlugin(id: string): Promise<InstalledWorkflowPlugin | undefined> {
    await this.load()
    return structuredClone(this.value.plugins.find((item) => item.id === id))
  }

  /**
   * Removing a plugin revokes its bindings and snapshots immediately. Only
   * ND-owned state is deleted; project repositories are never touched.
   */
  async removePlugin(id: string): Promise<void> {
    await this.load()
    const before = JSON.stringify([this.value.plugins.length, this.value.bindings.length, this.value.snapshots.length])
    this.value.plugins = this.value.plugins.filter((item) => item.id !== id)
    this.value.bindings = this.value.bindings.filter((item) => item.pluginId !== id)
    this.value.snapshots = this.value.snapshots.filter((item) => item.key.pluginId !== id)
    if (JSON.stringify([this.value.plugins.length, this.value.bindings.length, this.value.snapshots.length]) !== before) {
      await this.persist()
    }
  }

  async getBinding(companyId: string, projectId: string, pluginId?: string): Promise<ProjectWorkflowBinding | undefined> {
    await this.load()
    const bindings = this.value.bindings
      .filter((item) => item.companyId === companyId && item.projectId === projectId && (!pluginId || item.pluginId === pluginId))
      .sort((left, right) => right.updatedAt - left.updatedAt)
    return structuredClone(bindings[0])
  }

  async putBinding(binding: ProjectWorkflowBinding): Promise<void> {
    await this.load()
    const rest = this.value.bindings.filter((item) => !sameTarget(item, binding))
    this.value.bindings = [...rest, structuredClone(binding)]
    await this.persist()
  }

  async removeBinding(companyId: string, projectId: string, pluginId: string): Promise<void> {
    await this.load()
    const rest = this.value.bindings.filter((item) => !sameTarget(item, { companyId, projectId, pluginId }))
    if (rest.length !== this.value.bindings.length) {
      this.value.bindings = rest
      await this.persist()
    }
  }

  async getSnapshot(companyId: string, projectId: string, pluginId: string): Promise<ProjectWorkflowSnapshot | undefined> {
    await this.load()
    const key = workflowSnapshotKeyId({ companyId, projectId, pluginId })
    const entry = this.value.snapshots.find((item) => workflowSnapshotKeyId(item.key) === key)
    return entry ? structuredClone(entry.snapshot) : undefined
  }

  /** Atomically replace the stored snapshot for one binding key. */
  async putSnapshot(key: Parameters<typeof workflowSnapshotKeyId>[0], snapshot: ProjectWorkflowSnapshot): Promise<void> {
    await this.load()
    const id = workflowSnapshotKeyId(key)
    const rest = this.value.snapshots.filter((item) => workflowSnapshotKeyId(item.key) !== id)
    this.value.snapshots = [...rest, { key: structuredClone(key), snapshot: structuredClone(snapshot) }].slice(-200)
    await this.persist()
  }

  async removeSnapshot(companyId: string, projectId: string, pluginId: string): Promise<void> {
    await this.load()
    const id = workflowSnapshotKeyId({ companyId, projectId, pluginId })
    const rest = this.value.snapshots.filter((item) => workflowSnapshotKeyId(item.key) !== id)
    if (rest.length !== this.value.snapshots.length) {
      this.value.snapshots = rest
      await this.persist()
    }
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
      if (!parsed || typeof parsed !== 'object') throw new Error('workflow plugin store is not an object')
      const record = parsed as Partial<WorkflowPluginFile>
      if (record.version !== 1 || !Array.isArray(record.plugins) || !Array.isArray(record.bindings) || !Array.isArray(record.snapshots)) {
        throw new Error('workflow plugin store has an unsupported schema')
      }
      this.value = {
        version: 1,
        plugins: record.plugins,
        bindings: record.bindings,
        snapshots: record.snapshots.filter((entry) => entry && typeof entry === 'object' && entry.key && entry.snapshot),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable workflow plugin store; starting empty:', error)
      }
      this.value = structuredClone(EMPTY)
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
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
    await write
    this.onChanged?.(await this.state())
  }
}

function sameTarget(
  left: Pick<ProjectWorkflowBinding, 'companyId' | 'projectId' | 'pluginId'>,
  right: Pick<ProjectWorkflowBinding, 'companyId' | 'projectId' | 'pluginId'>,
): boolean {
  return left.companyId === right.companyId && left.projectId === right.projectId && left.pluginId === right.pluginId
}
