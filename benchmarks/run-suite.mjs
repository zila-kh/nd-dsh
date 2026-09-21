import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { CoreRpc, benchmarkRoot } from './lib/core-rpc.mjs'
import { directorySize, pidAlive, processMemory, sleep, summarize } from './lib/metrics.mjs'
import { defaultOutputDir, writeResult, writeSummary } from './lib/results.mjs'

const execFileAsync = promisify(execFile)
const smoke = process.argv.includes('--smoke')
const outputDir = defaultOutputDir()
const results = []
const failures = []
const temporary = []
const check = (condition, message) => { if (!condition) failures.push(message) }

async function tempDir(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporary.push(path)
  return path
}

async function benchmarkStartup() {
  const samples = []
  const healthRoundTripMs = []
  const readyMemory = []
  const runs = smoke ? 2 : 10
  for (let index = 0; index < runs; index += 1) {
    const client = await CoreRpc.launch()
    samples.push(client.startupMs)
    const healthStarted = performance.now()
    const readyHealth = await client.request('core.health')
    healthRoundTripMs.push(performance.now() - healthStarted)
    readyMemory.push(await processMemory(client.pid))
    check(client.health?.protocolVersion === 1 && readyHealth?.protocolVersion === 1, 'core startup handshake returned the wrong protocol')
    await client.close()
  }
  return writeResult(outputDir, 'core-startup', {
    measuredRuns: runs,
    samplesMs: samples,
    summaryMs: summarize(samples),
    healthRoundTripMs,
    healthRoundTripSummaryMs: summarize(healthRoundTripMs),
    readyMemory,
  })
}

async function benchmarkMemoryAndScheduler() {
  const workspace = await tempDir('nd-dsh-bench-shared-workspace-')
  await writeFile(join(workspace, 'seed.txt'), 'shared workspace fixture\n')
  const client = await CoreRpc.launch()
  try {
    const points = []
    const permitIds = []
    const corePid = client.pid
    for (const count of [1, 2, 4, 8, 10]) {
      while (permitIds.length < count) {
        const id = 'bench-' + permitIds.length
        const started = performance.now()
        const result = await client.request('scheduler.acquire', {
          permitId: id,
          sessionId: 'session-' + permitIds.length,
          kind: 'execution',
          pools: [{ key: 'bench:shared-workspace', limit: 32 }],
          ttlMs: 300_000,
        })
        check(result.granted === true, 'scheduler refused permit ' + id)
        permitIds.push(id)
        points.push({ kind: 'permit-latency', count: permitIds.length, ms: performance.now() - started })
      }
      await client.request('workspace.stat', { root: workspace, path: '.' })
      await sleep(30)
      const memory = await processMemory(client.pid)
      const scheduler = await client.request('scheduler.snapshot')
      const metrics = await client.request('metrics.snapshot')
      check(client.pid === corePid, 'logical session scaling launched another nd-core process')
      check(scheduler.permits.length === count, 'scheduler permit count mismatch at ' + count)
      check(metrics.workspaceCount === 1, 'shared workspace resource count scaled above one at ' + count)
      points.push({
        kind: 'memory',
        count,
        metric: memory.metric,
        bytes: memory.bytes,
        corePid,
        workspaceCount: metrics.workspaceCount,
        processCount: metrics.processCount,
        terminalCount: metrics.terminalCount,
        pendingRpcCount: metrics.pendingRpcCount,
        queuedEventCount: metrics.queuedEventCount,
        queuedEventBytes: metrics.queuedEventBytes,
      })
    }

    const first = await client.request('scheduler.acquire', {
      permitId: 'cap-a', kind: 'review', pools: [{ key: 'bench:cap', limit: 1 }],
    })
    check(first.granted === true, 'scheduler could not acquire first cap permit')
    const second = await client.request('scheduler.acquire', {
      permitId: 'cap-b', kind: 'review',
      pools: [{ key: 'bench:cap', limit: 1 }, { key: 'bench:other', limit: 10 }],
    })
    check(second.granted === false, 'scheduler exceeded a configured cap')
    const snapshot = await client.request('scheduler.snapshot')
    check(!snapshot.permits.some((item) => item.id === 'cap-b'), 'scheduler partially acquired a failed multi-pool permit')
    for (const id of [...permitIds, 'cap-a']) await client.request('scheduler.release', { permitId: id })
    return writeResult(outputDir, 'memory-scheduler-scaling', { corePid, points })
  } finally { await client.close() }
}

