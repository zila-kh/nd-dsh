import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { QaOutputChunk, QaRunStatus, QaState, QaSuiteId, QaSuiteKind, QaSuiteState } from '../../shared/contracts.js'
import { projectRoot } from '../app-paths.js'
import { detectProjectChecks, type ProjectCheck } from './project-checks.js'

/** Fan-out consumed by the shell wiring: state snapshots plus output chunks. */
export type QaEvent =
  | { kind: 'state'; state: QaState }
  | { kind: 'output'; chunk: QaOutputChunk }

interface InternalSuiteDefinition {
  id: 'unit' | 'e2e'
  label: string
  description: string
  runner: string
  command: string[]
  /** Runner CLI entry resolved against the ND-DSH checkout. */
  entryRelativePath: string
}

const INTERNAL_SUITES: InternalSuiteDefinition[] = [
  {
    id: 'unit',
    label: 'Unit tests',
    description: "ND-DSH's own unit tests — these develop ND-DSH itself, they do not touch your project.",
    runner: 'Vitest',
    command: ['vitest', 'run'],
    entryRelativePath: join('node_modules', 'vitest', 'vitest.mjs'),
  },
  {
    id: 'e2e',
    label: 'E2E tests',
    description: "ND-DSH's own end-to-end desktop tests — these develop ND-DSH itself, they do not touch your project.",
    runner: 'Playwright',
    command: ['playwright', 'test'],
    entryRelativePath: join('node_modules', '@playwright', 'test', 'cli.js'),
  },
]

const STOP_GRACE_MS = 3_000

/** Unified per-suite snapshot used to render state, independent of suite origin. */
interface SuiteView {
  id: QaSuiteId
  kind: QaSuiteKind
  label: string
  description: string
  runner: string
  command: string
  available: boolean
}

export interface QaServiceOptions {
  /** Defaults to the resolved ND-DSH checkout (host of the internal suites). */
  root?: string
  /** Injectable for tests. */
  spawnProcess?: typeof spawn
  now?: () => number
}

interface SuiteRuntime {
  lastStatus: 'idle' | 'passed' | 'failed' | 'unavailable'
  lastExitCode?: number
  lastDurationMs?: number
  lastFinishedAt?: number
  /** Set when the runner could not start at all; cleared by the next finished run. */
  notice?: string
}

