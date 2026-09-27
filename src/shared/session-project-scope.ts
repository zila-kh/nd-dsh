/**
 * Project scoping for the chat sidebar.
 *
 * The gateway session list is workspace-scoped only: every organization run
 * (plan, execute, review) records its session in the same workspace, so
 * sessions from every company/project pile into one flat list. ND-side runs
 * already know which session belongs to which project; these helpers apply
 * that attribution on top of the raw listing.
 *
 * Sessions with no run attribution are personal/manual chats and stay visible
 * in every project. Only sessions explicitly marked as subagents inherit the
 * attribution of their parent; an ordinary fork may carry parentSessionId too,
 * but it remains a manual chat unless ND gives it its own run attribution.
 * With no active project (standalone workspace) nothing is filtered.
 */
export function isSessionInProjectScope(
  sessionId: string,
  activeProjectId: string | undefined,
  sessionProjects: Readonly<Record<string, string>>,
): boolean {
  if (!activeProjectId) return true
  const projectId = sessionProjects[sessionId]
  return projectId === undefined || projectId === activeProjectId
}

export function filterSessionsInProjectScope<T extends { sessionId: string; parentSessionId?: string; origin?: 'subagent' }>(
  items: readonly T[],
  activeProjectId: string | undefined,
  sessionProjects: Readonly<Record<string, string>>,
): T[] {
  if (!activeProjectId) return [...items]
  const byId = new Map(items.map((item) => [item.sessionId, item]))
  const resolvedProjects = new Map<string, string | undefined>()

  const projectFor = (sessionId: string, trail = new Set<string>()): string | undefined => {
    if (resolvedProjects.has(sessionId)) return resolvedProjects.get(sessionId)
    const direct = sessionProjects[sessionId]
    if (direct !== undefined) {
      resolvedProjects.set(sessionId, direct)
      return direct
    }
    if (trail.has(sessionId)) return undefined
    const item = byId.get(sessionId)
    const parentId = item?.origin === 'subagent' ? item.parentSessionId : undefined
    if (!parentId) {
      resolvedProjects.set(sessionId, undefined)
      return undefined
    }
    const nextTrail = new Set(trail)
    nextTrail.add(sessionId)
    const inherited = projectFor(parentId, nextTrail)
    resolvedProjects.set(sessionId, inherited)
    return inherited
  }

  return items.filter((item) => {
    const projectId = projectFor(item.sessionId)
    return projectId === undefined || projectId === activeProjectId
  })
}