async function benchmarkTerminal() {
  const client = await CoreRpc.launch()
  const terminalCount = smoke ? 1 : 4
  const bytesTarget = smoke ? 64 * 1024 : 1024 * 1024
  const fixture = join(benchmarkRoot, 'benchmarks', 'fixtures', 'terminal-flood.mjs')
  const state = new Map()
  const ids = Array.from({ length: terminalCount }, (_, index) => 'bench-terminal-' + index)
  for (const id of ids) state.set(id, { bytes: 0, lastSeq: 0, reordered: 0 })

  const listener = (frame) => {
    const item = state.get(frame.resourceId)
    if (!item) return
    const seq = Number(frame.seq || 0)
    if (seq !== item.lastSeq + 1) item.reordered += 1
    item.lastSeq = seq
    item.bytes += frame.data.bytes?.byteLength ?? 0
  }
  client.on('terminal.output', listener)
  const started = performance.now()
  try {
    const exits = ids.map((id) => client.onceEvent('terminal.exit', (frame) => frame.resourceId === id, 30_000))
    const inputLatenciesMs = []
    for (const id of ids) {
      await client.request('terminal.create', {
        terminalId: id, sessionId: 'bench-session', shell: process.execPath,
        args: [fixture, String(bytesTarget)], cwd: benchmarkRoot, cols: 80, rows: 24, env: {},
      })
      const inputStarted = performance.now()
      await client.request('terminal.write', { terminalId: id, data: '' })
      inputLatenciesMs.push(performance.now() - inputStarted)
    }
    const resizeLatenciesMs = []
    for (const id of ids) {
      const resizeStarted = performance.now()
      await client.request('terminal.resize', { terminalId: id, cols: 100, rows: 30 })
      resizeLatenciesMs.push(performance.now() - resizeStarted)
    }
    await Promise.all(exits)
    const elapsedMs = performance.now() - started
    const terminals = ids.map((id) => ({ terminalId: id, ...state.get(id) }))
    for (const terminal of terminals) {
      check(terminal.bytes === bytesTarget, 'terminal byte integrity failed for ' + terminal.terminalId + ' expected=' + bytesTarget + ' actual=' + terminal.bytes)
      check(terminal.reordered === 0, 'terminal output sequence reordered for ' + terminal.terminalId)
    }
    const totalBytes = terminals.reduce((sum, item) => sum + item.bytes, 0)
    return writeResult(outputDir, 'terminal-throughput', {
      terminalCount,
      bytesTargetPerTerminal: bytesTarget,
      bytesTarget: bytesTarget * terminalCount,
      bytesObserved: totalBytes,
      reordered: terminals.reduce((sum, item) => sum + item.reordered, 0),
      terminals,
      inputLatenciesMs,
      inputLatencySummaryMs: summarize(inputLatenciesMs),
      resizeLatenciesMs,
      resizeLatencySummaryMs: summarize(resizeLatenciesMs),
      elapsedMs,
      bytesPerSecond: totalBytes / Math.max(0.001, elapsedMs / 1_000),
    })
  } finally {
    client.off('terminal.output', listener)
    await client.close()
  }
}

async function makeGitFixture(large = true) {
  const root = await tempDir(large ? 'nd-dsh-bench-git-' : 'nd-dsh-bench-parallel-')
  const fileCount = large ? (smoke ? 250 : 2_000) : 8
  await execFileAsync('git', ['init'], { cwd: root })
  await execFileAsync('git', ['config', 'user.email', 'bench@nd.local'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'ND Bench'], { cwd: root })
  for (let index = 0; index < fileCount; index += 1) {
    const dir = join(root, 'src', String(index % 32))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'file-' + index + '.txt'), 'seed ' + index + '\n')
  }
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-m', 'fixture'], { cwd: root })
  const dirty = large ? (smoke ? 25 : 300) : 0
  for (let index = 0; index < dirty; index += 1) {
    await writeFile(join(root, 'src', String(index % 32), 'file-' + index + '.txt'), 'changed ' + index + '\n')
  }
  return { root, files: fileCount, dirty }
}

