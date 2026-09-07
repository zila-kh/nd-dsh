import type { EngineSessionSummary, SessionSummary } from './contracts.js'

/** Return the unarchived chat ids currently eligible for the sidebar's bulk archive action. */
export function archiveableVisibleSessionIds(
  sessions: readonly SessionSummary[],
  engineSessions: readonly EngineSessionSummary[],
  activeSessionId: string | null,
): string[] {
  const ids = new Set<string>()
  for (const session of sessions) {
    if (session.archived === true) continue
    if (session.blank && session.sessionId !== activeSessionId) continue
    ids.add(session.sessionId)
  }
  for (const session of engineSessions) {
    if (session.archived !== true) ids.add(session.sessionId)
  }
  return [...ids]
}
