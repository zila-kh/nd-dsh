import type { Readable, Writable } from 'node:stream'

/**
 * ND-owned JSON-RPC line client for the official Codex app-server stdio
 * protocol (pinned vendored payload, currently 0.147.0). The wire owns only
 * framing, request correlation, and the fixed handshake; thread/turn state
 * and product policy live in {@link CodexCliEngine}.
 */

export type JsonObject = Record<string, unknown>

const REQUEST_TIMEOUT_MS = 120_000

export interface CodexWireHandlers {
  /** Product notifications such as `turn/started`, `item/*`, `turn/completed`. */
  onNotification(method: string, params: JsonObject): void
  /** Server-initiated requests such as approval elicitation; resolve with the result object. */
  onServerRequest(method: string, params: JsonObject): Promise<unknown>
  /** Fatal protocol failure. The wire rejects outstanding requests afterwards. */
  onProtocolError(error: Error): void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asRecord(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`Codex app-server returned an invalid ${label}`)
  return value
}

export function asText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Codex app-server returned an invalid ${label}`)
  return value
}

/** One live connection to `codex app-server --stdio`. */
export class CodexAppServerWire {
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private buffer = ''
  private closed = false

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handlers: CodexWireHandlers,
  ) {
    this.input.setEncoding('utf8')
    this.input.on('data', (chunk: string) => this.consume(chunk))
    this.input.on('error', (error: Error) => this.fail(error))
    this.input.on('end', () => this.fail(new Error('Codex app-server protocol stream closed')))
    this.output.on('error', (error: Error) => this.fail(error))
  }

  start(): void {
    void this.request('initialize', {
      clientInfo: { name: 'nd-dsh', title: 'ND-DSH', version: '0.0.1' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }).then((result) => {
      asRecord(result, 'initialize response')
      this.send({ method: 'initialized' })
    }, (error: Error) => this.fail(error))
  }

  /** Create a thread and return its id. */
  async startThread(params: { cwd: string; approvalPolicy: string; sandbox?: string }): Promise<string> {
    const response = asRecord(await this.request('thread/start', {
      ...params,
      ephemeral: false,
    }), 'thread/start response')
    const thread = asRecord(response.thread, 'thread/start thread')
    return asText(thread.id, 'thread/start thread id')
  }

  /** Submit one text-only user turn and return the turn id. */
  async startTurn(threadId: string, texts: readonly string[]): Promise<string> {
    const response = asRecord(await this.request('turn/start', {
      threadId,
      input: texts.map((text) => ({ type: 'text', text, text_elements: [] })),
    }), 'turn/start response')
    const turn = asRecord(response.turn, 'turn/start turn')
    return asText(turn.id, 'turn/start turn id')
  }

  /** Best-effort remote cancellation of the active turn. */
  interrupt(threadId: string, turnId: string): void {
    void this.request('turn/interrupt', { threadId, turnId }).catch(() => {})
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Codex app-server connection closed'))
    }
    this.pending.clear()
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: JsonObject
    try {
      const parsed: unknown = JSON.parse(line)
      message = asRecord(parsed, 'protocol frame')
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
      return
    }
    try {
      this.dispatch(message)
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private dispatch(message: JsonObject): void {
    if (typeof message.id === 'number' && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error !== undefined) {
        const error = asRecord(message.error, 'protocol error payload')
        pending.reject(new Error(`Codex app-server request failed: ${String(error.message ?? error.code ?? 'unknown error')}`))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (typeof message.method === 'string' && typeof message.id === 'number' && message.result === undefined) {
      // Server-initiated request; keep the correlation id for the responder.
      const requestId = message.id
      const method = message.method
      const params = isObject(message.params) ? message.params : {}
      void this.handlers.onServerRequest(method, params).then(
        (result) => {
          if (!this.closed) this.send({ id: requestId, result })
        },
        (error: unknown) => {
          if (!this.closed) {
            this.send({
              id: requestId,
              error: { code: 'nd_dsh_engine_error', message: error instanceof Error ? error.message : String(error) },
            })
          }
        },
      )
      return
    }
    if (typeof message.method === 'string') {
      const params = isObject(message.params) ? message.params : {}
      this.handlers.onNotification(message.method, params)
    }
  }

  private send(payload: JsonObject): void {
    if (this.closed) return
    try {
      this.output.write(`${JSON.stringify(payload)}\n`)
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private request(method: string, params: JsonObject): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex app-server connection closed'))
    const id = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex app-server request timed out: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, method, params })
    })
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.close()
    this.handlers.onProtocolError(error)
  }
}

/** Decisions Codex offers for interactive approvals, grouped by polarity. */
export const POSITIVE_DECISIONS = ['accepted', 'accept', 'approved', 'approve', 'allow', 'allowed'] as const
export const NEGATIVE_DECISIONS = ['declined', 'decline', 'denied', 'deny', 'rejected', 'reject', 'cancel', 'cancelled'] as const

/**
 * Pick the concrete decision string Codex offered for the intended polarity.
 * Falls back to the safest well-known value when the offer is unparseable.
 */
export function pickDecision(availableDecisions: unknown, allow: boolean): string {
  const offered = Array.isArray(availableDecisions) ? availableDecisions.filter((item): item is string => typeof item === 'string') : []
  const preferred = allow ? POSITIVE_DECISIONS : NEGATIVE_DECISIONS
  for (const candidate of preferred) {
    if (offered.includes(candidate)) return candidate
  }
  if (!allow && offered.includes('cancel')) return 'cancel'
  return allow ? (offered[0] ?? 'accepted') : 'decline'
}

export { isObject }