async function benchmarkGit() {
  const fixture = await makeGitFixture(true)
  const client = await CoreRpc.launch()
  try {
    const operations = []

    const statusStarted = performance.now()
    const status = await client.request('git.status', { cwd: fixture.root, env: {}, gitPath: 'git' })
    const statusCallerMs = performance.now() - statusStarted
    check(status.exitCode === 0, 'git status failed: ' + status.stderr)
    check(status.truncated !== true, 'git status output truncated')
    check(Array.isArray(status.entries) && status.entries.length >= fixture.dirty, 'git status parser returned too few entries')
    operations.push({ name: 'status', callerMs: statusCallerMs, coreDurationMs: status.durationMs, parsedEntries: status.entries.length })

    const logStarted = performance.now()
    const log = await client.request('git.log', { cwd: fixture.root, limit: 50, env: {}, gitPath: 'git' })
    const logCallerMs = performance.now() - logStarted
    check(log.exitCode === 0, 'git log failed: ' + log.stderr)
    check(log.truncated !== true, 'git log output truncated')
    check(Array.isArray(log.commits) && log.commits.length > 0, 'git history parser returned no commits')
    operations.push({ name: 'log', callerMs: logCallerMs, coreDurationMs: log.durationMs, parsedEntries: log.commits.length })

    const diffStarted = performance.now()
    const diff = await client.request('git.exec', { cwd: fixture.root, args: ['diff', '--no-ext-diff'] })
    const diffCallerMs = performance.now() - diffStarted
    check(diff.exitCode === 0, 'git diff failed: ' + diff.stderr)
    check(diff.truncated !== true, 'git diff output truncated')
    operations.push({ name: 'diff', callerMs: diffCallerMs, coreDurationMs: diff.durationMs, stdoutBytes: Buffer.byteLength(diff.stdout || '') })

    return writeResult(outputDir, 'git-workload', { fixture: { files: fixture.files, dirty: fixture.dirty }, operations })
  } finally { await client.close() }
}

