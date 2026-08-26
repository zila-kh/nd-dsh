import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import type {
  TokenSaverAccountId,
  TokenSaverAccountState,
  TokenSaverCounters,
  TokenSaverExternalAppState,
  TokenSaverInstallerState,
  TokenSaverOptimization,
  TokenSaverSettings,
  TokenSaverState,
} from '../../shared/token-saver.js'
import { defaultTokenSaverSettings, emptyTokenSaverCounters } from '../../shared/token-saver.js'

interface Snapshot {
  version: 1
  settings: TokenSaverSettings
  counters: TokenSaverCounters
}

export interface OptimizeOptions {
  kind?: 'prompt' | 'tool-output' | 'generic'
  maxChars?: number
}

export interface TokenSaverAccountControl {
  accounts(): TokenSaverAccountState[]
  connect(id: TokenSaverAccountId): Promise<void>
  disconnect(id: TokenSaverAccountId): Promise<void>
  refresh(): Promise<void>
  setOnChanged?(listener: (() => void) | undefined): void
}

export interface TokenSaverExternalControl {
  state(): TokenSaverInstallerState
  enableCodex(): Promise<void>
  disableCodex(): Promise<void>
}

export interface TokenSaverServiceOptions {
  accounts?: TokenSaverAccountControl
  external?: TokenSaverExternalControl
}

const DEFAULT_MAX_CHARS = 32_000
const MIN_SAVINGS_CHARS = 256
const MAX_RECOVERY_ITEMS = 50
const EMPTY_INSTALLER: TokenSaverInstallerState = {
  supported: false,
  installed: false,
  codexManaged: false,
  detail: 'External app helper is not attached to this Token Saver instance.',
}

/**
 * ND-owned orchestration layer for token saving.
 *
 * Built-in ND saving is deterministic and works without any external helper.
 * The optional external controller is app-managed and completely independent:
 * external setup failure never disables ND-native optimization.
 */
export class TokenSaverService {
  private settingsValue = defaultTokenSaverSettings()
  private countersValue = emptyTokenSaverCounters()
  private onChanged?: (state: TokenSaverState) => void
  private readonly recoveryDir: string

  constructor(
    private readonly filePath: string,
    private readonly options: TokenSaverServiceOptions = {},
  ) {
    this.recoveryDir = join(dirname(filePath), 'recovery')
    this.load()
    this.options.accounts?.setOnChanged?.(() => this.emit())
  }

  setOnChanged(listener: ((state: TokenSaverState) => void) | undefined): void {
    this.onChanged = listener
  }

  /** Reconcile persisted opt-in with the actual external integration on app start. */
  async initialize(): Promise<TokenSaverState> {
    const controller = this.options.external
    if (!controller) return this.state()
    const wantsCodex = externalCodexEnabled(this.settingsValue)
    const managed = controller.state().codexManaged
    if (wantsCodex === managed) return this.state()
    try {
      if (wantsCodex) await controller.enableCodex()
      else await controller.disableCodex()
      return this.emit()
    } catch (error) {
      // A stale persisted opt-in must not create a setup loop on every launch.
      // Roll only the external master switch back; ND-native saving stays on.
      if (wantsCodex) {
        this.settingsValue = { ...this.settingsValue, externalEnabled: false }
        this.persist()
        this.emit()
      }
      throw error
    }
  }

  state(): TokenSaverState {
    const installer = this.options.external?.state() ?? { ...EMPTY_INSTALLER }
    return {
      settings: structuredClone(this.settingsValue),
      counters: { ...this.countersValue },
      externalApps: detectExternalApps(this.settingsValue, installer),
      accounts: this.options.accounts?.accounts() ?? [],
      installer,
      optimizers: [
        { id: 'nd-native', available: true, detail: 'Built in to ND' },
        {
          id: 'rtk',
          available: installer.supported,
          ...(installer.detail ? { detail: installer.detail } : {}),
        },
        { id: 'caveman', available: false, detail: 'Replaceable adapter reserved for recoverable generic-payload compression.' },
      ],
    }
  }

  settings(): TokenSaverSettings {
    return structuredClone(this.settingsValue)
  }

  async updateSettings(value: unknown): Promise<TokenSaverState> {
    const previous = structuredClone(this.settingsValue)
    const next = sanitizeSettings(value, previous)
    this.settingsValue = next
    this.persist()
    try {
      await this.reconcileExternal(previous, next)
    } catch (error) {
      this.settingsValue = previous
      this.persist()
      this.emit()
      throw error
    }
    return this.emit()
  }

  resetCounters(): TokenSaverState {
    this.countersValue = emptyTokenSaverCounters()
    this.persist()
    return this.emit()
  }

  detectExternalApps(): TokenSaverState {
    return this.emit()
  }