/**
 * QA runs in two flavors. Project checks are curated package.json scripts
 * (test/lint/typecheck/build) executed in the user's workspace through its
 * package manager. Internal suites run ND-DSH's own unit/e2e tooling from the
 * checkout's dev dependencies. A packaged app ships neither internal runner,
 * so those fail closed to `unavailable` instead of faking a result.
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
  private projectChecks: ProjectCheck[] = []
  private projectWorkspaceRoot: string | null = null

  constructor(options: QaServiceOptions = {}) {
    this.root = options.root ?? projectRoot()
    this.spawnProcess = options.spawnProcess ?? spawn
    this.now = options.now ?? Date.now
  }

  setListener(listener: ((event: QaEvent) => void) | undefined): void {
    this.listener = listener
  }

  /**
   * Point project checks at the user's current workspace. Detection is
   * best-effort: unreadable roots simply contribute no checks.
   */
  setProjectRoot(root: string | null): void {
    if (root === this.projectWorkspaceRoot) return
    this.projectWorkspaceRoot = root
    this.projectChecks = root ? detectProjectChecks(root) : []
    this.emit({ kind: 'state', state: this.state() })
  }

  state(): QaState {
    return { suites: this.suiteViews().map((view) => this.suiteState(view)), activeRun: this.activeSuite ?? null }
  }

  async run(suiteId: QaSuiteId): Promise<QaState> {
    const view = this.suiteViews().find((candidate) => candidate.id === suiteId)
    if (!view) throw new Error(`Unknown QA suite: ${String(suiteId)}`)
    if (this.activeSuite) throw new Error(`A QA run is already active (${this.activeSuite}). Wait for it or stop it first.`)

    const internal = INTERNAL_SUITES.find((suite) => suite.id === suiteId)
    const check = internal === undefined ? this.projectChecks.find((candidate) => candidate.id === suiteId) : undefined
    if (!view.available) {
      // Missing runner entry or workspace tooling: surface the gap, spawn nothing.
      this.emit({ kind: 'state', state: this.state() })
      return this.state()
    }

    const startedAt = this.now()
    this.stopping = false
    this.activeSuite = suiteId
    this.emit({ kind: 'state', state: this.state() })

    const spawnFile = internal ? process.execPath : check!.file
    const spawnArgs = internal
      ? [join(this.root, internal.entryRelativePath), ...internal.command.slice(1)]
      : [...check!.args]
    const child = this.spawnProcess(spawnFile, spawnArgs, {
      cwd: internal ? this.root : this.projectWorkspaceRoot!,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: runnerEnvironment(internal !== undefined),
      windowsHide: true,
      // npm/pnpm/yarn/bun are .cmd shims on Windows and need a shell to resolve.
      shell: internal === undefined && process.platform === 'win32',
      // A process group lets POSIX teardown take the whole tree down; Windows uses taskkill /T instead.
      detached: process.platform !== 'win32',
    })
    this.child = child

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const forward = (stream: 'stdout' | 'stderr'): void => {
      child[stream]?.on('data', (text: string) => {
        this.emit({ kind: 'output', chunk: { suite: suiteId, stream, text } })
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
    const canceled = this.stopping
    this.runtimes.set(suiteId, outcome.failedToStart
      ? {
          lastStatus: 'unavailable',
          lastDurationMs: Math.max(0, this.now() - startedAt),
          lastFinishedAt: this.now(),
          notice: internal
            ? 'The test runner could not be started in this checkout.'
            : 'Node.js was not found on this computer. Install it from nodejs.org, then reopen ND-DSH.',
        }
      : {
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

  private suiteViews(): SuiteView[] {
    const views: SuiteView[] = this.projectChecks.map((check) => ({
      id: check.id,
      kind: 'project' as const,
      label: check.label,
      description: check.description,
      runner: check.file,
      command: check.displayCommand,
      available: true,
    }))
    for (const suite of INTERNAL_SUITES) {
      views.push({
        id: suite.id,
        kind: 'internal',
        label: suite.label,
        description: suite.description,
        runner: suite.runner,
        command: suite.command.join(' '),
        available: existsSync(join(this.root, suite.entryRelativePath)),
      })
    }
    return views
  }

  private suiteState(view: SuiteView): QaSuiteState {
    const runtime = this.runtimes.get(view.id)
    const status: QaRunStatus = this.activeSuite === view.id
      ? 'running'
      : !view.available || runtime?.lastStatus === 'unavailable'
        ? 'unavailable'
        : runtime?.lastStatus ?? 'idle'
    return {
      id: view.id,
      kind: view.kind,
      label: view.label,
      description: view.description,
      runner: view.runner,
      command: view.command,
      status,
      ...(runtime?.lastExitCode !== undefined ? { lastExitCode: runtime.lastExitCode } : {}),
      ...(runtime?.lastDurationMs !== undefined ? { lastDurationMs: runtime.lastDurationMs } : {}),
      ...(runtime?.lastFinishedAt !== undefined ? { lastFinishedAt: runtime.lastFinishedAt } : {}),
      ...(runtime?.notice !== undefined ? { notice: runtime.notice } : {}),
    }
  }

  private emit(event: QaEvent): void {
    this.listener?.(event)
  }
}

/**
 * Test runners run as plain Node programs even when the host process is the
 * Electron binary, and ND keeps its env namespace out of spawned tooling.
 * Only internal suites get the Electron-as-Node flag.
 */
function runnerEnvironment(internal: boolean): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
    environment[key] = value
  }
  if (internal) environment.ELECTRON_RUN_AS_NODE = '1'
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