async function benchmarkParallelAgents() {
  const fixture = await makeGitFixture(false)
  const parent = await tempDir('nd-dsh-bench-worktrees-')
  const client = await CoreRpc.launch()
  const synthetic = join(benchmarkRoot, 'benchmarks', 'fixtures', 'synthetic-worker.mjs')
  const targetCounts = smoke ? [1, 2] : [1, 2, 4, 8, 10]
  const workers = []
  const output = new Map()
  const descendantPids = new Map()
  const listener = (frame) => {
    if (frame.data?.stream !== 'stdout') return
    const processId = frame.resourceId
    if (!processId) return
    const next = (output.get(processId) || '') + Buffer.from(frame.data.bytes || []).toString('utf8')
    output.set(processId, next)
    const line = next.split(/\r?\n/).find(Boolean)
    if (!line || descendantPids.has(processId)) return
    try {
      const parsed = JSON.parse(line)
      if (Number.isInteger(parsed.childPid)) descendantPids.set(processId, parsed.childPid)
    } catch {}
  }
  client.on('process.output', listener)

  try {
    const points = []
    for (const count of targetCounts) {
      while (workers.length < count) {
        const index = workers.length
        const worktree = join(parent, 'worker-' + index)
        const git = await client.request('git.exec', {
          cwd: fixture.root,
          args: ['worktree', 'add', '-b', 'bench-worker-' + index, worktree, 'HEAD'],
        })
        check(git.exitCode === 0, 'parallel worktree create failed for worker ' + index + ': ' + git.stderr)

        const permitId = 'parallel-permit-' + index
        const permitStarted = performance.now()
        const permit = await client.request('scheduler.acquire', {
          permitId,
          sessionId: 'parallel-session-' + index,
          kind: 'execution',
          pools: [
            { key: 'bench:parallel:project', limit: 10 },
            { key: 'bench:parallel:role', limit: 10 },
          ],
          ttlMs: 300_000,
        })
        const permitLatencyMs = performance.now() - permitStarted
        check(permit.granted === true, 'parallel scheduler refused worker ' + index)

        const processId = 'parallel-worker-' + index
        const spawned = await client.request('process.spawn', {
          id: processId,
          permitId,
          command: process.execPath,
          args: [synthetic],
          cwd: worktree,
          env: {},
          inheritEnv: true,
        })
        workers.push({ index, worktree, permitId, permitLatencyMs, processId, pid: spawned.pid })
      }

      for (let spin = 0; spin < 50 && workers.slice(0, count).some((worker) => !descendantPids.has(worker.processId)); spin += 1) await sleep(20)
      const scheduler = await client.request('scheduler.snapshot')
      const processes = await client.request('process.snapshot')
      const metrics = await client.request('metrics.snapshot')
      const coreMemory = await processMemory(client.pid)
      const managedMemory = await Promise.all(workers.slice(0, count).map(async (worker) => ({ pid: worker.pid, ...(await processMemory(worker.pid)) })))
      const externalMemory = await Promise.all(workers.slice(0, count).map(async (worker) => {
        const pid = descendantPids.get(worker.processId)
        return { pid: pid ?? null, ...(pid ? await processMemory(pid) : { metric: 'unavailable', bytes: null }) }
      }))
      const worktreeDiskBytes = (await Promise.all(workers.slice(0, count).map((worker) => directorySize(worker.worktree)))).reduce((sum, value) => sum + value, 0)

      check(scheduler.permits.filter((item) => item.id.startsWith('parallel-permit-')).length === count, 'parallel permit count mismatch at ' + count)
      check(processes.filter((item) => item.processId.startsWith('parallel-worker-')).length === count, 'parallel process count mismatch at ' + count)
      points.push({
        count,
        corePid: client.pid,
        coreMemory,
        managedMemory,
        externalMemory,
        permitLatencySummaryMs: summarize(workers.slice(0, count).map((worker) => worker.permitLatencyMs)),
        processCount: metrics.processCount,
        workspaceCount: metrics.workspaceCount,
        pendingRpcCount: metrics.pendingRpcCount,
        queuedEventCount: metrics.queuedEventCount,
        worktreeDiskBytes,
      })
    }
    return writeResult(outputDir, 'scheduler-multi-agent', { points })
  } finally {
    for (const worker of workers) {
      const exit = client.onceEvent('process.exit', (frame) => frame.resourceId === worker.processId, 5_000).catch(() => undefined)
      await client.request('process.cancel', { processId: worker.processId }).catch(() => undefined)
      await exit
      await client.request('scheduler.release', { permitId: worker.permitId }).catch(() => undefined)
    }
    client.off('process.output', listener)
    await client.close()
  }
}

