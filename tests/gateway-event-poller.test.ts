import { describe, expect, it } from 'vitest'
import type { DshEventFrame, GatewayRpcResult } from '../src/shared/contracts.js'
import { GatewayEventPoller } from '../src/main/harness/gateway-event-poller.js'

interface FakeSession {
  running?: boolean
  events?: Array<{ type: string; seq: number; time?: number; data?: unknown }>
}

/** Scriptable gateway: session.list + session.history with owned shapes. */
function fakeGateway(sessions: Map<string, FakeSession>) {
  const calls: string[] = []
  const rpc = async (method: string, payload?: unknown): Promise<GatewayRpcResult> => {
    calls.push(method)
    if (method === 'session.list') {
      return {
        ok: true,
        value: {
          items: [...sessions.entries()].map(([sessionId, session]) => ({ sessionId, running: session.running === true })),
        },
      }
    }
    if (method === 'session.history') {
      const sessionId = (payload as { sessionId?: string })?.sessionId
      const session = sessions.get(sessionId ?? '')
      return { ok: true, value: { events: (session?.events ?? []).map((event) => ({ event })) } }
    }
    return { ok: false, error: { code: 'unexpected-method', message: method } }
  }
  return { rpc, calls }
}

function harness(sessions: Map<string, FakeSession>, now = { value: 1_000 }) {
  const gateway = fakeGateway(sessions)
  const frames: DshEventFrame[] = []
  const poller = new GatewayEventPoller(gateway.rpc, (frame) => frames.push(frame), () => now.value)
  return { poller, frames, calls: gateway.calls }
}

function kinds(frames: DshEventFrame[]): string[] {
  return frames.map((frame) => frame.kind + (frame.event ? `:${frame.event.type}` : ''))
}

