import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import type {
  DshEventFrame,
  GatewayRpcResult,
  SessionEventEnvelope,
} from '../../shared/contracts.js'

/**
 * Loopback client for the DeepSeek Harness web-plane gateway.
 *
 * Wire protocol (owned by @deepseek-ai/dsh-host-apiproxy):
 * - Unary RPC: POST /api/<method> with a `client-request` envelope
 *   `{ type, rpcId, method, payload }`; the response body is a
 *   `server-response` envelope whose `result` is `{ ok, value | error }`.
 * - Answerable frames (approvals, questions): POST /api/respond with a
 *   `client-response` envelope echoing the frame's rpcId; the body is a
 *   `{ accepted }` receipt.
 * - Live events: WebSocket downlinks at /api/events.mux and /api/events.host.
 *   The server only pushes `server-request` frames; client messages close the
 *   socket, so no opener is sent.
 */
export class GatewayClient {
  private readonly sockets = new Set<WebSocket>()
  private closed = false

  constructor(private readonly baseUrl: string) {}

  get origin(): string {
    return new URL(this.baseUrl).origin
  }

  async rpc(method: string, payload: unknown = {}): Promise<GatewayRpcResult> {
    const rpcId = randomUUID()
    const response = await fetch(`${this.baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    })
    if (!response.ok) {
      throw new Error(`gateway ${method}: HTTP ${response.status}`)
    }
    const frame = (await response.json()) as ServerResponseFrame
    if (!frame || frame.type !== 'server-response') {
      throw new Error(`gateway ${method}: unexpected response shape`)
    }
    if (frame.result.ok) {
      return { ok: true, value: frame.result.value }
    }
    return { ok: false, error: normalizeError(frame.result.error) }
  }

  async respond(rpcId: string, value: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }),
    })
    if (!response.ok) throw new Error(`gateway respond: HTTP ${response.status}`)
    const receipt = (await response.json()) as { accepted?: boolean; reason?: string }
    if (receipt?.accepted !== true) {
      throw new Error(`gateway respond rejected: ${receipt?.reason ?? 'unknown reason'}`)
    }
  }

  openEvents(onFrame: (frame: DshEventFrame) => void): void {
    this.openSocket('/api/events.mux', onFrame)
    this.openSocket('/api/events.host', onFrame)
  }

  close(): void {
    this.closed = true
    for (const socket of this.sockets) {
      try {
        socket.close()
      } catch {
        // The socket may already be torn down.
      }
    }
    this.sockets.clear()
  }

  private openSocket(path: string, onFrame: (frame: DshEventFrame) => void): void {
    if (this.closed) return
    const base = new URL(this.baseUrl)
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${base.origin}${path}`)
    this.sockets.add(socket)
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerRequestFrame
        if (!message || message.type !== 'server-request') return
        const frame = translateFrame(message)
        if (frame) onFrame(frame)
      } catch {
        // A malformed frame is dropped; the downlink stays open.
      }
    })
    socket.addEventListener('close', () => {
      this.sockets.delete(socket)
      if (!this.closed) {
        setTimeout(() => this.openSocket(path, onFrame), 1_000)
      }
    })
  }
}

/** Reserve a loopback port for the runtime; released before the child binds. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        if (typeof port === 'number' && port > 0) resolve(port)
        else reject(new Error('No free loopback port available'))
      })
    })
  })
}

interface ServerResponseFrame {
  type: 'server-response'
  rpcId: string
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
}

interface ServerRequestFrame {
  type: 'server-request'
  rpcId: string
  method: string
  payload: unknown
}

function translateFrame(message: ServerRequestFrame): DshEventFrame | undefined {
  const payload = (message.payload ?? {}) as Record<string, unknown>
  const sessionId = asString(payload.sessionId)
  const withSession = sessionId === undefined ? {} : { sessionId }
  switch (payload.type) {
    case 'session/event':
      return { kind: 'session-event', ...withSession, event: payload.event as SessionEventEnvelope }
    case 'approval/requested': {
      const approvalId = asString(payload.approvalId)
      const toolName = asString(payload.toolName)
      const callId = asString(payload.callId)
      const reason = asString(payload.reason)
      return {
        kind: 'approval-requested',
        ...withSession,
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(toolName === undefined ? {} : { toolName }),
        ...(callId === undefined ? {} : { callId }),
        ...(reason === undefined ? {} : { reason }),
        rpcId: message.rpcId,
      }
    }
    case 'approval/resolved': {
      const approvalId = asString(payload.approvalId)
      const outcome = asString(payload.outcome)
      return {
        kind: 'approval-resolved',
        ...withSession,
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(outcome === undefined ? {} : { outcome }),
      }
    }
    case 'question/requested':
      return { kind: 'question-requested', ...withSession, questions: payload.questions, rpcId: message.rpcId }
    case 'question/resolved': {
      const outcome = asString(payload.outcome)
      return {
        kind: 'question-resolved',
        ...withSession,
        ...(outcome === undefined ? {} : { outcome }),
        rpcId: message.rpcId,
      }
    }
    case 'host/session-status':
      return { kind: 'session-status', ...withSession, running: payload.running === true }
    case 'host/session-added':
      return { kind: 'session-added', ...withSession, meta: payload }
    case 'host/session-removed':
      return { kind: 'session-removed', ...withSession }
    case 'host/agent-error':
      return { kind: 'agent-error', ...withSession, message: asString(payload.message) ?? 'Agent error' }
    case 'stream/error': {
      const error = (payload.error ?? {}) as { message?: unknown }
      return { kind: 'stream-error', message: asString(error.message) ?? 'Event stream error' }
    }
    default:
      return { kind: 'other', ...withSession, meta: payload }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function normalizeError(error: unknown): { code: string; message: string } {
  const record = (error ?? {}) as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : 'internal',
    message: typeof record.message === 'string' ? record.message : 'Gateway request failed',
  }
}
