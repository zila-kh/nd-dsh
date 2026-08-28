import { spawn } from 'node:child_process'

const MAX_CAPTURE_CHARS = 32_000
const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1_000

export interface VerificationEvidence {
  status: 'passed' | 'failed' | 'skipped'
  command?: string
  cwd?: string
  startedAt: number
  completedAt: number
  durationMs: number
  exitCode?: number
  stdout?: string
  stderr?: string
  reason?: string
}

/**
 * Run the deterministic project check owned by ND. The reviewer may add
 * semantic judgment later, but it cannot turn a red machine check green.
 */
export async function runVerification(command: string | undefined, cwd: string | undefined): Promise<VerificationEvidence> {
  const startedAt = Date.now()
  const cleaned = command?.trim()
  if (!cleaned) return finish({ status: 'skipped', startedAt, reason: 'Project has no configured test command.' })
  if (!cwd) return finish({ status: 'failed', command: cleaned, startedAt, reason: 'Configured verification command has no project workspace.' })

  const timeoutMs = verificationTimeoutMs()
  return new Promise<VerificationEvidence>((resolve) => {
    const child = spawn(cleaned, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const capture = (current: string, chunk: Buffer | string): string => `${current}${String(chunk)}`.slice(-MAX_CAPTURE_CHARS)
    child.stdout?.on('data', (chunk) => { stdout = capture(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = capture(stderr, chunk) })

    const done = (value: Omit<VerificationEvidence, 'completedAt' | 'durationMs'>): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(finish(value))
    }

    child.once('error', (error) => done({
      status: 'failed', command: cleaned, cwd, startedAt,
      stdout: cleanOutput(stdout), stderr: cleanOutput(stderr), reason: error.message,
    }))
    child.once('exit', (code, signal) => done({
      status: code === 0 ? 'passed' : 'failed', command: cleaned, cwd, startedAt,
      ...(typeof code === 'number' ? { exitCode: code } : {}),
      stdout: cleanOutput(stdout), stderr: cleanOutput(stderr),
      ...(code === 0 ? {} : { reason: `Verification command exited ${signal ?? String(code ?? 'without a code')}.` }),
    }))

    const timer = setTimeout(() => {
      try { child.kill(process.platform === 'win32' ? undefined : 'SIGTERM') } catch { /* already stopped */ }
      done({
        status: 'failed', command: cleaned, cwd, startedAt,
        stdout: cleanOutput(stdout), stderr: cleanOutput(stderr),
        reason: `Verification timed out after ${timeoutMs}ms.`,
      })
    }, timeoutMs)
    timer.unref()
  })
}

export function formatVerificationEvidence(evidence: VerificationEvidence): string {
  return `\n\n<nd-dsh-verification>${JSON.stringify(evidence)}</nd-dsh-verification>`
}

function verificationTimeoutMs(value = process.env.ND_DSH_VERIFY_TIMEOUT_MS): number {
  const parsed = value ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_VERIFY_TIMEOUT_MS
  return Math.max(30_000, Math.min(parsed, 30 * 60 * 1_000))
}

function finish(value: Omit<VerificationEvidence, 'completedAt' | 'durationMs'>): VerificationEvidence {
  const completedAt = Date.now()
  return { ...value, completedAt, durationMs: Math.max(0, completedAt - value.startedAt) }
}

function cleanOutput(value: string): string | undefined {
  const cleaned = value.trim()
  return cleaned || undefined
}
