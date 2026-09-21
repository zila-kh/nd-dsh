import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import process from 'node:process'
import type { CoreClient } from '../core/core-client.js'
import { engineEnvironment, killProcessTree } from '../engines/agent-cli/agent-cli-support.js'
import type { GitService } from '../git/git-service.js'
import type { ExecutionCoordinator, RuntimePermit } from '../organization/execution-coordinator.js'
import type { TerminalManager } from '../terminal/terminal-manager.js'
import { projectRoot } from '../app-paths.js'

type SpawnLike = typeof import('node:child_process').spawn

interface RuntimeBenchmarkOptions {
  outputPath: string
  workspaceRoot: string
  core?: CoreClient
  terminal: TerminalManager
  git: GitService
  coordinator: ExecutionCoordinator
  spawnProcess: SpawnLike
}

export async function runRuntimeBenchmark(options: RuntimeBenchmarkOptions): Promise<void> {
  const backend = options.core ? 'rust-core' : 'legacy'
  const histogram = monitorEventLoopDelay({ resolution: 5 })
  const workers: import('node:child_process').ChildProcess[] = []
  const sessionPermits: RuntimePermit[] = []
  let terminalId: string | undefined
  const sessionId = 'runtime-benchmark'
  let canceledChildPid: number | undefined
  let survivorChildPid: number | undefined
  const terminalDeliveryMs: number[] = []
  const disposeTerminalLatency = options.core?.onEvent<{ emittedAt?: number }>('terminal.output', (frame) => {
    const emittedAt = frame.data?.emittedAt
    if (typeof emittedAt !== 'number' || !Number.isFinite(emittedAt)) return
    terminalDeliveryMs.push(Math.max(0, Date.now() - emittedAt))
  })

  try {
    const idleCore = options.core ? await options.core.request<Record<string, unknown>>('metrics.snapshot', {}, 5_000) : undefined
    const idleMainRssBytes = process.memoryUsage().rss
    const idleBackendMemoryBytes = backendMemory(idleMainRssBytes, idleCore)
    const sessionScaling = []
    for (const count of [1, 2, 4, 8, 10]) {
      while (sessionPermits.length < count) {
        const index = sessionPermits.length
        const permit = await options.coordinator.acquire({
          kind: 'execution',
          pools: [{ key: 'benchmark:logical-sessions', limit: 16 }],
        })
        await options.coordinator.bindSession(permit, 'benchmark-session-' + index, 'benchmark-run-' + index)
        sessionPermits.push(permit)
      }
      if (count === 1) await options.git.refresh()
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
      const coreMetrics = options.core ? await options.core.request<Record<string, unknown>>('metrics.snapshot', {}, 5_000) : undefined
      const mainRssBytes = process.memoryUsage().rss
      sessionScaling.push({
        count,
        mainRssBytes,
        coreMemory: coreProcessMemory(coreMetrics),
        backendMemoryBytes: backendMemory(mainRssBytes, coreMetrics),
        coreWorkspaceCount: numberField(coreMetrics, 'workspaceCount'),
      })
    }
    for (const permit of sessionPermits.splice(0)) await options.coordinator.release(permit)

    const stressStarted = performance.now()
    const cpuStarted = process.cpuUsage()
    histogram.enable()
    const workerFixture = join(projectRoot(), 'benchmarks', 'fixtures', 'synthetic-worker.mjs')
    const workerEnv = { ...engineEnvironment(), ELECTRON_RUN_AS_NODE: '1' }
    const first = options.spawnProcess(process.execPath, [workerFixture], {
      cwd: options.workspaceRoot,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    const second = options.spawnProcess(process.execPath, [workerFixture], {
      cwd: options.workspaceRoot,
      env: workerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    workers.push(first, second)
    ;[canceledChildPid, survivorChildPid] = await Promise.all([
      childPidFromWorker(first),
      childPidFromWorker(second),
    ])

    const terminalState = await options.terminal.create({
      sessionId,
      cwd: options.workspaceRoot,
      title: 'Runtime benchmark',
      cols: 100,
      rows: 30,
    })
    const terminal = terminalState.terminals.find((item) => item.id === terminalState.activeTerminalId) ?? terminalState.terminals.at(-1)
    if (!terminal) throw new Error('Runtime benchmark could not create a terminal.')
    terminalId = terminal.id

    const terminalFixture = join(projectRoot(), 'benchmarks', 'fixtures', 'runtime-terminal-flood.mjs')
    const terminalStarted = performance.now()
    await options.terminal.write(sessionId, terminal.id, terminalCommand(terminal.shell, terminalFixture, 2 * 1024 * 1024))
    const terminalDone = waitForTerminalMarker(options.terminal, sessionId, terminal.id, 'ND_RUNTIME_STRESS_DONE', 20_000)

    const gitSamplesMs: number[] = []
    const gitWork = (async () => {
      for (let index = 0; index < 8; index += 1) {
        const gitStarted = performance.now()
        const snapshot = await options.git.refresh()
        gitSamplesMs.push(performance.now() - gitStarted)
        if (!snapshot.repoRoot) throw new Error('Runtime benchmark Git fixture stopped being a repository.')
      }
    })()

    // Exercise the normal product input path while terminal output and Git
    // refresh are still in flight. Core-level acknowledgement latency is
    // measured separately by benchmarks/run-suite.mjs.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15))
    await options.terminal.write(sessionId, terminal.id, '\n')

    // Cancellation is intentionally issued before the terminal/Git stress
    // settles so foreground process control is measured under contention.
    const cancelStarted = performance.now()
    await killProcessTree(first)
    const cancelToExitMs = performance.now() - cancelStarted

    await Promise.all([terminalDone, gitWork])
    const terminalToMarkerMs = performance.now() - terminalStarted
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    const canceledOrphanAlive = canceledChildPid === undefined ? null : pidAlive(canceledChildPid)
    const survivorAliveAfterPeerCancel = second.exitCode === null && (survivorChildPid === undefined || pidAlive(survivorChildPid))
    if (canceledOrphanAlive === true) throw new Error('Runtime benchmark cancellation left a descendant alive.')
    if (!survivorAliveAfterPeerCancel) throw new Error('Runtime benchmark cancellation killed the unrelated worker.')

    const coreMetrics = options.core ? await options.core.request<Record<string, unknown>>('metrics.snapshot', {}, 5_000) : undefined
    const cpu = process.cpuUsage(cpuStarted)
    histogram.disable()
    const payload = {
      schemaVersion: 1,
      benchmark: 'electron-responsiveness',
      timestamp: new Date().toISOString(),
      backend,
      platform: process.platform,
      arch: process.arch,
      durationMs: performance.now() - stressStarted,
      mainCpuMs: (cpu.user + cpu.system) / 1_000,
      mainRssBytes: process.memoryUsage().rss,
      idleMainRssBytes,
      idleCoreMemory: coreProcessMemory(idleCore),
      idleBackendMemoryBytes,
      sessionScaling,
      eventLoop: {
        p50Ms: histogram.percentile(50) / 1e6,
        p95Ms: histogram.percentile(95) / 1e6,
        p99Ms: histogram.percentile(99) / 1e6,
        maxMs: histogram.max / 1e6,
      },
      terminal: {
        bytesRequested: 2 * 1024 * 1024,
        toMarkerMs: terminalToMarkerMs,
        eventDeliverySamplesMs: terminalDeliveryMs,
        eventDeliveryP50Ms: percentile(terminalDeliveryMs, 0.5),
        eventDeliveryP95Ms: percentile(terminalDeliveryMs, 0.95),
        eventDeliveryP99Ms: percentile(terminalDeliveryMs, 0.99),
      },
      git: {
        samplesMs: gitSamplesMs,
        ...summarize(gitSamplesMs),
      },
      cancellation: {
        cancelToExitMs,
        canceledChildPid: canceledChildPid ?? null,
        orphanAlive: canceledOrphanAlive,
        survivorChildPid: survivorChildPid ?? null,
        survivorAliveAfterPeerCancel,
      },
      core: coreMetrics,
    }
    await writeJson(options.outputPath, payload)
  } finally {
    histogram.disable()
    disposeTerminalLatency?.()
    for (const permit of sessionPermits.splice(0)) await options.coordinator.release(permit).catch(() => undefined)
    if (terminalId) await options.terminal.close(sessionId, terminalId).catch(() => undefined)
    await Promise.allSettled(workers.map(async (child) => { await killProcessTree(child) }))
  }
}

async function childPidFromWorker(child: import('node:child_process').ChildProcess): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('Synthetic runtime worker did not report its descendant pid.')), 5_000)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      const line = buffer.split(/\r?\n/).find(Boolean)
      if (!line) return
      try {
        const parsed = JSON.parse(line) as { childPid?: unknown }
        if (!Number.isInteger(parsed.childPid)) return
        clearTimeout(timer)
        resolvePromise(parsed.childPid as number)
      } catch {
        // Wait for a complete JSON line.
      }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => {
      if (buffer.trim()) return
      clearTimeout(timer)
      reject(new Error('Synthetic runtime worker exited before reporting a descendant pid: ' + String(code)))
    })
  })
}

