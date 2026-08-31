import { sessionInWorkspace } from '../workspace/path-utils.js'

function isSessionLike(value: unknown): value is { sessionId: string } {
  return typeof value === 'object' && value !== null && typeof (value as { sessionId?: unknown }).sessionId === 'string'
}

/**
 * Scope a raw session.list value to the active workspace and stamp ND archive
 * flags on the surviving rows. Pure so the renderer-facing listing contract is
 * unit-testable without booting the runtime.
 *
 * The pinned runtime returns sessions for every project it has ever run; a
 * session belongs to the active workspace when its recorded cwd is the
 * workspace root or a descendant (delegated task worktrees, open subfolders).
 * A session with no usable cwd cannot be attributed to another workspace, so
 * it is kept rather than hidden.
 */
export function scopeSessionListPayload(
  value: unknown,
  workspaceRoot: string,
  archivedIds: ReadonlySet<string>,
): unknown {
  const raw = (value as { items?: unknown } | undefined)?.items
  if (!Array.isArray(raw)) return value
  const items = raw
    .filter((item): item is { sessionId: string } => {
      if (!isSessionLike(item)) return false
      return sessionInWorkspace(workspaceRoot, (item as { cwd?: unknown }).cwd)
    })
    .map((item) => (archivedIds.has(item.sessionId) ? { ...item, archived: true } : item))
  return {
    ...(typeof value === 'object' && value !== null ? value : {}),
    items,
  }
}
