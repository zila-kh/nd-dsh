import type { Readable, Writable } from 'node:stream'

/**
 * ND-owned line client for the ZCode Protocol stdio transport exposed by
 * `zcode app-server`. Messages are newline-delimited JSON objects without a
 * JSON-RPC envelope: client requests carry `{id, method, params}`, server
 * requests reuse the same shape (their ids are server-chosen strings), and
 * both answer with `{id, result}` or `{id, error:{code, message, data?}}`.
 * Bare `{method, params}` objects are notifications. The wire owns only
 * framing, correlation, and server-request answering; session state and
 * product policy live in {@link ZcodeCliEngine}.
 */

export type ZcodeJsonObject = Record<string, unknown>

export interface ZcodeWireError {
  code: number
  message: string
  data?: unknown
}

export interface ZcodeWireHandlers {
  /** Product notifications such as `session/event` and `state.updated`. */
  onNotification(method: string, params: ZcodeJsonObject): void
  /**
   * Server-initiated requests such as `interaction/requestPermission` and
   * `session/requestRuntimePreferences`; resolve with the result object.
   */
  onServerRequest(method: string, params: ZcodeJsonObject): Promise<unknown>
  /** Fatal protocol failure. The wire rejects outstanding requests afterwards. */
  onProtocolError(error: Error): void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

function isObject(value: unknown): value is ZcodeJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isProtocolId(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number'
}

export class ZcodeProtocolRequestError extends Error {
  constructor(
    readonly wireCode: number,
    readonly wireMessage: string,
    readonly wireData: unknown,
  ) {
    super(wireMessage)
  }
}

/** One live connection to `zcode app-server`. */
export class ZcodeAppServerWire {
  private nextRequestId = 1
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly serverRequests = new Map<string | number, (result: unknown) => void>()
  private buffer = ''
  private closed = false

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly handlers: ZcodeWireHandlers,
    private readonly defaultTimeoutMs = 30_000,
  ) {
    this.input.setEncoding('utf8')
    this.input.on('data', (chunk: string) => this.consume(chunk))
    this.input.on('error', (error: Error) => this.fail(error))
    this.input.on('end', () => this.fail(new Error('ZCode app-server protocol stream closed')))
    this.output.on('error', (error: Error) => this.fail(error))
  }

  /** Send one client request and resolve with the server's `result`. */
  request(method: string, params?: ZcodeJsonObject, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('ZCode app-server wire is closed'))
    const id = this.nextRequestId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`ZCode app-server request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ id, method, ...(params === undefined ? {} : { params }) })
    })
  }

  /** Answer a server-initiated request identified by its wire id. */
  respond(requestId: string | number, result: unknown): void {
    this.send({ id: requestId, result })
  }

  /** Answer a server-initiated request with a protocol error (fail closed). */
  failRequest(requestId: string | number, message: string): void {
    this.send({ id: requestId, error: { code: -32601, message } })
  }

  close(): void {
    this.closed = true
    for (const [, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new Error('ZCode app-server wire is closed'))
    }
    this.pending.clear()
    this.serverRequests.clear()
  }

  private send(message: ZcodeJsonObject): void {
    this.output.write(`${JSON.stringify(message)}\n`)
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
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      this.fail(new Error(`ZCode app-server sent an unparseable message: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    if (!isObject(parsed)) {
      this.fail(new Error('ZCode app-server sent a non-object protocol message'))
      return
    }
    // Server-initiated request: an id plus a method. ND answers these.
    if (isProtocolId(parsed.id) && typeof parsed.method === 'string') {
      const requestId = parsed.id
      const method = parsed.method
      const params = isObject(parsed.params) ? parsed.params : {}
      Promise.resolve()
        .then(() => this.handlers.onServerRequest(method, params))
        .then(
          (result) => this.respond(requestId, result ?? {}),
          (error: unknown) => this.failRequest(requestId, error instanceof Error ? error.message : String(error)),
        )
        .catch(() => {})
      return
    }
    // Response to one of our requests.
    if (isProtocolId(parsed.id) && parsed.method === undefined) {
      const pending = this.pending.get(parsed.id)
      if (!pending) return
      this.pending.delete(parsed.id)
      clearTimeout(pending.timer)
      if (parsed.error !== undefined) {
        const error = isObject(parsed.error) ? parsed.error : {}
        pending.reject(new ZcodeProtocolRequestError(
          typeof error.code === 'number' ? error.code : 0,
          typeof error.message === 'string' ? error.message : 'ZCode app-server request failed',
          error.data,
        ))
        return
      }
      pending.resolve(parsed.result)
      return
    }
    // Notification.
    if (typeof parsed.method === 'string') {
      this.handlers.onNotification(parsed.method, isObject(parsed.params) ? parsed.params : {})
      return
    }
    this.fail(new Error(`ZCode app-server sent an unrecognized protocol message: ${line.slice(0, 120)}`))
  }

  private fail(error: Error): void {
    if (this.closed) return
    this.close()
    this.handlers.onProtocolError(error)
  }
}

/** True when a wire error means the native session no longer exists. */
export function isSessionNotFound(error: unknown): boolean {
  if (error instanceof ZcodeProtocolRequestError) {
    return typeof error.wireData === 'object' && error.wireData !== null
      && (error.wireData as ZcodeJsonObject).code === 'proto.sessionNotFound'
  }
  const message = error instanceof Error ? error.message : String(error)
  return /session/i.test(message) && /not\s*found/i.test(message)
}
