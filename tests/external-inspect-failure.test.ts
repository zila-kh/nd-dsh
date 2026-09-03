import { describe, expect, it, vi, afterEach } from 'vitest'
import { pickElementInExternalApp, type ExternalPick } from '../src/main/capture/external-inspect.js'

/**
 * The external inspector attaches to a loopback CDP endpoint over the global
 * WebSocket. These tests drive pickElementInExternalApp against a stubbed
 * endpoint so we can observe how a mid-flight CDP failure is surfaced.
 */

type SocketMode = 'happy' | 'evaluate-error' | 'screenshot-error'

const fakePick: ExternalPick['element'] = {
  tag: 'button',
  id: 'todo-add',
  box: { x: 10, y: 20, width: 52, height: 34 },
}

interface OutboundMessage {
  id: number
  method: string
  params: Record<string, unknown>
}

class FakeSocket {
  private readonly listeners = new Map<string, (event: { data: unknown }) => void>()
  private onOpen: (() => void) | null = null
  readonly sent: OutboundMessage[] = []

  constructor(_url: string, private readonly mode: SocketMode = 'happy') {
    // Fire the open handshake asynchronously, like a real socket.
    queueMicrotask(() => this.onOpen?.())
  }

  addEventListener(type: string, callback: ((event: { data: unknown }) => void) | (() => void)): void {
    if (type === 'open') this.onOpen = callback as () => void
    else this.listeners.set(type, callback as (event: { data: unknown }) => void)
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as OutboundMessage
    this.sent.push(message)
    const respond = (payload: { result?: unknown; error?: { message?: string } }): void => {
      queueMicrotask(() => {
        this.listeners.get('message')?.({ data: JSON.stringify({ id: message.id, ...payload }) })
      })
    }
    if (message.method === 'Runtime.evaluate') {
      if (this.mode === 'evaluate-error') {
        respond({ error: { message: 'Connection closed before the page answered' } })
      } else {
        respond({ result: { result: { type: 'object', value: fakePick } } })
      }
      return
    }
    if (message.method === 'Page.captureScreenshot') {
      if (this.mode === 'screenshot-error') respond({ error: { message: 'Protected region refused the crop' } })
      else respond({ result: { data: 'aGVsbG8=' } })
      return
    }
    respond({ result: {} })
  }

  close(): void {
    // No-op.
  }
}

function stubEndpoint(mode: SocketMode): { fetchImpl: typeof fetch; restore: () => void } {
  const fakeFetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: 'page-1', type: 'page', title: 'Todo (Electron demo)', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/1' }],
  })) as unknown as typeof fetch

  const originalWebSocket = globalThis.WebSocket
  const FakeSocketClass = function (url: string) {
    return new FakeSocket(url, mode)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as typeof WebSocket
  globalThis.WebSocket = FakeSocketClass

  return {
    fetchImpl: fakeFetch,
    restore: () => {
      globalThis.WebSocket = originalWebSocket
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pickElementInExternalApp failure surfacing', () => {
  it('returns a picked outcome on the happy path and still captures the crop', async () => {
    const stub = stubEndpoint('happy')
    try {
      const outcome = await pickElementInExternalApp(9333, stub.fetchImpl)
      expect(outcome.kind).toBe('picked')
      if (outcome.kind === 'picked') {
        expect(outcome.pick.element.tag).toBe('button')
        expect(outcome.screenshot?.mediaType).toBe('image/png')
      }
    } finally {
      stub.restore()
    }
  })

  it('returns unreachable instead of throwing when Runtime.evaluate fails mid-flight', async () => {
    const stub = stubEndpoint('evaluate-error')
    try {
      const outcome = await pickElementInExternalApp(9333, stub.fetchImpl)
      expect(outcome.kind).toBe('unreachable')
    } finally {
      stub.restore()
    }
  })

  it('keeps the pick even when the crop is refused', async () => {
    const stub = stubEndpoint('screenshot-error')
    try {
      const outcome = await pickElementInExternalApp(9333, stub.fetchImpl)
      expect(outcome.kind).toBe('picked')
      if (outcome.kind === 'picked') expect(outcome.screenshot).toBeUndefined()
    } finally {
      stub.restore()
    }
  })

  it('returns unreachable when the debug port answers with no page target', async () => {
    const noTargetFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 'worker-1', type: 'worker', webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/worker/1' }],
    })) as unknown as typeof fetch
    const outcome = await pickElementInExternalApp(9333, noTargetFetch)
    expect(outcome.kind).toBe('unreachable')
  })
})
