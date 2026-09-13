import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'
import { GatewayClient } from '../src/main/dsh/gateway-client.js'
import type { FollowHandle, SessionStreamFrame } from '../src/main/dsh/gateway-client.js'
import GatewayWebSocket from './fixtures/gateway-websocket.js'

vi.mock('ws', async () => ({
  default: (await import('./fixtures/gateway-websocket.js')).default,
}))

const originalFetch = globalThis.fetch
const clients: GatewayClient[] = []

beforeEach(() => {
  GatewayWebSocket.instances.length = 0
})

afterEach(() => {
  for (const client of clients.splice(0)) client.close()
  globalThis.fetch = originalFetch
  GatewayWebSocket.instances.length = 0
})

function client(baseUrl = 'http://127.0.0.1:9000'): GatewayClient {
  const value = new GatewayClient(baseUrl)
  clients.push(value)
  return value
}

function follow(value: GatewayClient, sessionId: string, frames: SessionStreamFrame[] = []): FollowHandle {
  const handle = value.followSession(sessionId, (frame) => frames.push(frame))
  // Cleanup may reject a still-opening stream. Tests still assert the original promise.
  void handle.ready.catch(() => {})
  return handle
}

function socket(index = GatewayWebSocket.instances.length - 1): GatewayWebSocket {
  const value = GatewayWebSocket.instances[index]
  assert.ok(value, `Expected socket ${index}`)
  return value
}

function opens(value: GatewayWebSocket): Record<string, unknown>[] {
  return value.sent.filter((frame) => frame.type === 'open')
}

function snapshot(value: GatewayWebSocket, index = 0): string {
  const streamId = opens(value)[index]?.streamId
  assert.equal(typeof streamId, 'string')
  value.receive({ type: 'item', streamId, value: { type: 'snapshot', cursor: 0, records: [] } })
  return streamId as string
}

function reply(body: unknown): void {
  globalThis.fetch = async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GatewayClient stream lifecycle regressions', () => {
  it('delivers the initial snapshot and live events', async () => {
    const frames: SessionStreamFrame[] = []
    const handle = follow(client(), 'first', frames)
    const transport = socket()
    transport.open()
    const streamId = snapshot(transport)
    await handle.ready
    transport.receive({ type: 'item', streamId, value: { type: 'event', event: { type: 'assistant/chunk', seq: 1 } } })
    assert.deepEqual(frames.map((frame) => frame.type), ['snapshot', 'event'])
  })

  it('opens a second session immediately on an already-open socket', async () => {
    const value = client()
    const first = follow(value, 'first')
    const transport = socket()
    transport.open()
    snapshot(transport)
    await first.ready
    const second = follow(value, 'second')
    assert.equal(GatewayWebSocket.instances.length, 1)
    assert.equal(opens(transport).length, 2)
    assert.deepEqual(opens(transport)[1]?.payload, {
      args: { request: { address: { kind: 'session', sessionId: 'second' }, maxMessages: 50 } },
    })
    snapshot(transport, 1)
    await second.ready
  })

  it('opens each queued session once when the socket connects', async () => {
    const value = client()
    const first = follow(value, 'first')
    const second = follow(value, 'second')
    assert.equal(GatewayWebSocket.instances.length, 1)
    const transport = socket()
    assert.equal(opens(transport).length, 0)
    transport.open()
    assert.equal(opens(transport).length, 2)
    snapshot(transport, 0)
    snapshot(transport, 1)
    await Promise.all([first.ready, second.ready])
  })

  it('rejects subscriptions after client shutdown instead of leaving ready pending', async () => {
    const value = client()
    value.close()
    const handle = follow(value, 'closed')
    let rejected = false
    void handle.ready.catch(() => { rejected = true })
    await Promise.resolve()
    assert.equal(rejected, true)
    await assert.rejects(handle.ready, /closed/i)
    assert.equal(GatewayWebSocket.instances.length, 0)
  })

  it('ignores a delayed close from a replaced socket without losing live routing', async () => {
    const value = client()
    const old = follow(value, 'old')
    const oldSocket = socket()
    oldSocket.open()
    snapshot(oldSocket)
    await old.ready
    old.close()
    const frames: SessionStreamFrame[] = []
    const current = follow(value, 'current', frames)
    const currentSocket = socket()
    currentSocket.open()
    const streamId = snapshot(currentSocket)
    await current.ready
    oldSocket.finishClose()
    currentSocket.receive({ type: 'item', streamId, value: { type: 'event', event: { type: 'assistant/chunk', seq: 1 } } })
    assert.deepEqual(frames.map((frame) => frame.type), ['snapshot', 'event'])
    current.close()
    assert.deepEqual(currentSocket.sent.at(-1), { type: 'cancel', streamId })
  })

  it('ignores late frames from a replaced socket', async () => {
    const value = client()
    const old = follow(value, 'old')
    const oldSocket = socket()
    oldSocket.open()
    snapshot(oldSocket)
    await old.ready
    old.close()
    const frames: SessionStreamFrame[] = []
    const current = follow(value, 'current', frames)
    const currentSocket = socket()
    currentSocket.open()
    const streamId = snapshot(currentSocket)
    await current.ready
    oldSocket.receive({ type: 'item', streamId, value: { type: 'event', event: { type: 'assistant/chunk', seq: 99 } } })
    assert.deepEqual(frames.map((frame) => frame.type), ['snapshot'])
  })

  it('allows retrying the same session after a terminal stream error', async () => {
    const value = client()
    const frames: SessionStreamFrame[] = []
    const first = follow(value, 'retry', frames)
    const transport = socket()
    transport.open()
    transport.receive({ type: 'error', streamId: opens(transport)[0]?.streamId, error: { message: 'session missing' } })
    await assert.rejects(first.ready, /session missing/)
    assert.deepEqual(frames, [{ type: 'error', message: 'session missing' }])
    const second = follow(value, 'retry')
    assert.notEqual(second.ready, first.ready)
    assert.equal(GatewayWebSocket.instances.length, 2)
    socket().open()
    snapshot(socket())
    await second.ready
    // Closing an old handle must not remove its replacement.
    first.close()
    assert.equal(socket().readyState, GatewayWebSocket.OPEN)
  })

  it('allows retrying after a stream ends before its snapshot', async () => {
    const value = client()
    const first = follow(value, 'retry')
    const transport = socket()
    transport.open()
    transport.receive({ type: 'end', streamId: opens(transport)[0]?.streamId })
    await assert.rejects(first.ready, /ended before its snapshot/)
    const second = follow(value, 'retry')
    assert.notEqual(second.ready, first.ready)
    socket().open()
    snapshot(socket())
    await second.ready
  })

  it('does not close another active session when one stream ends', async () => {
    const value = client()
    const first = follow(value, 'first')
    const frames: SessionStreamFrame[] = []
    const second = follow(value, 'second', frames)
    const transport = socket()
    transport.open()
    const firstId = snapshot(transport, 0)
    const secondId = snapshot(transport, 1)
    await Promise.all([first.ready, second.ready])
    transport.receive({ type: 'end', streamId: firstId })
    assert.equal(transport.readyState, GatewayWebSocket.OPEN)
    transport.receive({ type: 'item', streamId: secondId, value: { type: 'event', event: { type: 'assistant/chunk', seq: 1 } } })
    assert.deepEqual(frames.map((frame) => frame.type), ['snapshot', 'event'])
  })

  it('rejects a pending snapshot when explicitly cancelled', async () => {
    const handle = follow(client(), 'pending')
    handle.close()
    await assert.rejects(handle.ready, /closed before its snapshot/)
    assert.equal(socket().readyState, GatewayWebSocket.CLOSING)
  })

  it('reopens active sessions after the current transport disconnects', async () => {
    const value = client()
    const frames: SessionStreamFrame[] = []
    const first = follow(value, 'first', frames)
    const oldSocket = socket()
    oldSocket.open()
    snapshot(oldSocket)
    await first.ready
    oldSocket.finishClose()
    const second = follow(value, 'second')
    const currentSocket = socket()
    currentSocket.open()
    assert.equal(opens(currentSocket).length, 2)
    snapshot(currentSocket, 0)
    snapshot(currentSocket, 1)
    await second.ready
    assert.deepEqual(frames.map((frame) => frame.type), ['snapshot', 'snapshot'])
  })
})

