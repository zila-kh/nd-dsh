import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 24 * 1024 * 1024

export interface TaskWorktree {
  root: string
  repoRoot: string
  branch: string
  taskId: string
}

export class TaskWorktreeManager {
  /**
   * Create or recover a deterministic worktree for a task. A new worktree is
   * created only from a clean base workspace so the branch cannot silently omit
   * local human changes. Existing task branches/worktrees remain recoverable
   * after restart even when the base later becomes dirty.
   */
  async ensure(projectWorkspace: string | undefined, taskId: string): Promise<TaskWorktree | undefined> {
    if (!projectWorkspace) return undefined
    const repoRoot = await repositoryRoot(projectWorkspace).catch(() => undefined)
    if (!repoRoot) return undefined
    const descriptor = describe(repoRoot, taskId)
    if (await isAttachedWorktree(descriptor.root)) return descriptor

    await fs.mkdir(dirname(descriptor.root), { recursive: true })
    if (await pathExists(descriptor.root)) {
      throw new Error(`ND task worktree path already exists but is not a Git worktree: ${descriptor.root}`)
    }

    await git(repoRoot, ['worktree', 'prune'])
    if (await branchExists(repoRoot, descriptor.branch)) {
      await git(repoRoot, ['worktree', 'add', descriptor.root, descriptor.branch])
      return descriptor
    }

    const status = await git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (status.stdout.trim()) return undefined
    await git(repoRoot, ['worktree', 'add', '-b', descriptor.branch, descriptor.root, 'HEAD'])
    return descriptor
  }

  async existing(projectWorkspace: string | undefined, taskId: string): Promise<TaskWorktree | undefined> {
    if (!projectWorkspace) return undefined
    const repoRoot = await repositoryRoot(projectWorkspace).catch(() => undefined)
    if (!repoRoot) return undefined
    const descriptor = describe(repoRoot, taskId)
    return await isAttachedWorktree(descriptor.root) ? descriptor : undefined
  }

  /** Freeze the worker result into the task branch before independent review. */
  async checkpoint(worktree: TaskWorktree, title: string): Promise<string> {
    const status = await git(worktree.root, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (status.stdout.trim()) {
      await git(worktree.root, ['add', '-A', '--'])
      await git(worktree.root, [
        '-c', 'user.name=ND-DSH',
        '-c', 'user.email=nd-dsh@local',
        'commit', '-m', `nd-dsh: ${title.slice(0, 120)}`,
      ])
    }
    return (await git(worktree.root, ['rev-parse', 'HEAD'])).stdout.trim()
  }

  /**
   * Merge a verified task branch into the project's real checkout. Never
   * auto-resolve conflicts and never merge over human/uncommitted base changes.
   */
  async integrate(projectWorkspace: string | undefined, taskId: string): Promise<{ merged: boolean; head: string }> {
    if (!projectWorkspace) throw new Error('Task integration requires a project workspace')
    const repoRoot = await repositoryRoot(projectWorkspace)
    const descriptor = describe(repoRoot, taskId)
    if (!(await branchExists(repoRoot, descriptor.branch))) {
      throw new Error(`Task branch ${descriptor.branch} is missing; cannot integrate verified work`)
    }
    const taskStatus = await git(descriptor.root, ['status', '--porcelain=v1', '--untracked-files=all']).catch(() => undefined)
    if (!taskStatus || taskStatus.stdout.trim()) throw new Error('Task worktree changed after its review checkpoint; re-run review before integration')

    const baseStatus = await git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
    if (baseStatus.stdout.trim()) throw new Error('Project workspace has uncommitted human/local changes; integration is paused instead of overwriting them')

    const alreadyMerged = await isAncestor(repoRoot, descriptor.branch, 'HEAD')
    if (alreadyMerged) return { merged: false, head: (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim() }

    try {
      await git(repoRoot, [
        '-c', 'user.name=ND-DSH',
        '-c', 'user.email=nd-dsh@local',
        'merge', '--no-ff', '--no-edit', descriptor.branch,
      ])
    } catch (error) {
      await git(repoRoot, ['merge', '--abort']).catch(() => undefined)
      throw new Error(`Task integration conflict for ${taskId}; ND left the task branch intact for explicit rework. ${errorMessage(error)}`)
    }
    return { merged: true, head: (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim() }
  }

  path(projectWorkspace: string, taskId: string): Promise<string | undefined> {
    return repositoryRoot(projectWorkspace)
      .then((repoRoot) => describe(repoRoot, taskId).root)
      .catch(() => undefined)
  }
}

export async function taskEvidenceWorkspace(projectWorkspace: string | undefined, taskId: string): Promise<string | undefined> {
  if (!projectWorkspace) return undefined
  const repoRoot = await repositoryRoot(projectWorkspace).catch(() => undefined)
  if (!repoRoot) return projectWorkspace
  const candidate = describe(repoRoot, taskId).root
  return await isAttachedWorktree(candidate) ? candidate : projectWorkspace
}

function describe(repoRoot: string, taskId: string): TaskWorktree {
  const repoKey = createHash('sha256').update(resolve(repoRoot)).digest('hex').slice(0, 12)
  const taskKey = safeTaskKey(taskId)
  return {
    repoRoot,
    taskId,
    branch: `nd-dsh/task-${taskKey}`,
    root: join(dirname(repoRoot), '.nd-dsh-worktrees', repoKey, taskKey),
  }
}

function safeTaskKey(taskId: string): string {
  const readable = taskId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'task'
  const digest = createHash('sha256').update(taskId).digest('hex').slice(0, 8)
  return `${readable}-${digest}`
}

async function repositoryRoot(cwd: string): Promise<string> {
  return resolve((await git(resolve(cwd), ['rev-parse', '--show-toplevel'])).stdout.trim())
}

async function isAttachedWorktree(path: string): Promise<boolean> {
  if (!(await pathExists(path))) return false
  try {
    const root = resolve((await git(path, ['rev-parse', '--show-toplevel'])).stdout.trim())
    return root === resolve(path)
  } catch {
    return false
  }
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

async function isAncestor(repoRoot: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(repoRoot, ['merge-base', '--is-ancestor', ancestor, descendant])
    return true
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try { await fs.stat(path); return true } catch { return false }
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT })
  return { stdout: result.stdout, stderr: result.stderr }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = (error as { stderr?: unknown }).stderr
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}
