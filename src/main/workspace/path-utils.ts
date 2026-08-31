import { resolve, sep } from 'node:path'

export function resolveInside(root: string, relativePath = '.'): string {
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, relativePath)
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes the selected workspace')
  }
  return candidate
}

/**
 * Whether an absolute path belongs to the active workspace: it is the workspace
 * root itself or a descendant (delegated task worktrees, open subfolders).
 * Used to scope chat listings so switching company/project/workspace only shows
 * that context's sessions.
 *
 * On Windows the comparison is case-insensitive: the underlying filesystem is,
 * and Git/worktree paths can arrive in a different case than the workspace root
 * (a case-sensitive check would wrongly hide sessions that belong here).
 */
export function isWithinWorkspace(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  const normalize = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value)
  const rootNorm = normalize(resolvedRoot)
  const candidateNorm = normalize(resolvedCandidate)
  return candidateNorm === rootNorm || candidateNorm.startsWith(`${rootNorm}${sep}`)
}

/**
 * Whether a session's recorded cwd keeps it in the active workspace's chat
 * list. Sessions record their project cwd at create time; a session belongs
 * here when that cwd is the workspace root or a descendant (delegated task
 * worktrees, open subfolders). A session with no usable cwd cannot be
 * attributed to another workspace, so it is kept rather than hidden.
 */
export function sessionInWorkspace(root: string, cwd: unknown): boolean {
  if (typeof cwd !== 'string' || !cwd.trim()) return true
  return isWithinWorkspace(root, cwd)
}
