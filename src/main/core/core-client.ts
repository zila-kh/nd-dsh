import { decode, encode } from '@msgpack/msgpack'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import process from 'node:process'
import { assertNdCoreBinary } from './core-path.js'
import {
  ND_CORE_MAX_FRAME_BYTES,
  ND_CORE_PROTOCOL_VERSION,
  type NdCoreEventFrame,
  type NdCoreHealth,
  type NdCoreResponseFrame,
} from './core-protocol.js'

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export interface CoreClientOptions {
  binaryPath?: string
  log?(line: string): void
  onUnexpectedExit?(code: number | null, signal: NodeJS.Signals | null): void
}

export class CoreClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private buffer = Buffer.alloc(0)
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(frame: NdCoreEventFrame) => void>>()
  private starting: Promise<NdCoreHealth> | undefined
  private healthValue: NdCoreHealth | undefined
  private closing = false
  private restartAttempts = 0
  private generation = 0

  constructor(private readonly options: CoreClientOptions = {}) {}

  get health(): NdCoreHealth | undefined {
    return this.healthValue
  }

  get running(): boolean {
    return Boolean(this.child && !this.child.killed && this.healthValue)
  }

  async start(): Promise<NdCoreHealth> {
    if (this.healthValue && this.child && !this.child.killed) return this.healthValue
    if (this.starting) return this.starting
    this.starting = this.spawnAndHandshake()
    try {
      return await this.starting
    } finally {
      this.starting = undefined
    }
  }

  async request<T>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    await this.start()
    return await this.sendRequest<T>(method, params, timeoutMs)
  }

  onEvent<T = unknown>(event: string, listener: (frame: NdCoreEventFrame<T>) => void): () => void {
    let bucket = this.listeners.get(event)
    if (!bucket) {
      bucket = new Set()
      this.listeners.set(event, bucket)
    }
    const wrapped = listener as (frame: NdCoreEventFrame) => void
    bucket.add(wrapped)
    return () => {
      bucket?.delete(wrapped)
      if (bucket?.size === 0) this.listeners.delete(event)
    }
  }

  async close(): Promise<void> {
    this.closing = true
    this.healthValue = undefined
    const child = this.child
    this.child = undefined
    if (!child) return

    child.stdin.end()
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve()
        return
      }
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* already exited */ }
        resolve()
      }, 750)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.rejectPending(new Error('ND Core is shutting down.'))
  }

  private async spawnAndHandshake(): Promise<NdCoreHealth> {
    this.closing = false
    const binary = assertNdCoreBinary(this.options.binaryPath)
    const generation = ++this.generation
    this.options.log?.('[nd-core] launch ' + binary)

    const child = spawn(binary, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        RUST_BACKTRACE: process.env.RUST_BACKTRACE ?? '1',
      },
    })
    this.child = child
    this.buffer = Buffer.alloc(0)

    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(generation, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const line = chunk.trimEnd()
      if (line) this.options.log?.(line)
    })
    child.once('error', (error) => {
      if (generation !== this.generation) return
      this.rejectPending(error)
    })
    child.once('exit', (code, signal) => this.handleExit(generation, code, signal))

    const health = await this.sendRequest<NdCoreHealth>('core.health', {}, 5_000)
    if (health.protocolVersion !== ND_CORE_PROTOCOL_VERSION) {
      try { child.kill() } catch { /* best effort */ }
      throw new Error(
        'ND Core protocol mismatch: desktop=' + ND_CORE_PROTOCOL_VERSION + ', core=' + health.protocolVersion + '.',
      )
    }
    this.healthValue = health
    this.restartAttempts = 0
    this.options.log?.(
      '[nd-core] ready v' + health.binaryVersion + ' protocol=' + health.protocolVersion + ' ' + health.platform + '/' + health.arch,
    )
    this.emitSyntheticEvent('core.ready', 'high', health)
    return health
  }

  private sendRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const child = this.child
    if (!child || child.killed || child.stdin.destroyed) {
      return Promise.reject(new Error('ND Core is not running.'))
    }
    if (!method || method.length > 128) return Promise.reject(new Error('Invalid ND Core method.'))

    const id = randomUUID()
    const encoded = Buffer.from(encode({
      version: ND_CORE_PROTOCOL_VERSION,
      kind: 'request',
      id,
      method,
      params,
    }))
    if (encoded.length > ND_CORE_MAX_FRAME_BYTES) {
      return Promise.reject(new Error('ND Core request exceeds the protocol frame limit.'))
    }
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(encoded.length, 0)

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('ND Core request timed out: ' + method))
      }, Math.max(250, timeoutMs))
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      child.stdin.write(Buffer.concat([header, encoded]), (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  private handleStdout(generation: number, chunk: Buffer): void {
    if (generation !== this.generation) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length <= 0 || length > ND_CORE_MAX_FRAME_BYTES) {
        this.failProtocol(new Error('Invalid ND Core frame length: ' + length))
        return
      }
      if (this.buffer.length < 4 + length) return
      const payload = this.buffer.subarray(4, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      let decoded: unknown
      try {
        decoded = decode(payload)
      } catch (error) {
        this.failProtocol(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.handleFrame(decoded)
    }
  }

  private handleFrame(value: unknown): void {
    if (!record(value) || value.version !== ND_CORE_PROTOCOL_VERSION || typeof value.kind !== 'string') {
      this.failProtocol(new Error('Malformed ND Core protocol frame.'))
      return
    }
    if (value.kind === 'response') {
      const frame = value as unknown as NdCoreResponseFrame
      if (typeof frame.id !== 'string') {
        this.failProtocol(new Error('ND Core response is missing its request id.'))
        return
      }
      const pending = this.pending.get(frame.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(frame.id)
      if (frame.error) pending.reject(new Error('[' + frame.error.code + '] ' + frame.error.message))
      else pending.resolve(frame.result)
      return
    }
    if (value.kind === 'event') {
      const frame = value as unknown as NdCoreEventFrame
      if (typeof frame.event !== 'string') {
        this.failProtocol(new Error('ND Core event is missing its type.'))
        return
      }
      for (const listener of this.listeners.get(frame.event) ?? []) listener(frame)
      for (const listener of this.listeners.get('*') ?? []) listener(frame)
      return
    }
    this.failProtocol(new Error('Unsupported ND Core frame kind: ' + value.kind))
  }

  private handleExit(generation: number, code: number | null, signal: NodeJS.Signals | null): void {
    if (generation !== this.generation) return
    this.child = undefined
    this.healthValue = undefined
    this.rejectPending(new Error('ND Core exited unexpectedly (code=' + String(code) + ', signal=' + String(signal) + ').'))
    if (this.closing) return

    this.options.onUnexpectedExit?.(code, signal)
    this.emitSyntheticEvent('core.exit', 'high', { code, signal })

    if (this.restartAttempts >= 1) {
      this.options.log?.('[nd-core] restart budget exhausted; native services are unavailable.')
      return
    }
    this.restartAttempts += 1
    this.options.log?.('[nd-core] unexpected exit; attempting one automatic restart.')
    setTimeout(() => {
      if (this.closing) return
      void this.start().catch((error) => {
        this.options.log?.('[nd-core] restart failed: ' + (error instanceof Error ? error.message : String(error)))
      })
    }, 100)
  }

  private failProtocol(error: Error): void {
    this.options.log?.('[nd-core] protocol failure: ' + error.message)
    const child = this.child
    this.child = undefined
    this.healthValue = undefined
    this.rejectPending(error)
    try { child?.kill() } catch { /* best effort */ }
  }

  private emitSyntheticEvent(event: string, priority: string, data: unknown): void {
    const frame: NdCoreEventFrame = {
      version: ND_CORE_PROTOCOL_VERSION,
      kind: 'event',
      event,
      priority,
      data,
    }
    for (const listener of this.listeners.get(event) ?? []) listener(frame)
    for (const listener of this.listeners.get('*') ?? []) listener(frame)
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
