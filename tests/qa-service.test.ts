import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { QaService, type QaEvent } from '../src/main/qa/qa-service.js'

interface SpawnCall {
  command: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

/** Minimal ChildProcess stand-in with controllable streams and exit. */
class FakeChild extends EventEmitter {
  pid = 4242
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: string | null = null
  killCalls: Array<string | undefined> = []

  emitExit(code: number | null, signal: string | null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  kill = (signal?: string): boolean => {
    this.killCalls.push(signal)
    queueMicrotask(() => this.emitExit(null, 'SIGTERM'))
    return true
  }
}

function makeSpawner(): { spawnProcess: typeof spawn; calls: SpawnCall[]; children: FakeChild[] } {
  const calls: SpawnCall[] = []
  const children: FakeChild[] = []
  const spawnProcess = ((command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const child = new FakeChild()
    calls.push({ command, args: [...args], ...(options ? { cwd: options.cwd, env: options.env } : {}) })
    children.push(child)
    return child as unknown as ChildProcess
  }) as unknown as typeof spawn
  return { spawnProcess, calls, children }
}

const createdRoots: string[] = []

function makeCheckout(options: { unit?: boolean; e2e?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'nd-dsh-qa-'))
  createdRoots.push(root)
  if (options.unit) {
    mkdirSync(join(root, 'node_modules', 'vitest'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'vitest', 'vitest.mjs'), '// stub runner entry\n')
  }
  if (options.e2e) {
    mkdirSync(join(root, 'node_modules', '@playwright', 'test'), { recursive: true })
    writeFileSync(join(root, 'node_modules', '@playwright', 'test', 'cli.js'), '// stub runner entry\n')
  }
  return root
}

function sequentialClock(): () => number {
  let tick = 1_000_000
  return () => (tick += 10)
}

afterEach(() => {
  for (const root of createdRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  delete process.env.ND_DSH_TEST_MARKER
})

describe('qa service', () => {
  it('fails closed to unavailable without fabricating results when runners are missing', async () => {
    const root = makeCheckout({})
    const service = new QaService({ root })

    const state = service.state()
    expect(state.activeRun).toBeNull()
    expect(state.suites.map((suite) => suite.status)).toEqual(['unavailable', 'unavailable'])

    const { spawnProcess, calls } = makeSpawner()
    const quiet = new QaService({ root, spawnProcess })
    await expect(quiet.run('unit')).resolves.toMatchObject({ activeRun: null, suites: [
      expect.objectContaining({ id: 'unit', status: 'unavailable' }),
      expect.objectContaining({ id: 'e2e', status: 'unavailable' }),
    ] })
    expect(calls).toHaveLength(0)
  })

  it('runs the unit suite through node with a clean env and records a pass', async () => {
    const root = makeCheckout({ unit: true })
    process.env.ND_DSH_TEST_MARKER = '1'
    const { spawnProcess, calls, children } = makeSpawner()
    const service = new QaService({ root, spawnProcess, now: sequentialClock() })
    const events: QaEvent[] = []
    service.setListener((event) => events.push(event))

    const pendingRun = service.run('unit')
    expect(service.state().activeRun).toBe('unit')

    children[0]?.stdout.write('run output\n')
    children[0]?.emitExit(0, null)
    const state = await pendingRun

    expect(calls).toHaveLength(1)
    const invocation = calls[0] as SpawnCall
    expect(invocation.command).toBe(process.execPath)
    expect(invocation.args[1]).toBe('run')
    expect(invocation.args[0]).toContain(join('node_modules', 'vitest', 'vitest.mjs'))
    expect(invocation.cwd).toBe(root)
    expect(invocation.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(Object.hasOwn(invocation.env ?? {}, 'ND_DSH_TEST_MARKER')).toBe(false)

    expect(state.activeRun).toBeNull()
    const unit = state.suites.find((suite) => suite.id === 'unit')
    expect(unit?.status).toBe('passed')
    expect(unit?.lastExitCode).toBe(0)
    expect(unit?.lastDurationMs).toBe(10)

    const outputs = events.filter((event): event is Extract<QaEvent, { kind: 'output' }> => event.kind === 'output')
    expect(outputs.some((event) => event.chunk.suite === 'unit' && event.chunk.stream === 'stdout' && event.chunk.text === 'run output\n')).toBe(true)
    const statuses = events
      .filter((event): event is Extract<QaEvent, { kind: 'state' }> => event.kind === 'state')
      .map((event) => event.state.suites.find((suite) => suite.id === 'unit')?.status)
    expect(statuses).toContain('running')
    expect(statuses.at(-1)).toBe('passed')
  })

  it('rejects a second run while one is active', async () => {
    const root = makeCheckout({ unit: true, e2e: true })
    const { spawnProcess, children } = makeSpawner()
    const service = new QaService({ root, spawnProcess })

    const pendingRun = service.run('unit')
    await expect(service.run('e2e')).rejects.toThrow(/already active/)
    children[0]?.emitExit(0, null)
    await expect(pendingRun).resolves.toMatchObject({ activeRun: null })
  })

  it('marks a failing run with its exit code', async () => {
    const root = makeCheckout({ unit: true })
    const { spawnProcess, children } = makeSpawner()
    const service = new QaService({ root, spawnProcess })

    const pendingRun = service.run('unit')
    children[0]?.stderr.write('boom\n')
    children[0]?.emitExit(3, null)
    const state = await pendingRun

    const unit = state.suites.find((suite) => suite.id === 'unit')
    expect(unit?.status).toBe('failed')
    expect(unit?.lastExitCode).toBe(3)
  })

  it('stop kills the child and leaves the suite idle', async () => {
    const root = makeCheckout({ unit: true })
    const { spawnProcess, children } = makeSpawner()
    const service = new QaService({ root, spawnProcess })

    const pendingRun = service.run('unit')
    const stopped = await service.stop()

    expect(children[0]?.killCalls.length).toBeGreaterThan(0)
    const state = await pendingRun
    expect(stopped.activeRun).toBeNull()
    expect(state.activeRun).toBeNull()
    expect(state.suites.find((suite) => suite.id === 'unit')?.status).toBe('idle')
  })
})
