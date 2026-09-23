import { describe, expect, it } from 'vitest'
import { CoreSessionJournalStore } from '../src/main/core/core-session-journal.js'

class FakeCore {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = []
  readonly sessions = new Map<string, Array<{ type: string; seq: number; time?: number; data?: unknown }>>()

  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'sessionJournal.append') {
      const sessionId = String(params.sessionId)
      const events = params.events as Array<{ type: string; seq: number; time?: number; data?: unknown }>
      this.sessions.set(sessionId, [...(this.sessions.get(sessionId) ?? []), ...events])
      return { retainedEvents: this.sessions.get(sessionId)!.length } as T
    }
    if (method === 'sessionJournal.tail') {
      const sessionId = String(params.sessionId)
      const maxMessages = Number(params.maxMessages)
      return { events: (this.sessions.get(sessionId) ?? []).slice(-maxMessages) } as T
    }
    if (method === 'sessionJournal.drop') {
      this.sessions.delete(String(params.sessionId))
      return { removed: true } as T
    }
    throw new Error('unexpected method: ' + method)
  }
}

describe('CoreSessionJournalStore', () => {
  it('flushes queued appends before a tail read and preserves ordering', async () => {
    const core = new FakeCore()
    const store = new CoreSessionJournalStore(core as never)
    const first = store.append('s1', [{ type: 'user/message', seq: 1, time: 1, data: { text: 'one' } }])
    const second = store.append('s1', [{ type: 'assistant/message', seq: 2, time: 2, data: { text: 'two' } }])

    const tail = await store.tail('s1', 50)
    await Promise.all([first, second])

    expect(tail.map((event) => event.seq)).toEqual([1, 2])
    expect(core.calls.filter((call) => call.method === 'sessionJournal.append')).toHaveLength(1)
  })

  it('forwards tighter owner retention limits on append', async () => {
    const core = new FakeCore()
    const store = new CoreSessionJournalStore(core as never, {
      maxEvents: 500,
      maxBytes: 2 * 1024 * 1024,
    })
    await store.append('direct-1', [{ type: 'assistant/message', seq: 1, time: 1 }])

    expect(core.calls.find((call) => call.method === 'sessionJournal.append')?.params).toMatchObject({
      sessionId: 'direct-1',
      maxEvents: 500,
      maxBytes: 2 * 1024 * 1024,
    })
  })

  it('clears only sessions owned by that adapter instance', async () => {
    const core = new FakeCore()
    const harness = new CoreSessionJournalStore(core as never)
    const direct = new CoreSessionJournalStore(core as never)

    await Promise.all([
      harness.append('harness-1', [{ type: 'user/message', seq: 1, time: 1 }]),
      direct.append('codex-1', [{ type: 'user/message', seq: 1, time: 1 }]),
    ])
    await harness.clear()

    expect(core.sessions.has('harness-1')).toBe(false)
    expect(core.sessions.has('codex-1')).toBe(true)
    expect((await direct.tail('codex-1', 50)).map((event) => event.seq)).toEqual([1])
  })
})
