import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_CAPTURE_CHARS = 32_000
const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1_000
const MAX_GIT_OUTPUT = 4 * 1024 * 1024

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
  artifacts?: Array<{ path: string; kind: 'file' | 'directory'; size: number; sha256: string }>
}

/**
 * Run the deterministic project check owned by ND. The reviewer may add
 * semantic judgment later, but it cannot turn a red machine check green.
 *
 * When verification runs inside an ND-owned task worktree, preserve the exact
 * checkpoint around the command. Test/build tools often create coverage,
 * caches, generated files, or other artifacts; none of those are allowed to
 * leak into review or the next retry attempt.
 */
export async function runVerification(command: string | undefined, cwd: string | undefined): Promise<VerificationEvidence> {
  const startedAt = Date.now()
  const cleaned = command?.trim()
  if (!cleaned) return finish({ status: 'skipped', startedAt, reason: 'Project has no configured test command.' })
  if (!cwd) return finish({ status: 'failed', command: cleaned, startedAt, reason: 'Configured verification command has no project workspace.' })

  let managedBaseline: string | undefined
  if (isManagedTaskWorktree(cwd)) {
    try {
      managedBaseline = await captureManagedBaseline(cwd)
    } catch (error) {
      return finish({ status: 'failed', command: cleaned, cwd, startedAt, reason: `Verification preflight failed: ${errorMessage(error)}` })
    }
  }

  const timeoutMs = verificationTimeoutMs()
  return new Promise<VerificationEvidence>((resolveEvidence) => {
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
    const outputFields = (): Pick<VerificationEvidence, 'stdout' | 'stderr'> => {
      const cleanStdout = cleanOutput(stdout)
      const cleanStderr = cleanOutput(stderr)
      return {
        ...(cleanStdout ? { stdout: cleanStdout } : {}),
        ...(cleanStderr ? { stderr: cleanStderr } : {}),
      }
    }
    child.stdout?.on('data', (chunk) => { stdout = capture(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = capture(stderr, chunk) })

    let timer: NodeJS.Timeout
    const done = async (value: Omit<VerificationEvidence, 'completedAt' | 'durationMs'>): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let result = value
      if (managedBaseline) {
        try {
          await restoreManagedBaseline(cwd, managedBaseline)
        } catch (error) {
          result = {
            ...value,
            status: 'failed',
            reason: [value.reason, `Verification cleanup failed: ${errorMessage(error)}`].filter(Boolean).join(' '),
          }
        }
      }
      resolveEvidence(finish(result))
    }

    child.once('error', (error) => { void done({
      status: 'failed', command: cleaned, cwd, startedAt,
      ...outputFields(), reason: error.message,
    }) })
    child.once('exit', (code, signal) => { void done({
      status: code === 0 ? 'passed' : 'failed', command: cleaned, cwd, startedAt,
      ...(typeof code === 'number' ? { exitCode: code } : {}),
      ...outputFields(),
      ...(code === 0 ? {} : { reason: `Verification command exited ${signal ?? String(code ?? 'without a code')}.` }),
    }) })

    timer = setTimeout(() => {
      try { child.kill(process.platform === 'win32' ? undefined : 'SIGTERM') } catch { /* already stopped */ }
      void done({
        status: 'failed', command: cleaned, cwd, startedAt,
        ...outputFields(), reason: `Verification timed out after ${timeoutMs}ms.`,
      })
    }, timeoutMs)
    timer.unref()
  })
}

export async function runArtifactVerification(paths: string[] | undefined, cwd: string | undefined): Promise<VerificationEvidence> {
  const startedAt = Date.now()
  if (!cwd) return finish({ status: 'failed', startedAt, reason: 'Artifact verification has no project workspace.' })
  const requested = [...new Set((paths ?? []).map((value) => value.trim()).filter(Boolean))]
  if (!requested.length) return finish({ status: 'failed', cwd, startedAt, reason: 'Artifact task declared no artifact paths.' })
  const root = resolve(cwd)
  const artifacts: NonNullable<VerificationEvidence['artifacts']> = []
  try {
    for (const requestedPath of requested) {
      if (isAbsolute(requestedPath)) throw new Error('Artifact path must be relative: ' + requestedPath)
      const target = resolve(root, requestedPath)
      const rel = relative(root, target)
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Artifact path escapes the task workspace: ' + requestedPath)
      artifacts.push(await fingerprintArtifact(root, target, requestedPath))
    }
    return finish({ status: 'passed', cwd, startedAt, artifacts })
  } catch (error) {
    return finish({ status: 'failed', cwd, startedAt, artifacts, reason: `Artifact verification failed: ${errorMessage(error)}` })
  }
}

async function fingerprintArtifact(root: string, target: string, displayPath: string): Promise<NonNullable<VerificationEvidence['artifacts']>[number]> {
  const stat = await fs.lstat(target)
  if (stat.isSymbolicLink()) throw new Error('Artifact path may not be a symbolic link: ' + displayPath)
  const hash = createHash('sha256')
  let size = 0
  if (stat.isFile()) {
    const bytes = await fs.readFile(target)
    size = bytes.length
    hash.update(bytes)
    return { path: displayPath, kind: 'file', size, sha256: hash.digest('hex') }
  }
  if (!stat.isDirectory()) throw new Error('Artifact path is not a regular file or directory: ' + displayPath)
  const walk = async (directory: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const candidate = resolve(directory, entry.name)
      const rel = relative(root, candidate).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) throw new Error('Artifact directory contains a symbolic link: ' + rel)
      hash.update(rel + '\0')
      if (entry.isDirectory()) {
        await walk(candidate)
        continue
      }
      if (!entry.isFile()) throw new Error('Artifact directory contains an unsupported entry: ' + rel)
      const bytes = await fs.readFile(candidate)
      size += bytes.length
      if (size > 64 * 1024 * 1024) throw new Error('Artifact evidence exceeds the 64 MiB verification bound')
      hash.update(bytes)
    }
  }
  await walk(target)
  return { path: displayPath, kind: 'directory', size, sha256: hash.digest('hex') }
}

export function formatVerificationEvidence(evidence: VerificationEvidence): string {
  return `\n\n<nd-dsh-verification>${JSON.stringify(evidence)}</nd-dsh-verification>`
}

function isManagedTaskWorktree(cwd: string): boolean {
  return resolve(cwd).split(sep).includes('.nd-dsh-worktrees')
}

async function captureManagedBaseline(cwd: string): Promise<string> {
  const [head, status] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
  ])
  if (status.trim()) throw new Error('ND task worktree is dirty before machine verification')
  const baseline = head.trim()
  if (!baseline) throw new Error('ND task worktree has no Git HEAD before machine verification')
  return baseline
}

async function restoreManagedBaseline(cwd: string, baseline: string): Promise<void> {
  await git(cwd, ['reset', '--hard', baseline])
  await git(cwd, ['clean', '-fd', '--'])
  const [head, status] = await Promise.all([
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']),
  ])
  if (head.trim() !== baseline || status.trim()) throw new Error('ND task worktree did not return to its verification checkpoint')
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT })
  return result.stdout
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

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}