  async connectAccount(id: TokenSaverAccountId): Promise<TokenSaverState> {
    if (!this.options.accounts) throw new Error('Provider-account service is unavailable')
    await this.options.accounts.connect(id)
    return this.emit()
  }

  async disconnectAccount(id: TokenSaverAccountId): Promise<TokenSaverState> {
    if (!this.options.accounts) throw new Error('Provider-account service is unavailable')
    await this.options.accounts.disconnect(id)
    return this.emit()
  }

  async refreshAccounts(): Promise<TokenSaverState> {
    if (!this.options.accounts) return this.state()
    await this.options.accounts.refresh()
    return this.emit()
  }

  /** Retrieve an ND-local original payload by a recovery reference. */
  recover(ref: string): string {
    if (!/^ndts-\d+-[0-9a-f-]{36}$/i.test(ref)) throw new Error('Invalid Token Saver recovery reference')
    return readFileSync(join(this.recoveryDir, `${ref}.txt`), 'utf8')
  }

  optimize(text: string, options: OptimizeOptions = {}): TokenSaverOptimization {
    const original = text
    if (!this.settingsValue.ndEnabled || this.settingsValue.mode === 'off') {
      return unchanged(original)
    }

    try {
      const optimized = nativeOptimize(original, options)
      const saved = Math.max(0, original.length - optimized.length)
      const worthUsing = saved >= MIN_SAVINGS_CHARS
      const result = worthUsing ? optimized : original
      const kind = options.kind ?? 'generic'
      const recoveryRef = result !== original && kind !== 'prompt'
        ? this.storeRecovery(original)
        : undefined
      this.countersValue.originalChars += original.length
      this.countersValue.optimizedChars += result.length
      this.countersValue.avoidedChars += Math.max(0, original.length - result.length)
      this.countersValue.operations += 1
      this.persist()
      const outcome: TokenSaverOptimization = {
        text: result,
        originalChars: original.length,
        optimizedChars: result.length,
        avoidedChars: Math.max(0, original.length - result.length),
        optimizer: 'nd-native',
        changed: result !== original,
        fallback: false,
        ...(recoveryRef ? { recoveryRef } : {}),
      }
      this.emit()
      return outcome
    } catch (error) {
      if (!this.settingsValue.qualityProtection) throw error
      this.countersValue.originalChars += original.length
      this.countersValue.optimizedChars += original.length
      this.countersValue.operations += 1
      this.countersValue.fallbacks += 1
      this.persist()
      const outcome: TokenSaverOptimization = { ...unchanged(original), fallback: true }
      this.emit()
      return outcome
    }
  }

  private async reconcileExternal(previous: TokenSaverSettings, next: TokenSaverSettings): Promise<void> {
    const controller = this.options.external
    if (!controller) return
    const wasCodex = externalCodexEnabled(previous)
    const wantsCodex = externalCodexEnabled(next)
    if (wasCodex === wantsCodex) return
    if (wantsCodex) await controller.enableCodex()
    else await controller.disableCodex()
  }

  private storeRecovery(original: string): string {
    mkdirSync(this.recoveryDir, { recursive: true })
    const ref = `ndts-${Date.now()}-${randomUUID()}`
    writeFileSync(join(this.recoveryDir, `${ref}.txt`), original, 'utf8')
    this.pruneRecovery()
    return ref
  }

  private pruneRecovery(): void {
    try {
      const files = readdirSync(this.recoveryDir)
        .filter((name) => /^ndts-\d+-[0-9a-f-]{36}\.txt$/i.test(name))
        .sort()
        .reverse()
      for (const name of files.slice(MAX_RECOVERY_ITEMS)) {
        try { rmSync(join(this.recoveryDir, name), { force: true }) } catch { /* best effort */ }
      }
    } catch {
      // Recovery pruning is best effort. A write failure is handled by optimize().
    }
  }

  private emit(): TokenSaverState {
    const next = this.state()
    this.onChanged?.(next)
    return next
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') return
      const record = parsed as Record<string, unknown>
      if (record.version !== 1) return
      this.settingsValue = sanitizeSettings(record.settings, defaultTokenSaverSettings())
      this.countersValue = sanitizeCounters(record.counters)
    } catch {
      // First run or an unreadable snapshot falls back to safe defaults.
    }
  }

  private persist(): void {
    const snapshot: Snapshot = {
      version: 1,
      settings: this.settingsValue,
      counters: this.countersValue,
    }
    writeJsonAtomic(this.filePath, snapshot)
  }
}

/**
 * Conservative built-in compaction.
 *
 * Prompt mode never removes arbitrary middle content: it only normalizes line
 * endings/trailing whitespace/excessive blank runs. Generic/tool payloads may
 * additionally collapse repeated lines and clip an oversized middle while
 * preserving the head and tail. Quality protection falls back to the original.
 */