async function benchmarkCancellation() {
  const client = await CoreRpc.launch()
  const fixture = join(benchmarkRoot, 'benchmarks', 'fixtures', 'synthetic-worker.mjs')
  const ids = ['bench-worker-a', 'bench-worker-b']
  const permits = ['bench-cancel-a', 'bench-cancel-b']
  const text = new Map()
  const childPids = new Map()
  const listener = (frame) => {
    if (!ids.includes(frame.resourceId) || frame.data.stream !== 'stdout') return
    const next = (text.get(frame.resourceId) || '') + Buffer.from(frame.data.bytes).toString('utf8')
    text.set(frame.resourceId, next)
    const line = next.split(/\r?\n/).find(Boolean)
    if (!line || childPids.has(frame.resourceId)) return
    try {
      const parsed = JSON.parse(line)
      if (Number.isInteger(parsed.childPid)) childPids.set(frame.resourceId, parsed.childPid)
    } catch {}
  }
  client.on('process.output', listener)

  try {
    for (let index = 0; index < ids.length; index += 1) {
      const acquired = await client.request('scheduler.acquire', {
        permitId: permits[index],
        kind: 'execution',
        pools: [{ key: 'bench:cancel:project', limit: 2 }],
        ttlMs: 300_000,
      })
      check(acquired.granted === true, 'cancellation benchmark could not acquire permit ' + permits[index])
      await client.request('process.spawn', {
        id: ids[index], permitId: permits[index], command: process.execPath,
        args: [fixture], cwd: benchmarkRoot, env: {}, inheritEnv: true,
      })
    }
    for (let index = 0; index < 100 && ids.some((id) => !childPids.has(id)); index += 1) await sleep(20)
    check(ids.every((id) => Number.isInteger(childPids.get(id))), 'synthetic workers did not report both child pids')

    const exitA = client.onceEvent('process.exit', (frame) => frame.resourceId === ids[0], 15_000)
    const started = performance.now()
    await client.request('process.cancel', { processId: ids[0] })
    await exitA
    const cancelToExitMs = performance.now() - started
    await client.request('scheduler.release', { permitId: permits[0] })
    await sleep(100)

    const canceledDescendantAlive = childPids.get(ids[0]) ? await pidAlive(childPids.get(ids[0])) : null
    const survivorDescendantAlive = childPids.get(ids[1]) ? await pidAlive(childPids.get(ids[1])) : null
    const processSnapshot = await client.request('process.snapshot')
    const schedulerSnapshot = await client.request('scheduler.snapshot')
    check(canceledDescendantAlive === false, 'cancellation left an orphan descendant for the canceled worker')
    check(survivorDescendantAlive === true, 'canceling one worker terminated an unrelated worker descendant')
    check(processSnapshot.some((item) => item.processId === ids[1]), 'canceling one worker removed an unrelated managed worker')
    check(!schedulerSnapshot.permits.some((item) => item.id === permits[0]), 'canceled worker permit remained after explicit release')
    check(schedulerSnapshot.permits.some((item) => item.id === permits[1]), 'unrelated worker permit was released')

    const replacement = await client.request('scheduler.acquire', {
      permitId: 'bench-cancel-replacement',
      kind: 'execution',
      pools: [{ key: 'bench:cancel:project', limit: 2 }],
      ttlMs: 300_000,
    })
    check(replacement.granted === true, 'cancel/release did not make runtime capacity available again')
    await client.request('scheduler.release', { permitId: 'bench-cancel-replacement' })

    const exitB = client.onceEvent('process.exit', (frame) => frame.resourceId === ids[1], 15_000)
    await client.request('process.cancel', { processId: ids[1] })
    await exitB
    await client.request('scheduler.release', { permitId: permits[1] })
    await sleep(100)
    const survivorCleaned = childPids.get(ids[1]) ? !(await pidAlive(childPids.get(ids[1]))) : null
    check(survivorCleaned === true, 'benchmark cleanup left the unrelated worker descendant alive')

    return writeResult(outputDir, 'cancellation-latency', {
      cancelToExitMs,
      canceled: { processId: ids[0], childPid: childPids.get(ids[0]) ?? null, orphanAlive: canceledDescendantAlive },
      survivor: { processId: ids[1], childPid: childPids.get(ids[1]) ?? null, aliveAfterPeerCancel: survivorDescendantAlive, cleaned: survivorCleaned },
      capacityReacquired: replacement.granted === true,
    })
  } finally {
    for (let index = 0; index < ids.length; index += 1) {
      await client.request('process.cancel', { processId: ids[index] }).catch(() => undefined)
      await client.request('scheduler.release', { permitId: permits[index] }).catch(() => undefined)
    }
    client.off('process.output', listener)
    await client.close()
  }
}

try {
  for (const run of [
    benchmarkStartup,
    benchmarkMemoryAndScheduler,
    benchmarkTerminal,
    benchmarkGit,
    benchmarkParallelAgents,
    benchmarkCancellation,
  ]) {
    results.push(await run())
  }
  const summary = await writeSummary(outputDir, results, failures)
  console.log(JSON.stringify({ outputDir, status: summary.status, failures }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  await Promise.allSettled(temporary.map((path) => rm(path, { recursive: true, force: true })))
}
