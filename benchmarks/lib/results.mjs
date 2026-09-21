import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { environmentMetadata } from './metrics.mjs'
import { benchmarkRoot } from './core-rpc.mjs'

export function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return resolve(process.env.ND_DSH_BENCH_OUTPUT || join(benchmarkRoot, 'benchmark-results', stamp + '-' + process.platform + '-' + process.arch))
}

export async function writeResult(outputDir, name, data) {
  await fs.mkdir(outputDir, { recursive: true })
  const value = {
    schemaVersion: 1,
    benchmark: name,
    timestamp: new Date().toISOString(),
    backend: process.env.ND_DSH_BENCH_BACKEND || 'rust-core',
    environment: environmentMetadata(),
    ...data,
  }
  await fs.writeFile(join(outputDir, name + '.json'), JSON.stringify(value, null, 2) + '\n', 'utf8')
  return value
}

export async function writeSummary(outputDir, results, failures = []) {
  const value = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    backend: process.env.ND_DSH_BENCH_BACKEND || 'rust-core',
    environment: environmentMetadata(),
    status: failures.length ? 'fail' : 'pass',
    failures,
    benchmarks: Object.fromEntries(results.map((item) => [item.benchmark, item])),
  }
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(join(outputDir, 'summary.json'), JSON.stringify(value, null, 2) + '\n', 'utf8')
  return value
}
