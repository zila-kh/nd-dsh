import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import type { CapabilityPrerequisiteResult, CapabilityProviderStatus, CapabilitySetupState } from '../../shared/capabilities.js'

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

export interface SetupUpdate {
  state: CapabilitySetupState
  at: number
  progress?: number
  message?: string
  error?: string
  installedVersion?: string
  prerequisites?: CapabilityPrerequisiteResult[]
}

const SETUP_STATES: readonly CapabilitySetupState[] = [
  'not-installed',
  'checking-prerequisites',
  'downloading',
  'installing',
  'configuring',
  'installed',
  'failed',
]
const ACTIVE_SETUP_STATES: readonly CapabilitySetupState[] = [
  'checking-prerequisites',
  'downloading',
  'installing',
  'configuring',
]
const INTERRUPTED_SETUP_MESSAGE = 'Setup was interrupted before completion. Retry setup.'

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
      enabled: outcome.ok ? (previous?.enabled ?? false) : false,
      ...setupFields(previous),
      lastProbeAt: outcome.at,
      ...(outcome.ok ? { lastVerifiedAt: outcome.at } : { lastError: outcome.error!.trim().slice(0, 4_000) }),
    }
    this.value.providers[providerId] = next
    await this.save()
    return structuredClone(next)
  }

  /** Persist one trusted setup checkpoint without ever storing submitted secrets. */
  async recordSetup(providerId: string, update: SetupUpdate): Promise<CapabilityProviderStatus> {
    await this.load()
    const previous = this.value.providers[providerId]
    const failed = update.state === 'failed'
    const installed = update.state === 'installed'
    const next: CapabilityProviderStatus = {
      providerId,
      enabled: failed || !installed ? false : (previous?.enabled ?? false),
      setupState: update.state,
      ...(update.progress !== undefined ? { setupProgress: clampProgress(update.progress) } : {}),
      ...(update.message?.trim() ? { setupMessage: update.message.trim().slice(0, 1_000) } : {}),
      ...(failed && update.error?.trim() ? { setupError: update.error.trim().slice(0, 4_000) } : {}),
      ...(update.installedVersion?.trim() ? { installedVersion: update.installedVersion.trim().slice(0, 128) } : {}),
      ...(update.prerequisites ? { prerequisites: sanitizePrerequisites(update.prerequisites) } : {}),
      ...(installed ? { lastSetupAt: update.at } : previous?.lastSetupAt !== undefined ? { lastSetupAt: previous.lastSetupAt } : {}),
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
      ...setupFields(previous),
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
        const persistedSetupState = typeof entry.setupState === 'string' && SETUP_STATES.includes(entry.setupState as CapabilitySetupState)
          ? entry.setupState as CapabilitySetupState
          : undefined
        const setupInterrupted = persistedSetupState !== undefined && ACTIVE_SETUP_STATES.includes(persistedSetupState)
        providers[providerId.trim()] = {
          providerId: providerId.trim(),
          enabled: entry.enabled,
          ...(typeof entry.lastVerifiedAt === 'number' ? { lastVerifiedAt: entry.lastVerifiedAt } : {}),
          ...(typeof entry.lastError === 'string' && entry.lastError.trim() ? { lastError: entry.lastError } : {}),
          ...(typeof entry.lastProbeAt === 'number' ? { lastProbeAt: entry.lastProbeAt } : {}),
          ...(persistedSetupState !== undefined ? { setupState: setupInterrupted ? 'failed' : persistedSetupState } : {}),
          ...(typeof entry.setupProgress === 'number' ? { setupProgress: clampProgress(entry.setupProgress) } : {}),
          ...(setupInterrupted
            ? { setupMessage: INTERRUPTED_SETUP_MESSAGE, setupError: INTERRUPTED_SETUP_MESSAGE }
            : typeof entry.setupMessage === 'string' && entry.setupMessage.trim() ? { setupMessage: entry.setupMessage.slice(0, 1_000) } : {}),
          ...(!setupInterrupted && typeof entry.setupError === 'string' && entry.setupError.trim() ? { setupError: entry.setupError.slice(0, 4_000) } : {}),
          ...(typeof entry.installedVersion === 'string' && entry.installedVersion.trim() ? { installedVersion: entry.installedVersion.slice(0, 128) } : {}),
          ...(typeof entry.lastSetupAt === 'number' ? { lastSetupAt: entry.lastSetupAt } : {}),
          ...(Array.isArray(entry.prerequisites) ? { prerequisites: sanitizePrerequisites(entry.prerequisites) } : {}),
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

function setupFields(status?: CapabilityProviderStatus): Partial<CapabilityProviderStatus> {
  return {
    ...(status?.setupState !== undefined ? { setupState: status.setupState } : {}),
    ...(status?.setupProgress !== undefined ? { setupProgress: status.setupProgress } : {}),
    ...(status?.setupMessage !== undefined ? { setupMessage: status.setupMessage } : {}),
    ...(status?.setupError !== undefined ? { setupError: status.setupError } : {}),
    ...(status?.installedVersion !== undefined ? { installedVersion: status.installedVersion } : {}),
    ...(status?.lastSetupAt !== undefined ? { lastSetupAt: status.lastSetupAt } : {}),
    ...(status?.prerequisites !== undefined ? { prerequisites: status.prerequisites } : {}),
  }
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function sanitizePrerequisites(value: unknown[]): CapabilityPrerequisiteResult[] {
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.label !== 'string' || !item.label.trim() || typeof item.met !== 'boolean') return []
    return [{
      id: item.id.trim().slice(0, 128),
      label: item.label.trim().slice(0, 256),
      met: item.met,
      ...(typeof item.detail === 'string' && item.detail.trim() ? { detail: item.detail.trim().slice(0, 1_000) } : {}),
    }]
  })
}
