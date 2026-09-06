import { spawn, type ChildProcess } from 'node:child_process'

/**
 * Shared plumbing for the direct CLI-agent engines (Claude Code, Cursor,
 * Pi). Each engine keeps its own session/protocol state; this module only
 * centralizes the pieces that must behave identically everywhere: deferred
 * turns, CLI spawn resolution for `.cmd`/`.bat` shims, result summarization,
 * and whole-tree child teardown.
 */

export const TRANSCRIPT_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'agent/reasoning', 'tool/call', 'tool/result'])
export const RESULT_SNIPPET_MAX_CHARS = 4_000

/** Minimal single-shot deferred: turns settle exactly once via notification. */
export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolveRef) => { resolve = resolveRef })
  return { promise, resolve }
}

/**
 * Spawn a resolved CLI entry. npm-installed CLIs resolve to `.cmd`/`.bat`
 * shims on Windows, which Node refuses to spawn directly, so those go
 * through `cmd.exe /d /s /c`; everything else spawns as-is.
 */
export function spawnCliCommand(
  spawnProcess: typeof spawn,
  bin: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
): ChildProcess {
  const shimmed = /\.(cmd|bat)$/i.test(bin)
  if (!shimmed) return spawnProcess(bin, args, options)
  const command = [bin, ...args].map((part) => (/[\s"^&|<>]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part)).join(' ')
  return spawnProcess('cmd.exe', ['/d', '/s', '/c', command], { ...options, windowsVerbatimArguments: true })
}

export function summarize(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  const cleaned = (text ?? '').trim()
  if (cleaned.length <= RESULT_SNIPPET_MAX_CHARS) return cleaned
  return `${cleaned.slice(0, RESULT_SNIPPET_MAX_CHARS - 1)}…`
}

/** Terminate the whole child tree; SIGTERM first, then hard teardown. */
export async function killProcessTree(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const pid = child.pid as number
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          try { process.kill(-pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      } catch {
        // Already gone.
      }
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}

/** Environment for engine children: ND control-plane variables never leak. */
export function engineEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
    environment[key] = value
  }
  return environment
}
