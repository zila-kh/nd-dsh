import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { CoreRpc, benchmarkRoot } from './lib/core-rpc.mjs'
import { pidAlive, processMemory, sleep, summarize } from './lib/metrics.mjs'
import { defaultOutputDir, writeResult, writeSummary } from './lib/results.mjs'

const execFileAsync = promisify(execFile)
const smoke = process.argv.includes('--smoke')
const outputDir = defaultOutputDir()
const results = []
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

async function benchmarkStartup() {
  const samples = []
  const runs = smoke ? 2 : 10
  for (let index = 0; index < runs; index += 1) {
    const client = await CoreRpc.launch()
    samples.push(client.startupMs)
    check(client.health?.protocolVersion === 1, 'core startup handshake returned the wrong protocol')
    await client.close()
  }
  return writeResult(outputDir, 'core-startup', { measuredRuns: runs, samplesMs: samples, summaryMs: summarize(samples) })
}

async function benchmarkMemoryAndScheduler() {
  const client = await CoreRpc.launch()
  try {
    const points = []
    const permitIds = []
    for (const count of [1, 2, 4, 8, 10]) {
      while (permitIds.length < count) {
        const id = 'bench-' + permitIds.length
        const started = performance.now()
        const result = await client.request('scheduler.acquire', {
          permitId: id, kind: 'execution',
          pools: [{ key: 'bench:shared-workspace', limit: 32 }],
          ttlMs: 300_000,
        })
        check(result.granted === true, 'scheduler refused permit ' + id)
        permitIds.push(id)
        points.push({ kind: 'permit-latency', count: permitIds.length, ms: performance.now() - started })
      }
      await sleep(30)
      const memory = await processMemory(client.pid)
      const snapshot = await client.request('scheduler.snapshot')
      check(snapshot.permits.length === count, 'scheduler permit count mismatch at ' + count)
      points.push({ kind: 'memory', count, metric: memory.metric, bytes: memory.bytes })
    }
    const first = await client.request('scheduler.acquire', { permitId: 'cap-a', kind: 'review', pools: [{ key: 'bench:cap', limit: 1 }] })
    check(first.granted === true, 'scheduler could not acquire first cap permit')
    const second = await client.request('scheduler.acquire', { permitId: 'cap-b', kind: 'review', pools: [{ key: 'bench:cap', limit: 1 }, { key: 'bench:other', limit: 10 }] })
    check(second.granted === false, 'scheduler exceeded a configured cap')
    const snapshot = await client.request('scheduler.snapshot')
    check(!snapshot.permits.some((item) => item.id === 'cap-b'), 'scheduler partially acquired a failed multi-pool permit')
    for (const id of [...permitIds, 'cap-a']) await client.request('scheduler.release', { permitId: id })
    return writeResult(outputDir, 'memory-scheduler-scaling', { points })
  } finally { await client.close() }
}

async function benchmarkTerminal() {
  const client = await CoreRpc.launch()
  const bytesTarget = smoke ? 64 * 1024 : 4 * 1024 * 1024
  const fixture = join(benchmarkRoot, 'benchmarks', 'fixtures', 'terminal-flood.mjs')
  const terminalId = 'bench-terminal'
  let bytes = 0, lastSeq = 0, reordered = 0
  const listener = (frame) => {
    if (frame.resourceId !== terminalId) return
    const seq = Number(frame.seq || 0)
    if (seq !== lastSeq + 1) reordered += 1
    lastSeq = seq
    bytes += frame.data.bytes?.byteLength ?? 0
  }
  client.on('terminal.output', listener)
  const started = performance.now()
  try {
    const exitPromise = client.onceEvent('terminal.exit', (frame) => frame.resourceId === terminalId, 20_000)
    await client.request('terminal.create', {
      terminalId, sessionId: 'bench-session', shell: process.execPath,
      args: [fixture, String(bytesTarget)], cwd: benchmarkRoot, cols: 80, rows: 24, env: {},
    })
    await exitPromise
    const elapsedMs = performance.now() - started
    check(bytes === bytesTarget, 'terminal byte integrity failed expected=' + bytesTarget + ' actual=' + bytes)
    check(reordered === 0, 'terminal output sequence reordered')
    return writeResult(outputDir, 'terminal-throughput', { bytesTarget, bytesObserved: bytes, reordered, elapsedMs, bytesPerSecond: bytes / Math.max(0.001, elapsedMs / 1_000) })
  } finally {
    client.off('terminal.output', listener)
    await client.close()
  }
}

