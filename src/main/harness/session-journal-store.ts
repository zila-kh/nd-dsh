export interface SessionJournalEnvelope {
  type: string
  seq: number
  time?: number
  data?: unknown
  surfaceOp?: unknown
}

export interface SessionJournalStore {
  /**
   * Appends preserve call order for a session. Implementations may batch writes
   * internally, but the returned promise settles only after those events are
   * visible to tail().
   */
  append(sessionId: string, events: SessionJournalEnvelope[]): Promise<void>
  tail(sessionId: string, maxMessages: number): Promise<SessionJournalEnvelope[]>
  clear(): Promise<void>
}

const DEFAULT_LIMIT = 10_000

/** Test/degraded fallback. Production supplies the nd-core-backed store. */
export class MemorySessionJournalStore implements SessionJournalStore {
  private readonly sessions = new Map<string, SessionJournalEnvelope[]>()

  constructor(private readonly limit = DEFAULT_LIMIT) {}

  async append(sessionId: string, events: SessionJournalEnvelope[]): Promise<void> {
    if (!events.length) return
    const journal = this.sessions.get(sessionId) ?? []
    journal.push(...events.map(cloneEnvelope))
    if (journal.length > this.limit) journal.splice(0, journal.length - this.limit)
    this.sessions.set(sessionId, journal)
  }

  async tail(sessionId: string, maxMessages: number): Promise<SessionJournalEnvelope[]> {
    const journal = this.sessions.get(sessionId) ?? []
    const limit = Math.max(1, Math.min(this.limit, Math.floor(maxMessages) || 1))
    return journal.slice(-limit).map(cloneEnvelope)
  }

  async clear(): Promise<void> {
    this.sessions.clear()
  }
}

function cloneEnvelope(event: SessionJournalEnvelope): SessionJournalEnvelope {
  return {
    type: event.type,
    seq: event.seq,
    ...(event.time === undefined ? {} : { time: event.time }),
    ...(event.data === undefined ? {} : { data: structuredClone(event.data) }),
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: structuredClone(event.surfaceOp) }),
  }
}
