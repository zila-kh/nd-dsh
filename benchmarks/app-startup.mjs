import { spawn } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { summarize } from './lib/metrics.mjs'

const executable = process.env.ND_DSH_BENCH_PACKAGED_APP?.trim()
if (!executable) {
  console.log('ND_DSH_BENCH_PACKAGED_APP is not set; packaged startup benchmark skipped.')
  process.exit(0)
}
const runs = Math.max(2, Number(process.env.ND_DSH_BENCH_RUNS || 10))
const backend = process.env.ND_DSH_BENCH_BACKEND || 'rust'
const samples = []
for (let index = 0; index < runs; index += 1) {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-app-bench-'))
  const output = join(dir, 'startup.json')
  const child = spawn(resolve(executable), [], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ND_DSH_CORE_BACKEND: backend === 'legacy' ? 'legacy' : 'rust', ND_DSH_BENCHMARK_OUTPUT: output, ND_DSH_BENCHMARK_EXIT: '1', ND_DSH_WORKSPACE: dir },
  })
  const status = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('packaged startup benchmark timed out')) }, 30_000)
    child.once('error', reject)
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code) })
  })
  if (status !== 0) throw new Error('packaged ND exited with code ' + status)
  const record = JSON.parse(await readFile(output, 'utf8'))
  if (!Number.isFinite(record.marks?.usable)) throw new Error('packaged startup benchmark did not record usable mark')
  samples.push(record.marks.usable)
}
console.log(JSON.stringify({ benchmark: 'app-startup', backend, runs, samplesMs: samples, summaryMs: summarize(samples) }, null, 2))