async function makeGitFixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-dsh-bench-git-'))
  const fileCount = smoke ? 250 : 2_000
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
  const dirty = smoke ? 25 : 300
  for (let index = 0; index < dirty; index += 1) {
    await writeFile(join(root, 'src', String(index % 32), 'file-' + index + '.txt'), 'changed ' + index + '\n')
  }
  return { root, files: fileCount, dirty }
}

async function benchmarkGit() {
  const fixture = await makeGitFixture()
  const client = await CoreRpc.launch()
  try {
    const operations = []
    for (const [name, args] of [['status', ['status', '--porcelain=v1', '--untracked-files=all']], ['log', ['log', '--oneline', '-50']], ['diff', ['diff', '--no-ext-diff']]]) {
      const started = performance.now()
      const result = await client.request('git.exec', { cwd: fixture.root, args })
      const callerMs = performance.now() - started
      check(result.exitCode === 0, 'git ' + name + ' failed: ' + result.stderr)
      check(result.truncated !== true, 'git ' + name + ' output truncated')
      operations.push({ name, callerMs, coreDurationMs: result.durationMs, stdoutBytes: Buffer.byteLength(result.stdout || '') })
    }
    return writeResult(outputDir, 'git-workload', { fixture: { files: fixture.files, dirty: fixture.dirty }, operations })
  } finally { await client.close() }
}

async function benchmarkCancellation() {
  const client = await CoreRpc.launch()
  const fixture = join(benchmarkRoot, 'benchmarks', 'fixtures', 'synthetic-worker.mjs')
  const processId = 'bench-worker'
  let text = '', childPid
  const listener = (frame) => {
    if (frame.resourceId !== processId || frame.data.stream !== 'stdout') return
    text += Buffer.from(frame.data.bytes).toString('utf8')
    const line = text.split(/\r?\n/).find(Boolean)
    if (!line || childPid) return
    try { childPid = JSON.parse(line).childPid } catch {}
  }
  client.on('process.output', listener)
  try {
    const exitPromise = client.onceEvent('process.exit', (frame) => frame.resourceId === processId, 15_000)
    await client.request('process.spawn', { id: processId, command: process.execPath, args: [fixture], cwd: benchmarkRoot, env: {}, inheritEnv: true })
    for (let index = 0; index < 50 && !childPid; index += 1) await sleep(20)
    check(Number.isInteger(childPid), 'synthetic worker did not report child pid')
    const started = performance.now()
    await client.request('process.cancel', { processId })
    await exitPromise
    const cancelToExitMs = performance.now() - started
    await sleep(100)
    const orphanAlive = childPid ? await pidAlive(childPid) : null
    if (childPid) check(!orphanAlive, 'cancellation left an orphan child process ' + childPid)
    return writeResult(outputDir, 'cancellation-latency', { cancelToExitMs, childPid, orphanAlive })
  } finally {
    client.off('process.output', listener)
    await client.close()
  }
}

for (const run of [benchmarkStartup, benchmarkMemoryAndScheduler, benchmarkTerminal, benchmarkGit, benchmarkCancellation]) {
  results.push(await run())
}
const summary = await writeSummary(outputDir, results, failures)
console.log(JSON.stringify({ outputDir, status: summary.status, failures }, null, 2))
if (failures.length) process.exitCode = 1
