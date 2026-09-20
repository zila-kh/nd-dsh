import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

/**
 * ND's own diagnostic log.
 *
 * A packaged desktop app has no console: when the main process throws on a
 * customer's machine, nothing is left to inspect and support can only guess.
 * This keeps a bounded rotating log under the app's userData, routes uncaught
 * exceptions and unhandled rejections into it, and mirrors console output so
 * the lines the code already writes survive past the window that produced them.
 *
 * Every line passes a redaction pass first. Logs are the artifact most likely
 * to leave a customer's machine, and provider keys, bearer headers, and
 * `*_API_KEY=` assignments must not travel with them.
 */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const MAX_LINE_CHARS = 4_000

/** Patterns whose captured value is replaced before a line is written. */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]{8,}\b/g, '$1…'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]'],
  [/(\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)("?)[^\s"',]{6,}\2/g, '$1[redacted]'],
  [/(\b(?:apiKey|api_key|accessToken|refreshToken|clientSecret)"\s*:\s*")[^"]{6,}"/gi, '$1[redacted]"'],
]

export function redactLogText(value: string): string {
  let redacted = value
  for (const [pattern, replacement] of SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement)
  return redacted
}

export interface LogFileOptions {
  /** Absolute path of the active log file. */
  path: string
  /** Rotation threshold; the previous generation is kept as `<path>.1`. */
  maxBytes?: number
  /** Also mirror console.log/warn/error into the file. */
  captureConsole?: boolean
}

export class LogFile {
  private readonly maxBytes: number
  private readonly captureConsole: boolean
  private readonly written = new Set<string>()
  private chain: Promise<void> = Promise.resolve()
  private bytes = 0
  private opened = false
  private exitRequested = false

  constructor(private readonly options: LogFileOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.captureConsole = options.captureConsole ?? true
  }

  /**
   * Create the log file and install process-level handlers. Called once, as
   * early as the app's userData path is known: a crash before this point has
   * nothing to write to.
   */
  async open(): Promise<void> {
    if (this.opened) return
    this.opened = true
    // Queued writes wait on this, so a line logged while the directory is still
    // being created lands in the file instead of racing it.
    const prepare = async (): Promise<void> => {
      await fs.mkdir(dirname(this.options.path), { recursive: true })
      this.bytes = await this.currentSize()
    }
    this.chain = this.chain.then(prepare, prepare)
    this.installProcessHandlers()
    if (this.captureConsole) this.installConsoleCapture()
    this.write('info', `ND-DSH ${process.versions.electron ?? ''} on ${process.platform} ${process.arch}, Node ${process.versions.node}, pid ${String(process.pid)}`)
    await this.chain.catch(() => undefined)
  }

  /** Append one line; never throws into the caller. */
  write(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.opened) return
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redactLogText(message).replaceAll(/\s*\r?\n\s*/g, ' ⏎ ').slice(0, MAX_LINE_CHARS)}\n`
    this.bytes += line.length
    const append = async (): Promise<void> => {
      try {
        if (this.bytes > this.maxBytes) await this.rotate()
        await fs.appendFile(this.options.path, line, 'utf8')
      } catch {
        // Logging must never take the app down with it.
      }
    }
    this.chain = this.chain.then(append, append)
  }

  /** Wait for queued lines; used by the shutdown path and by tests. */
  async flush(): Promise<void> {
    await this.chain.catch(() => undefined)
  }

  /** Path of the file the app is writing, for support instructions. */
  get path(): string {
    return this.options.path
  }

  private async currentSize(): Promise<number> {
    try {
      return (await fs.stat(this.options.path)).size
    } catch {
      return 0
    }
  }

  private async rotate(): Promise<void> {
    const previous = `${this.options.path}.1`
    await fs.rm(previous, { force: true })
    await fs.rename(this.options.path, previous).catch(() => undefined)
    this.bytes = 0
  }

  /**
   * Uncaught exceptions end the process: record one, flush, then exit rather
   * than leaving a half-dead app holding the single-instance lock. Unhandled
   * rejections are logged and tolerated — most come from a detached task the
   * user can still recover from by continuing to use the app.
   */
  private installProcessHandlers(): void {
    process.on('uncaughtException', (error) => {
      this.write('error', `uncaught exception: ${describe(error)}`)
      if (this.exitRequested) return
      this.exitRequested = true
      void this.flush().finally(() => process.exit(1))
    })
    process.on('unhandledRejection', (reason) => {
      this.write('error', `unhandled rejection: ${describe(reason)}`)
    })
  }

  private installConsoleCapture(): void {
    const original = { log: console.log, warn: console.warn, error: console.error }
    const mirror = (level: 'info' | 'warn' | 'error', source: (...args: unknown[]) => void) =>
      (...args: unknown[]): void => {
        this.write(level, args.map(formatArgument).join(' '))
        source.apply(console, args)
      }
    console.log = mirror('info', original.log)
    console.warn = mirror('warn', original.warn)
    console.error = mirror('error', original.error)
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
  return formatArgument(value)
}

function formatArgument(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * A unique sibling path for a quarantined file, so a retry never overwrites an
 * earlier quarantine of the same name.
 */
export function quarantinePathFor(filePath: string, now = Date.now()): string {
  return `${filePath}.corrupt-${String(now)}-${randomUUID().slice(0, 8)}`
}

/**
 * Preserve a file this build could not read and report where it went.
 *
 * Starting from an empty snapshot and then persisting it is how a customer
 * loses work: the unreadable file is the only copy of what they had. Moving it
 * aside keeps that copy for recovery and leaves a clear path to name in a
 * support conversation.
 */
export async function quarantineFile(filePath: string, cause: unknown): Promise<string | undefined> {
  const target = quarantinePathFor(filePath)
  try {
    await fs.rename(filePath, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    console.warn(`Could not quarantine unreadable file ${filePath}:`, error)
    return undefined
  }
  console.warn(`Unreadable file quarantined: ${filePath} -> ${target} (${describe(cause)})`)
  return target
}

/** The log directory for a userData path; exported so callers need no join. */
export function logFilePathFor(userData: string): string {
  return join(userData, 'logs', 'nd-dsh.log')
}