function nativeOptimize(input: string, options: OptimizeOptions): string {
  if (input.length < 2_000) return input
  const maxChars = Math.max(4_000, options.maxChars ?? DEFAULT_MAX_CHARS)
  const kind = options.kind ?? 'generic'
  const normalized = input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')

  if (kind === 'prompt') return normalized

  const lines = normalized.split('\n')
  const output: string[] = []
  let previous = ''
  let repeats = 0

  const flushRepeats = (): void => {
    if (repeats > 1) output.push(`[ND Token Saver: ${repeats} identical lines omitted]`)
    else if (repeats === 1) output.push(previous)
    repeats = 0
  }

  for (const line of lines) {
    if (line === previous && line.trim().length > 0) {
      repeats += 1
      continue
    }
    flushRepeats()
    output.push(line)
    previous = line
  }
  flushRepeats()

  const compacted = output.join('\n')
  if (compacted.length <= maxChars) return compacted

  const marker = '\n\n[ND Token Saver: middle of oversized payload omitted; original retained locally]\n\n'
  const budget = Math.max(1_000, maxChars - marker.length)
  const head = Math.ceil(budget * 0.65)
  const tail = Math.floor(budget * 0.35)
  return `${compacted.slice(0, head)}${marker}${compacted.slice(-tail)}`
}

function externalCodexEnabled(settings: TokenSaverSettings): boolean {
  return settings.externalEnabled && settings.externalApps.codex === true
}

function detectExternalApps(settings: TokenSaverSettings, installer: TokenSaverInstallerState): TokenSaverExternalAppState[] {
  // Detection remains non-invasive: no process injection, HTTPS interception,
  // or credential reading. Only well-known local config paths are checked.
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const codexDetected = Boolean(home) && (
    existsSync(join(home, '.codex'))
    || existsSync(join(home, '.config', 'codex'))
  )
  const antigravityDetected = Boolean(home) && (
    existsSync(join(home, '.antigravity'))
    || existsSync(join(home, '.config', 'antigravity'))
  )

  return [
    {
      id: 'codex',
      name: 'Codex',
      detected: codexDetected,
      supported: installer.supported,
      enabled: externalCodexEnabled(settings),
      managed: installer.codexManaged,
      support: installer.supported ? 'full' : 'unsupported',
      ...(installer.supported
        ? { detail: 'One-click external optimization. ND installs, verifies, backs up, and restores the integration automatically.' }
        : installer.detail ? { detail: installer.detail } : {}),
    },
    {
      id: 'antigravity',
      name: 'Antigravity',
      detected: antigravityDetected,
      supported: false,
      enabled: false,
      managed: false,
      support: 'limited',
      detail: 'Antigravity account sign-in is supported in this release. External app optimization stays off until a safe global integration is available.',
    },
  ]
}

function sanitizeSettings(value: unknown, fallback: TokenSaverSettings): TokenSaverSettings {
  if (!value || typeof value !== 'object') return structuredClone(fallback)
  const record = value as Record<string, unknown>
  const mode = record.mode === 'off' || record.mode === 'advanced' || record.mode === 'automatic'
    ? record.mode
    : fallback.mode
  const externalApps: TokenSaverSettings['externalApps'] = {}
  if (record.externalApps && typeof record.externalApps === 'object' && !Array.isArray(record.externalApps)) {
    const apps = record.externalApps as Record<string, unknown>
    if (typeof apps.codex === 'boolean') externalApps.codex = apps.codex
    // Antigravity is intentionally not externally enableable in this beta.
  }
  return {
    version: 1,
    ndEnabled: record.ndEnabled !== false,
    mode,
    externalEnabled: record.externalEnabled === true,
    externalApps,
    qualityProtection: record.qualityProtection !== false,
  }
}

function sanitizeCounters(value: unknown): TokenSaverCounters {
  if (!value || typeof value !== 'object') return emptyTokenSaverCounters()
  const record = value as Record<string, unknown>
  const number = (key: keyof TokenSaverCounters): number => {
    const raw = record[key]
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0
  }
  return {
    originalChars: number('originalChars'),
    optimizedChars: number('optimizedChars'),
    avoidedChars: number('avoidedChars'),
    operations: number('operations'),
    fallbacks: number('fallbacks'),
  }
}

function unchanged(text: string): TokenSaverOptimization {
  return {
    text,
    originalChars: text.length,
    optimizedChars: text.length,
    avoidedChars: 0,
    optimizer: 'nd-native',
    changed: false,
    fallback: false,
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(temp, path)
  } catch (error) {
    try { rmSync(temp, { force: true }) } catch { /* best effort */ }
    throw error
  }
}
