import { EventEmitter } from 'node:events'

/** A controllable transport: close delivery is deliberately separate from close(). */
export default class GatewayWebSocket extends EventEmitter {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static readonly instances: GatewayWebSocket[] = []

  readyState: number = GatewayWebSocket.CONNECTING
  readonly sent: Record<string, unknown>[] = []
  readonly url: string

  constructor(url: string | URL, readonly options?: unknown) {
    super()
    this.url = String(url)
    GatewayWebSocket.instances.push(this)
  }

  open(): void {
    this.readyState = GatewayWebSocket.OPEN
    this.emit('open')
  }

  send(data: string): void {
    if (this.readyState !== GatewayWebSocket.OPEN) throw new Error('Socket is not open')
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  receive(frame: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)))
  }

  close(): void {
    this.readyState = GatewayWebSocket.CLOSING
  }

  finishClose(): void {
    this.readyState = GatewayWebSocket.CLOSED
    this.emit('close', 1000, Buffer.alloc(0))
  }

  addEventListener(event: string, listener: (event: { data?: unknown }) => void): void {
    this.on(event, (data: unknown) => listener(event === 'message' ? { data } : {}))
  }
}
