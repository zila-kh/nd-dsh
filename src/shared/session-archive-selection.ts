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

/**
 * Sanitize a session or thread title, stripping injected metadata tags such as
 * `<nd-browser-context>` or `<nd-extension-context>` that may leak into prompt-derived titles.
 */
export function cleanThreadTitle(rawTitle: string | undefined | null, fallback = 'New Chat Thread'): string {
  if (!rawTitle) return fallback
  const stripped = rawTitle
    .replace(/<nd-[a-z0-9_-]+>[\s\S]*?(?:<\/nd-[a-z0-9_-]+>|$)/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  return stripped || fallback
}

/**
 * When the active session is archived while viewing active chats, calculate the next
 * session id to switch to, or null if none remain.
 */
export function nextSessionAfterArchive(
  activeSessionId: string | null,
  archivedIds: Set<string> | readonly string[],
  sessions: readonly SessionSummary[],
  engineSessions: readonly EngineSessionSummary[],
): string | null {
  if (!activeSessionId) return null
  const set = archivedIds instanceof Set ? archivedIds : new Set(archivedIds)
  if (!set.has(activeSessionId)) return activeSessionId

  // Find remaining unarchived harness sessions (non-blank)
  const remainingHarness = sessions.find((s) => !set.has(s.sessionId) && !s.archived && !s.blank)
  if (remainingHarness) return remainingHarness.sessionId

  // Find remaining unarchived engine sessions
  const remainingEngine = engineSessions.find((s) => !set.has(s.sessionId) && !s.archived)
  if (remainingEngine) return remainingEngine.sessionId

  return null
}

