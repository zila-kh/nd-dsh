import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserCompanionBrowser, BrowserCompanionConnection } from '../../shared/browser-companion.js'

interface Snapshot {
  version: 1
  connections: BrowserCompanionConnection[]
}

export class BrowserConnectionStore {
  private loaded = false
  private value: Snapshot = { version: 1, connections: [] }
  private saveChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<BrowserCompanionConnection[]> {
    await this.load()
    return structuredClone(this.value.connections)
  }

  async upsertConnected(input: {
    installationId: string
    browser: BrowserCompanionBrowser
    profileLabel: string
    extensionVersion: string
  }): Promise<BrowserCompanionConnection> {
    await this.load()
    const installationId = text(input.installationId, 'installation id', 256)
    const now = Date.now()
    const index = this.value.connections.findIndex((item) => item.installationId === installationId)
    const previous = index >= 0 ? this.value.connections[index] : undefined
    const next: BrowserCompanionConnection = {
      id: previous?.id ?? randomUUID(),
      installationId,
      browser: input.browser,
      profileLabel: text(input.profileLabel || input.browser, 'profile label', 256),
      extensionVersion: text(input.extensionVersion || '0', 'extension version', 64),
      connected: true,
      connectedAt: previous?.connected && previous.connectedAt ? previous.connectedAt : now,
      lastSeenAt: now,
    }
    if (index >= 0) this.value.connections[index] = next
    else this.value.connections.push(next)
    await this.persist()
    return structuredClone(next)
  }

  async touch(id: string): Promise<void> {
    await this.load()
    const found = this.value.connections.find((item) => item.id === id)
    if (!found) return
    found.lastSeenAt = Date.now()
    await this.persist()
  }

  async markDisconnected(id: string): Promise<void> {
    await this.load()
    const found = this.value.connections.find((item) => item.id === id)
    if (!found || !found.connected) return
    found.connected = false
    found.lastSeenAt = Date.now()
    await this.persist()
  }

  async markAllDisconnected(): Promise<void> {
    await this.load()
    let changed = false
    for (const connection of this.value.connections) {
      if (!connection.connected) continue
      connection.connected = false
      changed = true
    }
    if (changed) await this.persist()
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Snapshot
      if (parsed?.version === 1 && Array.isArray(parsed.connections)) {
        this.value = {
          version: 1,
          connections: parsed.connections.filter(validConnection),
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const payload = `${JSON.stringify(this.value, null, 2)}\n`
    const write = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temp, this.filePath)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    })
    this.saveChain = write
    await write
  }
}

function validConnection(value: BrowserCompanionConnection): boolean {
  return Boolean(value && typeof value.id === 'string' && typeof value.installationId === 'string'
    && typeof value.browser === 'string' && typeof value.profileLabel === 'string'
    && typeof value.extensionVersion === 'string')
}

function text(value: string, label: string, max: number): string {
  const clean = value.trim()
  if (!clean || clean.length > max) throw new Error(`Browser companion ${label} is invalid`)
  return clean
}
