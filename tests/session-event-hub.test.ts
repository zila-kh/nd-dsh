import { describe, expect, it } from 'vitest'
import type { FollowHandle, SessionStreamFrame } from '../src/main/dsh/gateway-client.js'
import { SessionEventHub } from '../src/main/harness/session-event-hub.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

interface StubEntry {
  onFrame: (frame: SessionStreamFrame) => void
  resolveReady: (() => void) | undefined
  rejectReady: ((cause: Error) => void) | undefined
  settled: boolean
  closed: boolean
}

function stubSource(remote = true) {
  const entries = new Map<string, StubEntry>()
  const source = {
    remote,
    followSession(sessionId: string, onFrame: (frame: SessionStreamFrame) => void): FollowHandle {
      const entry: StubEntry = { onFrame, resolveReady: undefined, rejectReady: undefined, settled: false, closed: false }
      const ready = new Promise<void>((resolve, reject) => {
        entry.resolveReady = resolve
        entry.rejectReady = reject
      })
      entries.set(sessionId, entry)
      // The real transport settles the snapshot promise; mirror that here.
      entry.onFrame = (frame: SessionStreamFrame): void => {
        if (frame.type === 'snapshot' && !entry.settled) {
          entry.settled = true
          entry.resolveReady?.()
        }
        onFrame(frame)
      }
      return {
        ready,
        close: () => {
          if (entry.closed) return
          entry.closed = true
          entries.delete(sessionId)
          entry.rejectReady?.(new Error('stream closed'))
        },
      }
    },
  }
  return { source, entries }
}

function snapshot(records: Array<{ type: string; seq: number; data?: unknown }>, cursor = records.at(-1)?.seq ?? 0): SessionStreamFrame {
  return {
    type: 'snapshot',
    cursor,
    records: records.map((event) => ({ type: 'event', event })),
  }
}

function live(type: string, seq: number, data?: unknown): SessionStreamFrame {
  return { type: 'event', event: { type, seq, time: seq, data } }
}

describe('SessionEventHub', () => {
  it('serves history reads from the opening snapshot in the legacy wire shape without emitting frames', async () => {
    const { source, entries } = stubSource()
    const frames: DshEventFrame[] = []
    const hub = new SessionEventHub((frame) => frames.push(frame))
    hub.attach(source)

    const pending = hub.read('s1')
    entries.get('s1')!.onFrame(snapshot([
      { type: 'user/message', seq: 1, data: { message: { text: 'hello' } } },
      { type: 'assistant/message', seq: 2 },
    ]))
    const result = await pending

    expect(result.ok).toBe(true)
    expect(result.value).toEqual({
      events: [
        { event: { type: 'user/message', seq: 1, data: { message: { text: 'hello' } } } },
        { event: { type: 'assistant/message', seq: 2 } },
      ],
    })
    expect(frames).toEqual([])
    hub.detach()
  })

  it('slices the newest window to maxMessages', async () => {
    const { source, entries } = stubSource()
    const hub = new SessionEventHub(() => {})
    hub.attach(source)
    const pending = hub.read('s1', 2)
    entries.get('s1')!.onFrame(snapshot([
      { type: 'a', seq: 1 },
      { type: 'b', seq: 2 },
      { type: 'c', seq: 3 },
    ]))
    const result = await pending
    expect((result.value as { events: unknown[] }).events).toHaveLength(2)
    hub.detach()
  })

  it('emits live appends as session-event frames and journals them', async () => {
    const { source, entries } = stubSource()
    const frames: DshEventFrame[] = []
    const hub = new SessionEventHub((frame) => frames.push(frame))
    hub.attach(source)
    const pending = hub.read('s1')
    const entry = entries.get('s1')!
    entry.onFrame(snapshot([{ type: 'user/message', seq: 1 }]))
    await pending
    entry.onFrame(live('assistant/message', 2, { message: { text: 'hi' } }))

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ kind: 'session-event', sessionId: 's1', event: { type: 'assistant/message', seq: 2 } })
    const again = await hub.read('s1')
    expect((again.value as { events: unknown[] }).events).toHaveLength(2)
    hub.detach()
  })

  it('does not duplicate journal entries or frames when a reconnect replays a fresh snapshot', async () => {
    const { source, entries } = stubSource()
    const frames: DshEventFrame[] = []
    const hub = new SessionEventHub((frame) => frames.push(frame))
    hub.attach(source)
    const pending = hub.read('s1')
    const entry = entries.get('s1')!
    entry.onFrame(snapshot([{ type: 'user/message', seq: 1 }]))
    entry.onFrame(live('assistant/chunk', 2))
    await pending

    // Reconnect: the runtime replays everything up to its cursor, then continues.
    entry.onFrame(snapshot([
      { type: 'user/message', seq: 1 },
      { type: 'assistant/chunk', seq: 2 },
      { type: 'assistant/message', seq: 3 },
    ], 3))
    entry.onFrame(live('turn/end', 4))

    expect(frames.map((frame) => frame.event?.type)).toEqual(['assistant/chunk', 'turn/end'])
    const result = await hub.read('s1')
    expect((result.value as { events: Array<{ event: { seq: number } }> }).events.map((item) => item.event.seq)).toEqual([1, 2, 3, 4])
    hub.detach()
  })

  it('closes the follow handle on a terminal stream error and surfaces the failure to readers', async () => {
    const { source, entries } = stubSource()
    const hub = new SessionEventHub(() => {})
    hub.attach(source)
    const pending = hub.read('no-such-session')
    entries.get('no-such-session')!.rejectReady?.(new Error('session "no-such-session" not found'))

    await expect(pending).rejects.toThrow('not found')
    expect(entries.has('no-such-session')).toBe(false)
    hub.detach()
  })

  it('is inert until attached to a remote-face source', async () => {
    const { source, entries } = stubSource(false)
    const hub = new SessionEventHub(() => {})
    hub.attach(source)
    expect(hub.active).toBe(false)
    await hub.ensure('s1')
    expect(entries.size).toBe(0)
    hub.detach()
    expect(hub.active).toBe(false)
  })
})
