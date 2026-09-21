import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { spawn as nodeSpawn } from 'node:child_process'
import process from 'node:process'
import type { CoreClient } from './core-client.js'
import type { NdCoreEventFrame } from './core-protocol.js'
import type { ExecutionCoordinator } from '../organization/execution-coordinator.js'

interface ProcessSpawnResult {
  processId: string
  pid: number
  startedAt: number
}

interface ProcessOutputEvent {
  processId: string
  stream: 'stdout' | 'stderr'
  bytes: Uint8Array
}

interface ProcessExitEvent {
  processId: string
  pid: number
  exitCode: number
  durationMs: number
}

type SpawnLike = typeof nodeSpawn

export function createCoreSpawn(
  core: CoreClient,
  coordinator?: Pick<ExecutionCoordinator, 'currentPermitId'>,
): SpawnLike {
  const spawn = ((
    command: string,
    argsOrOptions?: readonly string[] | SpawnOptions,
    maybeOptions?: SpawnOptions,
  ): ChildProcess => {
    const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : []
    const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) ?? {}
    return new CoreChildProcess(core, coordinator, command, args, options).asChildProcess()
  }) as SpawnLike
  return spawn
}

class CoreChildProcess extends EventEmitter {
  readonly stdin: Writable
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdio: [Writable, PassThrough, PassThrough, null, null]
  readonly spawnfile: string
  readonly spawnargs: string[]
  pid: number | undefined
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed = false
  connected = false
  channel = null

  private readonly processId = randomUUID()
  private readonly spawnPromise: Promise<ProcessSpawnResult>
  private disposeOutput: (() => void) | undefined
  private disposeExit: (() => void) | undefined
  private settled = false

  constructor(
    private readonly core: CoreClient,
    private readonly coordinator: Pick<ExecutionCoordinator, 'currentPermitId'> | undefined,
    command: string,
    args: string[],
    options: SpawnOptions,
  ) {
    super()
    this.spawnfile = command
    this.spawnargs = [command, ...args]
    this.stdio = [this.stdin = this.createStdin(), this.stdout, this.stderr, null, null]

    this.disposeOutput = core.onEvent<ProcessOutputEvent>('process.output', (frame) => this.onOutput(frame))
    this.disposeExit = core.onEvent<ProcessExitEvent>('process.exit', (frame) => this.onExit(frame))

    const environment: Record<string, string> = {}
    for (const [key, value] of Object.entries(options.env ?? process.env)) {
      if (typeof value === 'string') environment[key] = value
    }

    const permitId = coordinator?.currentPermitId()
    this.spawnPromise = core.request<ProcessSpawnResult>('process.spawn', {
      id: this.processId,
      ...(permitId ? { permitId } : {}),
      command,
      args,
      cwd: typeof options.cwd === 'string' ? options.cwd : process.cwd(),
      env: environment,
      inheritEnv: false,
    }, 30_000)

    void this.spawnPromise.then((result) => {
      if (this.settled) {
        void this.core.request('process.cancel', { processId: this.processId }).catch(() => undefined)
        return
      }
      this.pid = result.pid
      this.emit('spawn')
      if (this.killed) void this.cancel()
    }, (error) => {
      if (this.settled) return
      this.settled = true
      this.dispose()
      queueMicrotask(() => {
        this.emit('error', error instanceof Error ? error : new Error(String(error)))
        this.emit('close', -1, null)
      })
    })
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }

  kill(_signal?: NodeJS.Signals | number): boolean {
    if (this.settled) return false
    this.killed = true
    void this.cancel()
    return true
  }

  ref(): this {
    return this
  }

  unref(): this {
    return this
  }

  disconnect(): void {
    this.connected = false
  }

  send(): boolean {
    return false
  }

  private createStdin(): Writable {
    return new Writable({
      write: (chunk, _encoding, callback) => {
        const data = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
        void this.spawnPromise
          .then(() => this.core.request('process.write', { processId: this.processId, data }, 30_000))
          .then(() => callback(), (error) => callback(error instanceof Error ? error : new Error(String(error))))
      },
      final: (callback) => {
        void this.spawnPromise
          .then(() => this.core.request('process.closeStdin', { processId: this.processId }, 5_000))
          .then(() => callback(), (error) => callback(error instanceof Error ? error : new Error(String(error))))
      },
    })
  }

  private onOutput(frame: NdCoreEventFrame<ProcessOutputEvent>): void {
    if (frame.resourceId !== this.processId || this.settled) return
    const bytes = frame.data?.bytes
    if (!(bytes instanceof Uint8Array)) return
    const target = frame.data.stream === 'stderr' ? this.stderr : this.stdout
    target.write(Buffer.from(bytes))
  }

  private onExit(frame: NdCoreEventFrame<ProcessExitEvent>): void {
    if (frame.resourceId !== this.processId || this.settled) return
    this.settled = true
    this.exitCode = frame.data.exitCode
    this.stdout.end()
    this.stderr.end()
    this.dispose()
    this.emit('exit', this.exitCode, this.signalCode)
    this.emit('close', this.exitCode, this.signalCode)
  }

  private async cancel(): Promise<void> {
    try {
      await this.spawnPromise
      await this.core.request('process.cancel', { processId: this.processId }, 5_000)
    } catch {
      // Spawn failure or an already-dead process is reflected through events.
    }
  }

  private dispose(): void {
    this.disposeOutput?.()
    this.disposeExit?.()
    this.disposeOutput = undefined
    this.disposeExit = undefined
  }
}