describe('GatewayEventPoller', () => {
  it('stays silent on the first listing (startup adoption), then announces additions, removals, and running flips', async () => {
    const sessions = new Map<string, FakeSession>([['s1', { running: false }]])
    const { poller, frames } = harness(sessions)

    await poller.requestTick()
    expect(frames).toEqual([])

    sessions.set('s2', { running: true })
    await poller.requestTick()
    expect(kinds(frames)).toEqual(['session-added', 'session-status'])

    sessions.get('s2')!.running = false
    await poller.requestTick()
    expect(kinds(frames).slice(2)).toEqual(['session-status'])

    sessions.delete('s2')
    await poller.requestTick()
    expect(kinds(frames).slice(3)).toEqual(['session-removed'])
    poller.stop()
  })

  it('emits only history events past the adopted baseline, exactly once each', async () => {
    const sessions = new Map<string, FakeSession>([[
      's1',
      {
        running: false,
        events: [
          { type: 'user/message', seq: 1, data: { message: { content: 'hi' } } },
          { type: 'assistant/message', seq: 2, data: { message: { content: 'pong' } } },
        ],
      },
    ]])
    const { poller, frames } = harness(sessions)

    await poller.requestTick() // startup adoption: no frames, baseline -> seq 2
    expect(frames).toEqual([])

    sessions.get('s1')!.running = true
    sessions.get('s1')!.events!.push({ type: 'assistant/message', seq: 3, data: { message: { content: 'again' } } })
    await poller.requestTick()
    const deltas = frames.filter((frame) => frame.kind === 'session-event')
    expect(deltas.map((frame) => frame.event?.seq)).toEqual([3])
    expect(deltas[0]?.sessionId).toBe('s1')
    poller.stop()
  })

  it('ensureBaseline prevents replaying a session that already has history', async () => {
    const sessions = new Map<string, FakeSession>([[
      's1',
      { running: false, events: [{ type: 'user/message', seq: 7, data: {} }, { type: 'assistant/message', seq: 9, data: {} }] },
    ]])
    const { poller, frames } = harness(sessions)

    await poller.ensureBaseline('s1')
    // A fresh prompt puts the session on the fast path; the poll must not
    // replay seq<=9 as new events.
    await poller.requestTick()
    expect(frames.filter((frame) => frame.kind === 'session-event')).toEqual([])
    poller.stop()
  })

  it('notePromptSent fast-paths an immediate delta poll for the prompted session', async () => {
    const sessions = new Map<string, FakeSession>([['s1', { running: false, events: [] }]])
    const { poller, frames, calls } = harness(sessions)

    await poller.requestTick() // startup adoption
    expect(frames).toEqual([])

    sessions.get('s1')!.events!.push({ type: 'assistant/chunk', seq: 4, data: { chunk: { content: 'po' } } })
    poller.notePromptSent('s1')
    await poller.requestTick()
    const deltas = frames.filter((frame) => frame.kind === 'session-event')
    expect(deltas.map((frame) => frame.event?.type)).toEqual(['assistant/chunk'])
    expect(calls.filter((method) => method === 'session.history').length).toBeGreaterThanOrEqual(1)
    poller.stop()
  })

  it('orders out-of-order history envelopes by seq before emitting', async () => {
    const sessions = new Map<string, FakeSession>([['s1', { running: false }]])
    const { poller, frames } = harness(sessions)
    await poller.requestTick()

    sessions.get('s1')!.running = true
    sessions.get('s1')!.events = [
      { type: 'assistant/chunk', seq: 6, data: {} },
      { type: 'user/message', seq: 5, data: {} },
    ]
    await poller.requestTick()
    const seqs = frames.filter((frame) => frame.kind === 'session-event').map((frame) => frame.event?.seq)
    expect(seqs).toEqual([5, 6])
    poller.stop()
  })

  it('never emits the pre-turn running=false of a freshly prompted session as a completion', async () => {
    // The beta pm-plan failure: notePromptSent fires, the queued turn has not
    // started yet, and a poll sees running=false. That false must be
    // suppressed; the real completion flip comes after running=true.
    const sessions = new Map<string, FakeSession>([['s1', { running: false, events: [] }]])
    const { poller, frames } = harness(sessions)
    await poller.requestTick() // startup priming
    expect(frames).toEqual([])

    poller.notePromptSent('s1')
    await poller.requestTick() // pre-turn poll: still running=false
    expect(frames.filter((frame) => frame.kind === 'session-status')).toEqual([])

    sessions.get('s1')!.running = true
    sessions.get('s1')!.events!.push({ type: 'assistant/message', seq: 1, data: {} })
    await poller.requestTick()
    expect(frames.filter((frame) => frame.kind === 'session-status').map((frame) => frame.running)).toEqual([true])

    sessions.get('s1')!.running = false
    sessions.get('s1')!.events!.push({ type: 'assistant/message', seq: 2, data: {} })
    await poller.requestTick()
    const statuses = frames.filter((frame) => frame.kind === 'session-status').map((frame) => frame.running)
    expect(statuses).toEqual([true, false])
    poller.stop()
  })

  it('synthesizes the completion flip when a prompted turn starts and ends between two polls', async () => {
    const sessions = new Map<string, FakeSession>([['s1', { running: false, events: [] }]])
    const clock = { value: 1_000 }
    const { poller, frames } = harness(sessions, clock)
    await poller.requestTick()

    poller.notePromptSent('s1')
    await poller.requestTick() // pre-turn, running=false: suppressed
    expect(frames.filter((frame) => frame.kind === 'session-status')).toEqual([])

    // The whole turn (running=true, then done) happened while polls were away.
    sessions.get('s1')!.events!.push({ type: 'assistant/message', seq: 1, data: {} })
    clock.value = 1_000 + 21_000
    await poller.requestTick() // window expired
    const statuses = frames.filter((frame) => frame.kind === 'session-status')
    expect(statuses.map((frame) => frame.running)).toEqual([false])
    poller.stop()
  })
})
