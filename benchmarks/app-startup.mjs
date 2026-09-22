import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { summarize } from './lib/metrics.mjs'
import { defaultOutputDir, writeResult } from './lib/results.mjs'

const executable = process.env.ND_DSH_BENCH_PACKAGED_APP?.trim()
if (!executable) {
  console.error('ND_DSH_BENCH_PACKAGED_APP is required for packaged startup evidence.')
  process.exit(2)
}
const runs = Math.max(2, Number(process.env.ND_DSH_BENCH_RUNS || 10))
const backend = 'rust-core'
const samples = []
const records = []

for (let index = 0; index < runs; index += 1) {
  const workspace = await mkdtemp(join(tmpdir(), 'nd-dsh-app-bench-workspace-'))
  const userData = await mkdtemp(join(tmpdir(), 'nd-dsh-app-bench-user-data-'))
  const output = join(workspace, 'startup.json')
  try {
    const child = spawn(resolve(executable), [], {
      windowsHide: true,
      stdio: 'ignore',
      env: {
        ...safeEnvironment(),
        ND_DSH_BENCHMARK_OUTPUT: output,
        ND_DSH_BENCHMARK_EXIT: '1',
        ND_DSH_WORKSPACE: workspace,
        ND_DSH_USER_DATA_DIR: userData,
        ND_DSH_BROWSER_URL: 'about:blank',
      },
    })
    const status = await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        try { child.kill() } catch {}
        reject(new Error('packaged startup benchmark timed out'))
      }, 30_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code) })
    })
    if (status !== 0) throw new Error('packaged ND exited with code ' + status)
    const record = JSON.parse(await readFile(output, 'utf8'))
    if (!Number.isFinite(record.marks?.usable)) throw new Error('packaged startup benchmark did not record usable mark')
    if (record.core?.protocolVersion !== 1) throw new Error('packaged startup did not report bundled ND Core readiness')
    samples.push(record.marks.usable)
    records.push(record)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
}

process.env.ND_DSH_BENCH_BACKEND = backend
const outputDir = resolve(process.env.ND_DSH_BENCH_OUTPUT || defaultOutputDir())
const result = await writeResult(outputDir, 'app-startup', {
  measuredRuns: runs,
  samplesMs: samples,
  summaryMs: summarize(samples),
  mainRssBytes: summarize(records.map((record) => record.mainRssBytes)),
  coreMemoryBytes: summarize(records.map((record) => record.coreMetrics?.processMemory?.bytes)),
  eventLoopP95Ms: summarize(records.map((record) => record.eventLoop?.p95Ms)),
  records,
})
console.log(JSON.stringify({ status: 'pass', outputDir, benchmark: result.benchmark, backend: result.backend, summaryMs: result.summaryMs }, null, 2))

function safeEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)) continue
    env[key] = value
  }
  return env
}
