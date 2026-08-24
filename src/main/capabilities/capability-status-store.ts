import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import type { CapabilityProviderStatus } from '../../shared/capabilities.js'

interface StatusSnapshot {
  version: 1
  providers: Record<string, CapabilityProviderStatus>
}

const EMPTY: StatusSnapshot = { version: 1, providers: {} }

export interface ProbeOutcome {
  ok: boolean
  at: number
  /** Required when ok is false; ignored otherwise. */
  error?: string
}

/**
 * Durable install/verify/enable state per capability provider. Verification
 * semantics are strict: a failed probe invalidates any earlier success, so an
 * "enabled" provider always means "its latest verification passed".
 */
export class CapabilityStatusStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: StatusSnapshot = structuredClone(EMPTY)

  constructor(private readonly filePath: string) {}

  async all(): Promise<Record<string, CapabilityProviderStatus>> {
    await this.load()
    return structuredClone(this.value.providers)
  }

  async get(providerId: string): Promise<CapabilityProviderStatus | undefined> {
    const providers = await this.all()
    return providers[providerId] ? structuredClone(providers[providerId]) : undefined
  }

  /**
   * Record one probe outcome. Success stamps lastVerifiedAt and clears the
   * last error; failure stamps the error and clears lastVerifiedAt so a stale
   * pass can never keep a broken provider enabled.
   */
  async recordProbe(providerId: string, outcome: ProbeOutcome): Promise<CapabilityProviderStatus> {
    if (!outcome.ok && !outcome.error?.trim()) throw new Error('A failed capability probe requires an error message')
    await this.load()
    const previous = this.value.providers[providerId]
    const next: CapabilityProviderStatus = {
      providerId,
      ...(previous?.enabled !== undefined ? { enabled: previous.enabled } : { enabled: false }),
      lastProbeAt: outcome.at,
      ...(outcome.ok ? { lastVerifiedAt: outcome.at } : { lastError: outcome.error!.trim().slice(0, 4_000) }),
    }
    this.value.providers[providerId] = next
    await this.save()
    return structuredClone(next)
  }

  async setEnabled(providerId: string, enabled: boolean): Promise<CapabilityProviderStatus> {
    await this.load()
    const previous = this.value.providers[providerId]
    const next: CapabilityProviderStatus = {
      providerId,
      enabled,
      ...(previous?.lastVerifiedAt !== undefined ? { lastVerifiedAt: previous.lastVerifiedAt } : {}),
      ...(previous?.lastError !== undefined ? { lastError: previous.lastError } : {}),
      ...(previous?.lastProbeAt !== undefined ? { lastProbeAt: previous.lastProbeAt } : {}),
    }
    this.value.providers[providerId] = next
    await this.save()
    return structuredClone(next)
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
      if (!parsed || typeof parsed !== 'object') throw new Error('capability status file is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || !record.providers || typeof record.providers !== 'object' || Array.isArray(record.providers)) {
        throw new Error('capability status file has an unsupported schema')
      }
      const providers: Record<string, CapabilityProviderStatus> = {}
      for (const [providerId, raw] of Object.entries(record.providers as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object' || !providerId.trim()) continue
        const entry = raw as Record<string, unknown>
        if (typeof entry.enabled !== 'boolean') continue
        providers[providerId.trim()] = {
          providerId: providerId.trim(),
          enabled: entry.enabled,
          ...(typeof entry.lastVerifiedAt === 'number' ? { lastVerifiedAt: entry.lastVerifiedAt } : {}),
          ...(typeof entry.lastError === 'string' && entry.lastError.trim() ? { lastError: entry.lastError } : {}),
          ...(typeof entry.lastProbeAt === 'number' ? { lastProbeAt: entry.lastProbeAt } : {}),
        }
      }
      this.value = { version: 1, providers }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable capability statuses; built-in defaults apply until re-verified:', error)
      }
      this.value = structuredClone(EMPTY)
    }
    this.loaded = true
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
