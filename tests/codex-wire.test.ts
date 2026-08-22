import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CodexAppServerWire, pickDecision, type JsonObject } from '../src/main/engines/codex/codex-wire.js'

interface Harness {
  wire: CodexAppServerWire
  /** Frames the ND side wrote to the app-server. */
  sent: JsonObject[]
  notifications: Array<{ method: string; params: JsonObject }>
  protocolErrors: Error[]
  respondToServer(handler: (method: string, params: JsonObject) => Promise<unknown>): void
  /** Simulate one frame coming from the app-server process. */
  receive(frame: JsonObject): void
}

function setup(): Harness {
  const input = new PassThrough() // app-server stdout (ND reads)
  const output = new PassThrough() // app-server stdin (ND writes)
  const sent: JsonObject[] = []
  let buffered = ''
  output.on('data', (chunk: string) => {
    buffered += chunk
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim()
      buffered = buffered.slice(newline + 1)
      if (line) sent.push(JSON.parse(line) as JsonObject)
      newline = buffered.indexOf('\n')
    }
  })
  const notifications: Array<{ method: string; params: JsonObject }> = []
  const protocolErrors: Error[] = []
  let serverHandler: (method: string, params: JsonObject) => Promise<unknown> = () => Promise.resolve({})
  const wire = new CodexAppServerWire(input, output, {
    onNotification: (method, params) => notifications.push({ method, params }),
    onServerRequest: (method, params) => serverHandler(method, params),
    onProtocolError: (error) => protocolErrors.push(error),
  })
  return {
    wire,
    sent,
    notifications,
    protocolErrors,
    respondToServer: (handler) => { serverHandler = handler },
    receive: (frame) => input.write(`${JSON.stringify(frame)}\n`),
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function flush(harness: Harness): Promise<void> {
  await tick()
  await tick()
}

/** Complete the initialize/initialized handshake and return the next request id. */
async function handshake(harness: Harness): Promise<number> {
  harness.wire.start()
  await flush(harness)
  const initializeRequest = harness.sent[0]
  expect(initializeRequest?.method).toBe('initialize')
  const id = initializeRequest?.id as number
  harness.receive({ id, result: {} })
  await flush(harness)
  expect(harness.sent.at(-1)?.method).toBe('initialized')
  return id
}

describe('CodexAppServerWire', () => {
  it('performs the initialize handshake before any other request', async () => {
    const harness = setup()
    await handshake(harness)
    expect(harness.sent[0]?.method).toBe('initialize')
    const params = harness.sent[0]?.params as JsonObject
    expect(params.clientInfo).toEqual({ name: 'nd-dsh', title: 'ND-DSH', version: '0.0.1' })
    expect(harness.protocolErrors).toHaveLength(0)
    harness.wire.close()
  })

  it('creates threads with the requested policy and returns the thread id', async () => {
    const harness = setup()
    await handshake(harness)
    const pending = harness.wire.startThread({ cwd: '/workspace', approvalPolicy: 'never' })
    await flush(harness)
    const request = harness.sent.at(-1)
    expect(request?.method).toBe('thread/start')
    const params = (request?.params ?? {}) as Record<string, unknown>
    expect(params.cwd).toBe('/workspace')
    expect(params.approvalPolicy).toBe('never')
    harness.receive({ id: request?.id, result: { thread: { id: 'thr-42', ephemeral: false } } })
    await expect(pending).resolves.toBe('thr-42')
    harness.wire.close()
  })

  it('starts turns with text-only input items and forwards product notifications', async () => {
    const harness = setup()
    await handshake(harness)
    const pending = harness.wire.startTurn('thr-42', ['do the thing'])
    await flush(harness)
    const request = harness.sent.at(-1)
    expect(request?.method).toBe('turn/start')
    const params = (request?.params ?? {}) as Record<string, unknown>
    expect(params.threadId).toBe('thr-42')
    expect(params.input).toEqual([{ type: 'text', text: 'do the thing', text_elements: [] }])
    harness.receive({ id: request?.id, result: { turn: { id: 'turn-1' } } })
    await expect(pending).resolves.toBe('turn-1')

    harness.receive({ method: 'item/completed', params: { threadId: 'thr-42', turnId: 'turn-1', item: { type: 'agentMessage', phase: 'final_answer', text: 'done' } } })
    await flush(harness)
    expect(harness.notifications.at(-1)?.method).toBe('item/completed')
    harness.wire.close()
  })

  it('correlates answers to server-initiated approval requests', async () => {
    const harness = setup()
    await handshake(harness)
    let releaseApproval: ((value: unknown) => void) | undefined
    harness.respondToServer(() => new Promise((resolve) => { releaseApproval = resolve }))
    harness.receive({ id: 91, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr-42', turnId: 'turn-1', availableDecisions: ['accepted', 'declined'] } })
    await flush(harness)
    // No answer yet: the request must stay unanswered.
    expect(harness.sent.some((frame) => frame.id === 91)).toBe(false)

    releaseApproval?.({ decision: 'accepted' })
    await flush(harness)
    const answer = harness.sent.find((frame) => frame.id === 91)
    expect(answer?.result).toEqual({ decision: 'accepted' })

    harness.respondToServer(() => Promise.reject(new Error('no')))
    harness.receive({ id: 92, method: 'item/tool/requestUserInput', params: {} })
    await flush(harness)
    const rejected = harness.sent.find((frame) => frame.id === 92)
    expect(rejected?.error).toBeDefined()
    harness.wire.close()
  })

  it('interrupts the active turn without failing the connection', async () => {
    const harness = setup()
    await handshake(harness)
    harness.wire.interrupt('thr-42', 'turn-1')
    await flush(harness)
    expect(harness.sent.at(-1)?.method).toBe('turn/interrupt')
    expect(harness.protocolErrors).toHaveLength(0)
    harness.wire.close()
  })

  it('rejects outstanding requests and reports a fatal error when the stream closes', async () => {
    const harness = setup()
    await handshake(harness)
    const pending = harness.wire.startTurn('thr-42', ['work'])
    await flush(harness)
    ;(harness.wire as unknown as { input: PassThrough }).input.end()
    await expect(pending).rejects.toThrow(/closed/i)
    expect(harness.protocolErrors).toHaveLength(1)

    // After close, further requests fail fast instead of hanging.
    await expect(harness.wire.startThread({ cwd: '/w', approvalPolicy: 'never' })).rejects.toThrow(/closed/i)
  })
})

describe('pickDecision', () => {
  it('maps allow/deny intent onto the decisions the server actually offered', () => {
    expect(pickDecision(['accepted', 'declined'], true)).toBe('accepted')
    expect(pickDecision(['accepted', 'declined'], false)).toBe('declined')
    expect(pickDecision(['cancel', 'decline'], false)).toBe('decline')
  })

  it('falls back safely when the offer is missing or unrecognized', () => {
    expect(pickDecision(undefined, false)).toBe('decline')
    expect(pickDecision(['weird'], true)).toBe('weird')
    expect(pickDecision([], false)).toBe('decline')
  })
})
