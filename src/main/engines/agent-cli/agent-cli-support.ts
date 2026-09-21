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
  const pid = child.pid

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { child.kill() } catch { /* Already gone. */ }
        resolve()
      }
      child.once('exit', finish)
      const timer = setTimeout(finish, 3_000)
      try {
        const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.once('close', finish)
        killer.once('error', finish)
      } catch {
        // Already handled.
      }
      try {
        child.kill()
      } catch {
        // Already gone.
      }
    })
    return
  }

  let groupSignalled = false
  try {
    process.kill(-pid, 'SIGTERM')
    groupSignalled = true
  } catch {
    try { child.kill('SIGTERM') } catch { return }
  }

  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      try {
        if (groupSignalled) process.kill(-pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        // Already gone.
      }
      finish()
    }, 3_000)
    child.once('exit', () => {
      if (!groupSignalled) {
        finish()
        return
      }
      try {
        process.kill(-pid, 0)
      } catch {
        finish()
      }
    })
  })
}

/**
 * Environment intentionally forwarded to user-installed coding CLIs.
 * ND control-plane variables and safeStorage provider credentials are not
 * injected here; vendor CLI auth already present in the user's OS environment
 * remains available to the CLI exactly as it was before the Rust migration.
 */
export function engineEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
    environment[key] = value
  }
  return environment
}
