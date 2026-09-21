import { randomUUID } from 'node:crypto'
import type { NdCoreEventFrame } from './core-protocol.js'
import type { CoreClient } from './core-client.js'
import type { PtyProcessLike, PtySpawner, PtySpawnOptions } from '../terminal/terminal-manager.js'

interface CoreTerminalCreateResult {
  terminalId: string
  sessionId: string
  pid?: number
  shell: string
  generation: number
  restarted: boolean
}

interface CoreTerminalOutput {
  terminalId: string
  sessionId: string
  generation: number
  bytes: Uint8Array
}

interface CoreTerminalExit {
  terminalId: string
  sessionId: string
  generation: number
  exitCode: number
  signal?: string
}

interface CoreTerminalState {
  terminalId: string
  running: boolean
  generation: number
  restartCount: number
  exitCode?: number
  seq: number
  firstRetainedSeq: number
  droppedThroughSeq: number
  retainedBytes: number
  bytes: Uint8Array
}

/**
 * What a core-managed terminal reports about the shell it currently owns.
 *
 * `generation` moves when the shell is replaced, so a caller can tell a restart
 * from a stall, and a superseded shell is never reported as running.
 */
export interface CoreShellState {
  running: boolean
  generation: number
  restartCount: number
  exitCode?: number
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

/**
 * The shell state of a core terminal, or `undefined` when nd-core no longer knows
 * the terminal at all — which is what a client sees for a terminal that belonged to
 * a sidecar generation that has since restarted.
 */
export async function readCoreShellState(
  core: Pick<CoreClient, 'request'>,
  terminalId: string,
): Promise<CoreShellState | undefined> {
  try {
    const state = await core.request<CoreTerminalState>(
      'terminal.state',
      { terminalId },
      5_000,
    )
    return {
      running: state.running,
      generation: state.generation,
      restartCount: state.restartCount,
      ...(state.exitCode === undefined ? {} : { exitCode: state.exitCode }),
    }
  } catch {
    return undefined
  }
}

class CorePtyProcess implements PtyProcessLike {
  pid: number
  private terminal: CoreTerminalCreateResult
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  private readonly decoder = new TextDecoder()
  private readonly disposeOutput: () => void
  private readonly disposeExit: () => void
  private closed = false

  constructor(
    private readonly core: CoreClient,
    terminal: CoreTerminalCreateResult,
  ) {
    this.terminal = terminal
    this.pid = terminal.pid ?? 0
    this.disposeOutput = core.onEvent<CoreTerminalOutput>('terminal.output', (frame) => this.output(frame))
    this.disposeExit = core.onEvent<CoreTerminalExit>('terminal.exit', (frame) => this.exited(frame))
  }

  /**
   * Replace this terminal's shell without giving up its identity. nd-core keeps the
   * terminal id, continues its output sequence, and reports a new generation; the
   * listeners registered here stay attached to the same terminal.
   */
  async restart(cols: number, rows: number): Promise<number> {
    if (this.closed) throw new Error('Terminal is not running')
    const result = await this.core.request<CoreTerminalCreateResult>(
      'terminal.restart',
      { terminalId: this.terminal.terminalId, cols, rows },
      30_000,
    )
    this.terminal = result
    this.pid = result.pid ?? 0
    return this.pid
  }

  /** Whether the shell behind this terminal is still alive, per nd-core. */
  async shellState(): Promise<CoreShellState | undefined> {
    return await readCoreShellState(this.core, this.terminal.terminalId)
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
    // A superseded generation ending is not this terminal ending: only the
    // generation that is current may close the client-side terminal.
    if (frame.data.generation < this.terminal.generation) return
    this.closed = true
    const tail = this.decoder.decode()
    if (tail) for (const listener of this.dataListeners) listener(tail)
    for (const listener of this.exitListeners) listener({ exitCode: frame.data.exitCode })
    this.disposeOutput()
    this.disposeExit()
  }
}
