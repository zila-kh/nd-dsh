import type { SessionSummary } from './contracts.js'

export interface SessionTreeNode {
  session: SessionSummary
  children: SessionTreeNode[]
}

/**
 * Build the renderer projection for parent/child agent sessions.
 *
 * Runtime sessions remain the authority. This helper only projects the
 * `parentSessionId` relationship into a tree so subagents can be inspected
 * without becoming top-level organization employees or tasks.
 *
 * Malformed/cyclic parent references fail soft by keeping the affected session
 * at the root instead of hiding it from the user.
 */
export function buildSessionTree(sessions: readonly SessionSummary[]): SessionTreeNode[] {
  const nodes = new Map<string, SessionTreeNode>()
  for (const session of sessions) {
    if (!nodes.has(session.sessionId)) nodes.set(session.sessionId, { session, children: [] })
  }

  const roots: SessionTreeNode[] = []
  for (const session of sessions) {
    const node = nodes.get(session.sessionId)
    if (!node) continue
    const parentId = session.origin === 'subagent' ? session.parentSessionId : undefined
    const parent = parentId ? nodes.get(parentId) : undefined
    if (!parentId || !parent || parent === node || hasParentCycle(session.sessionId, parentId, nodes)) {
      roots.push(node)
      continue
    }
    parent.children.push(node)
  }

  return roots
}

function hasParentCycle(
  childId: string,
  parentId: string,
  nodes: ReadonlyMap<string, SessionTreeNode>,
): boolean {
  const seen = new Set<string>([childId])
  let cursor: string | undefined = parentId
  while (cursor) {
    if (seen.has(cursor)) return true
    seen.add(cursor)
    const next: SessionSummary | undefined = nodes.get(cursor)?.session
    cursor = next?.origin === 'subagent' ? next.parentSessionId : undefined
  }
  return false
}
