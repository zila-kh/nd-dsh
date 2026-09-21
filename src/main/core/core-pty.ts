import { randomUUID } from 'node:crypto'
import type { NdCoreEventFrame } from './core-protocol.js'
import type { CoreClient } from './core-client.js'
import type { PtyProcessLike, PtySpawner, PtySpawnOptions } from '../terminal/terminal-manager.js'

interface CoreTerminalCreateResult {
  terminalId: string
  sessionId: string
  pid?: number
  shell: string
}

interface CoreTerminalOutput {
  terminalId: string
  sessionId: string
  bytes: Uint8Array
}

interface CoreTerminalExit {
  terminalId: string
  sessionId: string
  exitCode: number
  signal?: string
}

export function createCorePtySpawner(core: CoreClient): PtySpawner {
  return async (file: string, args: string[], options: PtySpawnOptions): Promise<PtyProcessLike> => {
    const terminalId = randomUUID()
    const sessionId = options.env.ND_DSH_SESSION_ID ?? randomUUID()
    const result = await core.request<CoreTerminalCreateResult>('terminal.create', {
      terminalId,
      sessionId,
      shell: file,
      args,
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: options.env,
    })
    return new CorePtyProcess(core, result)
  }
}

class CorePtyProcess implements PtyProcessLike {
  readonly pid: number
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  private readonly decoder = new TextDecoder()
  private readonly disposeOutput: () => void
  private readonly disposeExit: () => void
  private closed = false

  constructor(
    private readonly core: CoreClient,
    private readonly terminal: CoreTerminalCreateResult,
  ) {
    this.pid = terminal.pid ?? 0
    this.disposeOutput = core.onEvent<CoreTerminalOutput>('terminal.output', (frame) => this.output(frame))
    this.disposeExit = core.onEvent<CoreTerminalExit>('terminal.exit', (frame) => this.exited(frame))
  }

  write(data: string): void {
    if (this.closed) return
    void this.core.request('terminal.write', { terminalId: this.terminal.terminalId, data })
      .catch(() => { /* state event will surface a failed terminal */ })
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return
    void this.core.request('terminal.resize', { terminalId: this.terminal.terminalId, cols, rows })
      .catch(() => { /* terminal manager keeps last requested size */ })
  }

  kill(): void {
    if (this.closed) return
    this.closed = true
    this.disposeOutput()
    this.disposeExit()
    void this.core.request('terminal.close', { terminalId: this.terminal.terminalId })
      .catch(() => { /* core crash cleanup already owns the process tree */ })
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  private output(frame: NdCoreEventFrame<CoreTerminalOutput>): void {
    if (frame.resourceId !== this.terminal.terminalId) return
    const bytes = frame.data?.bytes
    if (!(bytes instanceof Uint8Array)) return
    const text = this.decoder.decode(bytes, { stream: true })
    if (!text) return
    for (const listener of this.dataListeners) listener(text)
  }

  private exited(frame: NdCoreEventFrame<CoreTerminalExit>): void {
    if (frame.resourceId !== this.terminal.terminalId || this.closed) return
    this.closed = true
    const tail = this.decoder.decode()
    if (tail) for (const listener of this.dataListeners) listener(tail)
    for (const listener of this.exitListeners) listener({ exitCode: frame.data.exitCode })
    this.disposeOutput()
    this.disposeExit()
  }
}
