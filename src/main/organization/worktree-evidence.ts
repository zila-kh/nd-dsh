import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type { EvidenceSource } from '../../shared/organization-control.js'

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 24 * 1024 * 1024

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
    const [{ stdout: headRaw }, { stdout: diff }, { stdout: trackedNames }, { stdout: untrackedRaw }] = await Promise.all([
      runGit(cwd, ['rev-parse', 'HEAD']),
      runGit(cwd, ['diff', '--binary', 'HEAD', '--', '.']),
      runGit(cwd, ['diff', '--name-only', 'HEAD', '--', '.']),
      runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])

    const gitHead = headRaw.trim()
    const untracked = untrackedRaw.split('\0').map((item) => item.trim()).filter(Boolean).sort()
    const untrackedHashes: string[] = []
    for (const relativePath of untracked) {
      const file = resolve(cwd, relativePath)
      try {
        const stat = await fs.stat(file)
        if (!stat.isFile()) continue
        const body = await fs.readFile(file)
        untrackedHashes.push(`${relativePath}\0${createHash('sha256').update(body).digest('hex')}`)
      } catch {
        untrackedHashes.push(`${relativePath}\0unreadable`)
      }
    }

    const changedFiles = Array.from(new Set([
      ...trackedNames.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...untracked,
    ])).sort()
    const hash = createHash('sha256')
    hash.update('nd-dsh-evidence-v1\0')
    hash.update(gitHead)
    hash.update('\0')
    hash.update(diff)
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
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT })
  return { stdout: result.stdout, stderr: result.stderr }
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
