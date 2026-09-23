import type { CoreClient } from './core-client.js'
import type { SessionJournalEnvelope, SessionJournalStore } from '../harness/session-journal-store.js'

const FLUSH_MS = 8
const MAX_BATCH_EVENTS = 256

interface PendingBatch {
  events: SessionJournalEnvelope[]
  waiters: Array<{ resolve: () => void; reject: (error: Error) => void }>
  timer: ReturnType<typeof setTimeout> | undefined
  active: Promise<void> | undefined
}

interface CoreTailResult {
  events?: SessionJournalEnvelope[]
}

export interface CoreSessionJournalOptions {
  maxEvents?: number
  maxBytes?: number
}

export class CoreSessionJournalStore implements SessionJournalStore {
  private readonly pending = new Map<string, PendingBatch>()
  private readonly knownSessions = new Set<string>()

  constructor(
    private readonly core: Pick<CoreClient, 'request'>,
    private readonly options: CoreSessionJournalOptions = {},
  ) {}

  append(sessionId: string, events: SessionJournalEnvelope[]): Promise<void> {
    if (!events.length) return Promise.resolve()
    this.knownSessions.add(sessionId)
    let batch = this.pending.get(sessionId)
    if (!batch) {
      batch = { events: [], waiters: [], timer: undefined, active: undefined }
      this.pending.set(sessionId, batch)
    }
    batch.events.push(...events)
    const promise = new Promise<void>((resolve, reject) => batch!.waiters.push({ resolve, reject }))
    if (batch.events.length >= MAX_BATCH_EVENTS) {
      void this.flush(sessionId)
    } else if (!batch.timer) {
      batch.timer = setTimeout(() => {
        batch!.timer = undefined
        void this.flush(sessionId)
      }, FLUSH_MS)
      batch.timer.unref?.()
    }
    return promise
  }

  async tail(sessionId: string, maxMessages: number): Promise<SessionJournalEnvelope[]> {
    await this.flush(sessionId)
    const result = await this.core.request<CoreTailResult>('sessionJournal.tail', {
      sessionId,
      maxMessages,
    }, 5_000)
    return Array.isArray(result.events) ? result.events : []
  }

  async clear(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((sessionId) => this.flush(sessionId)))
    const sessions = [...this.knownSessions]
    this.knownSessions.clear()
    await Promise.all(sessions.map(async (sessionId) => {
      await this.core.request('sessionJournal.drop', { sessionId }, 5_000).catch(() => undefined)
    }))
  }

  private async flush(sessionId: string): Promise<void> {
    const batch = this.pending.get(sessionId)
    if (!batch) return
    if (batch.active) {
      await batch.active
      return this.flush(sessionId)
    }
    if (batch.events.length === 0) return

    if (batch.timer) {
      clearTimeout(batch.timer)
      batch.timer = undefined
    }
    const events = batch.events.splice(0)
    const waiters = batch.waiters.splice(0)
    const active = (async () => {
      try {
        for (let index = 0; index < events.length; index += MAX_BATCH_EVENTS) {
          await this.core.request('sessionJournal.append', {
            sessionId,
            events: events.slice(index, index + MAX_BATCH_EVENTS),
            ...(this.options.maxEvents === undefined ? {} : { maxEvents: this.options.maxEvents }),
            ...(this.options.maxBytes === undefined ? {} : { maxBytes: this.options.maxBytes }),
          }, 5_000)
        }
        for (const waiter of waiters) waiter.resolve()
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause))
        for (const waiter of waiters) waiter.reject(error)
        throw error
      } finally {
        batch.active = undefined
        if (batch.events.length > 0) {
          void this.flush(sessionId).catch(() => undefined)
        } else if (batch.waiters.length === 0) {
          this.pending.delete(sessionId)
        }
      }
    })()
    batch.active = active
    return active
  }
}
