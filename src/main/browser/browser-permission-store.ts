import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserSitePermission } from '../../shared/browser-platform.js'

interface Snapshot {
  version: 1
  permissions: BrowserSitePermission[]
}

const MAX_PERMISSIONS = 2_000

export class BrowserPermissionStore {
  private loaded = false
  private value: Snapshot = { version: 1, permissions: [] }
  private saveChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await this.load()
  }

  list(): BrowserSitePermission[] {
    return structuredClone(this.value.permissions)
  }

  effect(origin: string, permission: string): 'allow' | 'deny' {
    const normalized = normalizeOrigin(origin)
    const record = this.value.permissions.find((item) =>
      item.origin === normalized && item.permission === permission)
    return record?.effect ?? 'deny'
  }

  async set(origin: string, permission: string, effect: 'allow' | 'deny'): Promise<BrowserSitePermission> {
    await this.load()
    const normalized = normalizeOrigin(origin)
    const cleanPermission = permission.trim()
    if (!cleanPermission || cleanPermission.length > 128) throw new Error('Browser permission name is invalid')
    const existing = this.value.permissions.find((item) =>
      item.origin === normalized && item.permission === cleanPermission)
    const record: BrowserSitePermission = {
      origin: normalized,
      permission: cleanPermission,
      effect,
      updatedAt: Date.now(),
    }
    if (existing) this.value.permissions[this.value.permissions.indexOf(existing)] = record
    else this.value.permissions.unshift(record)
    if (this.value.permissions.length > MAX_PERMISSIONS) this.value.permissions.length = MAX_PERMISSIONS
    await this.persist()
    return structuredClone(record)
  }

  async clear(origin?: string): Promise<number> {
    await this.load()
    if (!origin) {
      const count = this.value.permissions.length
      this.value.permissions = []
      if (count) await this.persist()
      return count
    }
    const normalized = normalizeOrigin(origin)
    const before = this.value.permissions.length
    this.value.permissions = this.value.permissions.filter((item) => item.origin !== normalized)
    const removed = before - this.value.permissions.length
    if (removed) await this.persist()
    return removed
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<Snapshot>
      if (parsed?.version === 1 && Array.isArray(parsed.permissions)) {
        this.value = {
          version: 1,
          permissions: parsed.permissions.filter(validPermission).slice(0, MAX_PERMISSIONS),
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

function normalizeOrigin(value: string): string {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error('Browser permission origin is invalid') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Browser permissions require http/https origins')
  return parsed.origin
}

function validPermission(value: unknown): value is BrowserSitePermission {
  if (!value || typeof value !== 'object') return false
  const record = value as BrowserSitePermission
  return typeof record.origin === 'string'
    && typeof record.permission === 'string'
    && (record.effect === 'allow' || record.effect === 'deny')
    && typeof record.updatedAt === 'number'
}