async function waitForTerminalMarker(
  terminal: TerminalManager,
  sessionId: string,
  terminalId: string,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await terminal.state(sessionId)
    const snapshot = state.terminals.find((item) => item.id === terminalId)
    if (!snapshot) throw new Error('Runtime benchmark terminal disappeared.')
    if (snapshot.buffer.includes(marker)) return
    if (snapshot.status === 'error') throw new Error(snapshot.error ?? 'Runtime benchmark terminal failed.')
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error('Runtime benchmark terminal did not finish within the timeout.')
}

function terminalCommand(shell: string, fixture: string, bytes: number): string {
  if (process.platform !== 'win32') {
    return `ELECTRON_RUN_AS_NODE=1 ${shQuote(process.execPath)} ${shQuote(fixture)} ${bytes}; exit\n`
  }
  if (/powershell|pwsh/i.test(shell)) {
    return `$env:ELECTRON_RUN_AS_NODE='1'; & ${psQuote(process.execPath)} ${psQuote(fixture)} ${bytes}; exit\r\n`
  }
  return `set "ELECTRON_RUN_AS_NODE=1" && "${process.execPath}" "${fixture}" ${bytes} && exit\r\n`
}

function shQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function psQuote(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'"
}


function coreProcessMemory(metrics: Record<string, unknown> | undefined): { metric: string; bytes: number | null } | null {
  const value = metrics?.processMemory
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return {
    metric: typeof record.metric === 'string' ? record.metric : 'unavailable',
    bytes: typeof record.bytes === 'number' && Number.isFinite(record.bytes) ? record.bytes : null,
  }
}

function backendMemory(mainRssBytes: number, metrics: Record<string, unknown> | undefined): number {
  return mainRssBytes + (coreProcessMemory(metrics)?.bytes ?? 0)
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function summarize(samples: number[]): { p50Ms: number; p95Ms: number; meanMs: number } {
  return {
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
  }
}

function percentile(samples: number[], fraction: number): number {
  const values = samples.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!values.length) return 0
  return values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1))] ?? 0
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = path + '.tmp-' + process.pid
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await fs.rename(temp, path)
}
