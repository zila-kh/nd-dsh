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
 * in every project. With no active project (standalone workspace) nothing is
 * filtered.
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

export function filterSessionsInProjectScope<T extends { sessionId: string }>(
  items: readonly T[],
  activeProjectId: string | undefined,
  sessionProjects: Readonly<Record<string, string>>,
): T[] {
  return items.filter((item) => isSessionInProjectScope(item.sessionId, activeProjectId, sessionProjects))
}
