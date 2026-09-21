import type { CoreClient } from './core-client.js'
import type { WorktreeGitRunner } from '../organization/task-worktree.js'

interface CoreGitResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
}

export function createCoreWorktreeGit(core: Pick<CoreClient, 'request'>): WorktreeGitRunner {
  return async (cwd, args) => {
    const result = await core.request<CoreGitResult>('git.exec', {
      cwd,
      args,
      maxOutputBytes: 24 * 1024 * 1024,
    }, 60_000)
    if (result.truncated) throw new Error('Task-worktree Git output exceeded the ND Core safety bound.')
    if (result.exitCode !== 0) {
      const error = new Error(result.stderr.trim() || 'Task-worktree Git command failed.') as Error & { stderr?: string; stdout?: string }
      error.stderr = result.stderr
      error.stdout = result.stdout
      throw error
    }
    return { stdout: result.stdout, stderr: result.stderr }
  }
}
