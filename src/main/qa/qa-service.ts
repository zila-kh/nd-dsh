import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { QaOutputChunk, QaState, QaRunStatus, QaSuiteId, QaSuiteState } from '../../shared/contracts.js'
import { projectRoot } from '../app-paths.js'

/** Fan-out consumed by the shell wiring: state snapshots plus output chunks. */
export type QaEvent =
  | { kind: 'state'; state: QaState }
  | { kind: 'output'; chunk: QaOutputChunk }

interface SuiteDefinition {
  id: QaSuiteId
  label: string
  runner: string
  command: string[]
  /** Runner CLI entry resolved against the project checkout. */
  entryRelativePath: string
}

const SUITES: SuiteDefinition[] = [
  {
    id: 'unit',
    label: 'Unit tests',
    runner: 'Vitest',
    command: ['vitest', 'run'],
    entryRelativePath: join('node_modules', 'vitest', 'vitest.mjs'),
  },
  {
    id: 'e2e',
    label: 'E2E tests',
    runner: 'Playwright',
    command: ['playwright', 'test'],
    entryRelativePath: join('node_modules', '@playwright', 'test', 'cli.js'),
  },
]

const STOP_GRACE_MS = 3_000

export interface QaServiceOptions {
  /** Defaults to the resolved project checkout. */
  root?: string
  /** Injectable for tests. */
  spawnProcess?: typeof spawn
  now?: () => number
}

interface SuiteRuntime {
  lastStatus: 'idle' | 'passed' | 'failed'
  lastExitCode?: number
  lastDurationMs?: number
  lastFinishedAt?: number
}

/**
 * Runs ND-DSH's own unit/e2e suites as child processes of the checkout's dev
 * dependencies and streams their output to the renderer. A packaged app ships
 * neither runner, so suites fail closed to `unavailable` instead of faking a
 * result.
 */
export class QaService {
  private readonly root: string
  private readonly spawnProcess: typeof spawn
  private readonly now: () => number
  private readonly runtimes = new Map<QaSuiteId, SuiteRuntime>()
  private listener: ((event: QaEvent) => void) | undefined
  private activeSuite: QaSuiteId | undefined
  private child: ChildProcess | undefined
  private stopping = false

  constructor(options: QaServiceOptions = {}) {
    this.root = options.root ?? projectRoot()
    this.spawnProcess = options.spawnProcess ?? spawn
    this.now = options.now ?? Date.now
  }

  setListener(listener: ((event: QaEvent) => void) | undefined): void {
    this.listener = listener
  }

  state(): QaState {
    return { suites: SUITES.map((definition) => this.suiteState(definition)), activeRun: this.activeSuite ?? null }
  }

  async run(suiteId: QaSuiteId): Promise<QaState> {
    const definition = SUITES.find((suite) => suite.id === suiteId)
    if (!definition) throw new Error(`Unknown QA suite: ${String(suiteId)}`)
    if (this.activeSuite) throw new Error(`A QA run is already active (${this.activeSuite}). Wait for it or stop it first.`)

    const entry = join(this.root, definition.entryRelativePath)
    if (!existsSync(entry)) {
      // Unbootstrapped checkout or packaged install: surface the gap, spawn nothing.
      this.emit({ kind: 'state', state: this.state() })
      return this.state()
    }

    const startedAt = this.now()
    this.stopping = false
    this.activeSuite = definition.id
    this.emit({ kind: 'state', state: this.state() })

    const argv = [process.execPath, entry, ...definition.command.slice(1)]
    const child = this.spawnProcess(argv[0] as string, argv.slice(1), {
      cwd: this.root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: runnerEnvironment(),
      windowsHide: true,
      // A process group lets POSIX teardown take the whole tree down; Windows uses taskkill /T instead.
      detached: process.platform !== 'win32',
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const forward = (stream: 'stdout' | 'stderr'): void => {
      child[stream]?.on('data', (text: string) => {
        this.emit({ kind: 'output', chunk: { suite: definition.id, stream, text } })
      })
    }
    forward('stdout')
    forward('stderr')

    const outcome = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; failedToStart: boolean }>((resolve) => {
      let settled = false
      const settle = (result: { code: number | null; signal: NodeJS.Signals | null; failedToStart: boolean }): void => {
        if (settled) return
        settled = true
        resolve(result)
      }
      child.once('exit', (code, signal) => settle({ code, signal, failedToStart: false }))
      child.once('error', () => settle({ code: null, signal: null, failedToStart: true }))
    })

    this.child = undefined
    this.activeSuite = undefined
    const canceled = this.stopping || outcome.failedToStart
    this.runtimes.set(definition.id, {
      lastStatus: canceled ? 'idle' : outcome.code === 0 ? 'passed' : 'failed',
      ...(canceled || outcome.code === null ? {} : { lastExitCode: outcome.code }),
      lastDurationMs: Math.max(0, this.now() - startedAt),
      lastFinishedAt: this.now(),
    })
    this.emit({ kind: 'state', state: this.state() })
    return this.state()
  }

  async stop(): Promise<QaState> {
    const child = this.child
    if (!child) return this.state()
    this.stopping = true
    await killProcessTree(child, STOP_GRACE_MS)
    return this.state()
  }

  /** Window teardown: hard-stop any running suite and drop the listener. */
  async dispose(): Promise<void> {
    await this.stop()
    this.setListener(undefined)
  }

  private suiteState(definition: SuiteDefinition): QaSuiteState {
    const runtime = this.runtimes.get(definition.id)
    const status: QaRunStatus = this.activeSuite === definition.id
      ? 'running'
      : existsSync(join(this.root, definition.entryRelativePath))
        ? runtime?.lastStatus ?? 'idle'
        : 'unavailable'
    return {
      id: definition.id,
      label: definition.label,
      runner: definition.runner,
      command: definition.command.join(' '),
      status,
      ...(runtime?.lastExitCode !== undefined ? { lastExitCode: runtime.lastExitCode } : {}),
      ...(runtime?.lastDurationMs !== undefined ? { lastDurationMs: runtime.lastDurationMs } : {}),
      ...(runtime?.lastFinishedAt !== undefined ? { lastFinishedAt: runtime.lastFinishedAt } : {}),
    }
  }

  private emit(event: QaEvent): void {
    this.listener?.(event)
  }
}

/**
 * Test runners run as plain Node programs even when the host process is the
 * Electron binary. ND keeps its env namespace out of spawned tooling.
 */
function runnerEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
    environment[key] = value
  }
  environment.ELECTRON_RUN_AS_NODE = '1'
  return environment
}

/** Terminate the whole runner tree; SIGTERM first, then hard teardown. */
async function killProcessTree(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid as number), '/T', '/F'], { stdio: 'ignore' })
        } else {
          try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      } catch {
        // Already gone.
      }
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}
