import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { OrganizationCompanySnapshot } from '../../shared/organization-snapshots.js'

const STATE_FILES = ['organization.json', 'organization-control.json', 'organization-strategy.json'] as const
const SNAPSHOT_DIR = 'organization-snapshots'
const MANIFEST = 'manifest.json'
const RESTORE_MARKER = 'organization-restore-pending.json'

interface StoredManifest {
  id: string
  label: string
  createdAt: number
  files: OrganizationCompanySnapshot['files']
}

interface RestoreMarker {
  snapshotId: string
  requestedAt: number
}

/**
 * Creates local, credential-free snapshots of the three ND company state
 * authorities. Restore is scheduled for the next launch so replacement happens
 * before any in-memory store is loaded; this avoids live split-brain state.
 */
export class OrganizationSnapshotManager {
  constructor(private readonly userData: string) {}

  async applyPendingRestore(): Promise<string | null> {
    const marker = await this.readRestoreMarker()
    if (!marker) return null
    const manifest = await this.manifest(marker.snapshotId)
    const directory = this.snapshotPath(manifest.id)
    for (const file of manifest.files) {
      const source = join(directory, file)
      const target = join(this.userData, file)
      const temp = `${target}.restore-${process.pid}-${Date.now()}`
      await fs.copyFile(source, temp)
      await fs.chmod(temp, 0o600).catch(() => undefined)
      await fs.rename(temp, target)
    }
    await fs.rm(join(this.userData, RESTORE_MARKER), { force: true })
    return manifest.id
  }

  async list(): Promise<OrganizationCompanySnapshot[]> {
    const pending = await this.readRestoreMarker()
    let entries: string[] = []
    try {
      entries = await fs.readdir(join(this.userData, SNAPSHOT_DIR))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const rows: OrganizationCompanySnapshot[] = []
    for (const id of entries) {
      try {
        const manifest = await this.manifest(id)
        rows.push({ ...manifest, restorePending: pending?.snapshotId === manifest.id })
      } catch {
        // Ignore incomplete/corrupt snapshot directories; they are not safe
        // restore candidates and should never appear as successful backups.
      }
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }

  async create(label?: string): Promise<OrganizationCompanySnapshot> {
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const directory = this.snapshotPath(id)
    const files: OrganizationCompanySnapshot['files'] = []
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      for (const file of STATE_FILES) {
        const source = join(this.userData, file)
        try {
          await fs.copyFile(source, join(directory, file))
          await fs.chmod(join(directory, file), 0o600).catch(() => undefined)
          files.push(file)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (!files.includes('organization.json')) throw new Error('Organization state does not exist yet; there is nothing to snapshot.')
      const manifest: StoredManifest = {
        id,
        label: cleanLabel(label) ?? `Company snapshot ${new Date().toLocaleString()}`,
        createdAt: Date.now(),
        files,
      }
      await atomicJson(join(directory, MANIFEST), manifest)
      return { ...manifest, restorePending: false }
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async restoreOnNextLaunch(id: string): Promise<OrganizationCompanySnapshot[]> {
    const manifest = await this.manifest(assertId(id))
    // Validate every declared source now so a restart never discovers a broken
    // snapshot after the current live state has already closed.
    for (const file of manifest.files) await fs.access(join(this.snapshotPath(manifest.id), file))
    const marker: RestoreMarker = { snapshotId: manifest.id, requestedAt: Date.now() }
    await atomicJson(join(this.userData, RESTORE_MARKER), marker)
    return this.list()
  }

  async cancelRestore(): Promise<OrganizationCompanySnapshot[]> {
    await fs.rm(join(this.userData, RESTORE_MARKER), { force: true })
    return this.list()
  }

  private async manifest(id: string): Promise<StoredManifest> {
    const raw = JSON.parse(await fs.readFile(join(this.snapshotPath(assertId(id)), MANIFEST), 'utf8')) as Partial<StoredManifest>
    if (raw.id !== id || typeof raw.label !== 'string' || !raw.label.trim() || !Number.isFinite(raw.createdAt) || !Array.isArray(raw.files)) {
      throw new Error(`Snapshot ${id} has an invalid manifest`)
    }
    const files = raw.files.filter((file): file is OrganizationCompanySnapshot['files'][number] => STATE_FILES.includes(file as typeof STATE_FILES[number]))
    if (!files.includes('organization.json')) throw new Error(`Snapshot ${id} is missing organization state`)
    return { id, label: raw.label.trim(), createdAt: raw.createdAt!, files }
  }

  private async readRestoreMarker(): Promise<RestoreMarker | null> {
    try {
      const value = JSON.parse(await fs.readFile(join(this.userData, RESTORE_MARKER), 'utf8')) as Partial<RestoreMarker>
      if (typeof value.snapshotId !== 'string' || !Number.isFinite(value.requestedAt)) return null
      return { snapshotId: assertId(value.snapshotId), requestedAt: value.requestedAt! }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private snapshotPath(id: string): string {
    const safe = assertId(id)
    const path = join(this.userData, SNAPSHOT_DIR, safe)
    if (basename(path) !== safe) throw new Error('Invalid snapshot id')
    return path
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temp, path)
}

function assertId(value: string): string {
  const id = value.trim()
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid snapshot id')
  return id
}

function cleanLabel(value?: string): string | undefined {
  if (value === undefined) return undefined
  const label = value.trim()
  if (!label) return undefined
  if (label.length > 120) throw new Error('Snapshot label must be 120 characters or fewer')
  return label
}
