import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import type {
  TokenSaverCounters,
  TokenSaverExternalAppState,
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

interface OptimizeOptions {
  kind?: 'prompt' | 'tool-output' | 'generic'
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 32_000
const MIN_SAVINGS_CHARS = 256

/**
 * ND-owned orchestration layer for token saving.
 *
 * V1 deliberately ships with a conservative native optimizer so ND-only
 * saving works without any external binary. RTK/Caveman remain replaceable
 * adapters behind this service in later commits/releases.
 */
export class TokenSaverService {
  private settingsValue = defaultTokenSaverSettings()
  private countersValue = emptyTokenSaverCounters()
  private onChanged?: (state: TokenSaverState) => void

  constructor(private readonly filePath: string) {
    this.load()
  }

  setOnChanged(listener: ((state: TokenSaverState) => void) | undefined): void {
    this.onChanged = listener
  }

  state(): TokenSaverState {
    return {
      settings: structuredClone(this.settingsValue),
      counters: { ...this.countersValue },
      externalApps: detectExternalApps(this.settingsValue),
      optimizers: [
        { id: 'nd-native', available: true, detail: 'Built in to ND' },
        { id: 'rtk', available: false, detail: 'Adapter slot reserved; not required for ND-only saving' },
        { id: 'caveman', available: false, detail: 'Adapter slot reserved; not required for ND-only saving' },
      ],
    }
  }

  settings(): TokenSaverSettings {
    return structuredClone(this.settingsValue)
  }

  updateSettings(value: unknown): TokenSaverState {
    this.settingsValue = sanitizeSettings(value, this.settingsValue)
    this.persist()
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
      this.countersValue.originalChars += original.length
      this.countersValue.optimizedChars += result.length
      this.countersValue.avoidedChars += Math.max(0, original.length - result.length)
      this.countersValue.operations += 1
      this.persist()
      return {
        text: result,
        originalChars: original.length,
        optimizedChars: result.length,
        avoidedChars: Math.max(0, original.length - result.length),
        optimizer: 'nd-native',
        changed: result !== original,
        fallback: false,
      }
    } catch (error) {
      if (!this.settingsValue.qualityProtection) throw error
      this.countersValue.originalChars += original.length
      this.countersValue.optimizedChars += original.length
      this.countersValue.operations += 1
      this.countersValue.fallbacks += 1
      this.persist()
      return {
        ...unchanged(original),
        fallback: true,
      }
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
 * Conservative built-in compaction. It removes repeated blank space, collapses
 * long runs of identical lines, and clips huge payloads while preserving both
 * the beginning and end. This is intentionally deterministic and reversible
 * by falling back to the original when the savings are too small.
 */
function nativeOptimize(input: string, options: OptimizeOptions): string {
  if (input.length < 2_000) return input
  const maxChars = Math.max(4_000, options.maxChars ?? DEFAULT_MAX_CHARS)
  const normalized = input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')

  const lines = normalized.split('\n')
  const output: string[] = []
  let previous = ''
  let repeats = 0

  const flushRepeats = (): void => {
    if (repeats > 1) output.push(`[ND Token Saver: ${repeats} identical lines omitted]`)
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

function detectExternalApps(settings: TokenSaverSettings): TokenSaverExternalAppState[] {
  // Detection remains non-invasive. We only report installations that can be
  // inferred from well-known config/home paths. No process injection, network
  // interception, or credential reading happens here.
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const codexDetected = Boolean(home) && (
    existsSync(join(home, '.codex'))
    || existsSync(join(home, '.config', 'codex'))
  )

  return [
    {
      id: 'codex',
      name: 'Codex',
      detected: codexDetected,
      supported: true,
      enabled: settings.externalEnabled && settings.externalApps.codex === true,
      support: 'full',
      detail: 'Uses Codex-native configuration/authentication; external optimization is optional.',
    },
  ]
}

function sanitizeSettings(value: unknown, fallback: TokenSaverSettings): TokenSaverSettings {
  if (!value || typeof value !== 'object') return structuredClone(fallback)
  const record = value as Record<string, unknown>
  const mode = record.mode === 'off' || record.mode === 'advanced' || record.mode === 'automatic'
    ? record.mode
    : fallback.mode
  const externalApps: Record<string, boolean> = {}
  if (record.externalApps && typeof record.externalApps === 'object' && !Array.isArray(record.externalApps)) {
    for (const [id, enabled] of Object.entries(record.externalApps as Record<string, unknown>)) {
      if (/^[a-z0-9._-]{1,128}$/i.test(id)) externalApps[id] = enabled === true
    }
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