describe('GatewayClient response validation regressions', () => {
  for (const [label, body] of [
    ['null frame', null],
    ['missing result', { type: 'server-response' }],
    ['null result', { type: 'server-response', result: null }],
    ['empty result', { type: 'server-response', result: {} }],
    ['primitive result', { type: 'server-response', result: 'ok' }],
    ['nonboolean ok', { type: 'server-response', result: { ok: 'true', value: 'invalid' } }],
  ] as const) {
    it(`returns gateway-protocol for ${label}`, async () => {
      reply(body)
      const result = await client().rpc('session.list')
      assert.equal(result.ok, false)
      assert.equal(result.error?.code, 'gateway-protocol')
    })
  }

  it('preserves valid successful RPC results', async () => {
    reply({ type: 'server-response', rpcId: 'test', result: { ok: true, value: { items: [] } } })
    assert.deepEqual(await client().rpc('session.list'), { ok: true, value: { items: [] } })
  })

  it('preserves normalized gateway errors', async () => {
    reply({ type: 'server-response', rpcId: 'test', result: { ok: false, error: { code: 'busy', message: 'Retry later' } } })
    assert.deepEqual(await client().rpc('session.list'), { ok: false, error: { code: 'busy', message: 'Retry later' } })
  })

  it('returns a structured error for unreadable JSON', async () => {
    globalThis.fetch = async () => new Response('{broken', { status: 200 })
    assert.equal((await client().rpc('session.list')).error?.code, 'gateway-protocol')
  })

  it('returns a structured error for transport failure', async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed') }
    assert.equal((await client().rpc('session.list')).error?.code, 'gateway-unreachable')
  })

  it('preserves TLS when opening the negotiated remote event socket', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input) => {
      requests.push(String(input))
      return String(input).endsWith('/api/session.list')
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({ type: 'server-response', result: { ok: true, value: [] } }), { status: 200 })
    }
    const value = client('https://localhost:9000')
    assert.equal((await value.rpc('session.list')).ok, true)
    assert.equal(value.remote, true)
    assert.deepEqual(requests, ['https://localhost:9000/api/session.list', 'https://localhost:9000/api/session/list'])
    value.openEvents(() => {})
    assert.equal(socket().url, 'wss://localhost:9000/api/remote.mux')
  })
})
