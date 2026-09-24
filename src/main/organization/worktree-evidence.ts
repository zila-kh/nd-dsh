import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { EvidenceSource } from '../../shared/organization-control.js'

const execFileAsync = promisify(execFile)
const MAX_GIT_METADATA_BYTES = 16 * 1024 * 1024
const MAX_GIT_DIFF_BYTES = 512 * 1024 * 1024
const MAX_UNTRACKED_FILES = 50_000
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024 * 1024
const MAX_UNTRACKED_TOTAL_BYTES = 1024 * 1024 * 1024

export interface WorkspaceEvidenceCapture {
  fingerprint: string
  exact: boolean
  source: EvidenceSource
  changedFiles: string[]
  gitHead?: string
  capturedAt: number
}

/**
 * Bind review evidence to the exact current worktree state. Tracked changes use
 * Git's binary diff and untracked files are hashed separately so adding a new
 * source file invalidates an older receipt as reliably as editing a tracked one.
 */
export async function captureWorkspaceEvidence(workspacePath: string | undefined): Promise<WorkspaceEvidenceCapture> {
  const capturedAt = Date.now()
  if (!workspacePath) return unavailable('missing-workspace', capturedAt)

  try {
    const cwd = resolve(workspacePath)
    const [headResult, trackedNamesResult, untrackedResult] = await Promise.allSettled([
      runGit(cwd, ['rev-parse', 'HEAD']),
      runGit(cwd, ['diff', '--name-only', 'HEAD', '--', '.']),
      runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    if (headResult.status === 'rejected') throw headResult.reason
    if (trackedNamesResult.status === 'rejected') throw trackedNamesResult.reason
    if (untrackedResult.status === 'rejected') throw untrackedResult.reason

    const { stdout: headRaw } = headResult.value
    const { stdout: trackedNames } = trackedNamesResult.value
    const { stdout: untrackedRaw } = untrackedResult.value

    const gitHead = headRaw.trim()
    const untracked = untrackedRaw.split('\0').map((item) => item.trim()).filter(Boolean).sort()
    if (untracked.length > MAX_UNTRACKED_FILES) throw new Error('Untracked file count exceeds the workspace evidence bound')
    const untrackedHashes: string[] = []
    let untrackedBytes = 0
    for (const relativePath of untracked) {
      const file = resolve(cwd, relativePath)
      const stat = await fs.lstat(file)
      if (stat.isSymbolicLink()) {
        untrackedHashes.push(`${relativePath}\0symlink\0${await fs.readlink(file)}`)
        continue
      }
      if (!stat.isFile()) throw new Error(`Unsupported untracked workspace entry: ${relativePath}`)
      if (stat.size > MAX_UNTRACKED_FILE_BYTES) throw new Error(`Untracked file exceeds the ${MAX_UNTRACKED_FILE_BYTES}-byte evidence bound: ${relativePath}`)
      const remainingBytes = MAX_UNTRACKED_TOTAL_BYTES - untrackedBytes
      if (stat.size > remainingBytes) throw new Error('Untracked workspace content exceeds the aggregate evidence bound')
      const contentHash = createHash('sha256')
      const readBytes = await updateHashFromFile(contentHash, file, Math.min(MAX_UNTRACKED_FILE_BYTES, remainingBytes))
      untrackedBytes += readBytes
      untrackedHashes.push(`${relativePath}\0${contentHash.digest('hex')}`)
    }

    const changedFiles = Array.from(new Set([
      ...trackedNames.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...untracked,
    ])).sort()
    const hash = createHash('sha256')
    hash.update('nd-dsh-evidence-v1\0')
    hash.update(gitHead)
    hash.update('\0')
    await updateHashFromGit(cwd, ['diff', '--binary', 'HEAD', '--', '.'], hash, MAX_GIT_DIFF_BYTES)
    hash.update('\0')
    for (const item of untrackedHashes) {
      hash.update(item)
      hash.update('\0')
    }

    return {
      fingerprint: hash.digest('hex'),
      exact: true,
      source: 'git',
      changedFiles,
      gitHead,
      capturedAt,
    }
  } catch {
    return unavailable(workspacePath, capturedAt)
  }
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_METADATA_BYTES, windowsHide: true })
  return { stdout: result.stdout, stderr: result.stderr }
}

async function updateHashFromFile(hash: ReturnType<typeof createHash>, path: string, maxBytes: number): Promise<number> {
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error(`Workspace file exceeded the ${maxBytes}-byte streaming hash bound: ${path}`)
    hash.update(chunk)
  }
  return bytes
}

function updateHashFromGit(
  cwd: string,
  args: string[],
  hash: ReturnType<typeof createHash>,
  maxBytes: number,
): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let bytes = 0
    let stderr = ''
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* process already exited */ }
      reject(error)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        fail(new Error(`Git diff exceeded the ${maxBytes}-byte workspace evidence bound`))
        return
      }
      hash.update(chunk)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8_192) })
    child.once('error', (error) => fail(error))
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Git evidence command exited ${signal ?? String(code)}`))
        return
      }
      resolvePromise(bytes)
    })
  })
}

function unavailable(seed: string, capturedAt: number): WorkspaceEvidenceCapture {
  return {
    fingerprint: createHash('sha256').update(`nd-dsh-unavailable-v1\0${seed}`).digest('hex'),
    exact: false,
    source: 'workspace-unavailable',
    changedFiles: [],
    capturedAt,
  }
}
