import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { environmentMetadata } from './metrics.mjs'
import { benchmarkRoot } from './core-rpc.mjs'

const execFileAsync = promisify(execFile)
let commitPromise

export function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return resolve(process.env.ND_DSH_BENCH_OUTPUT || join(benchmarkRoot, 'benchmark-results', stamp + '-' + process.platform + '-' + process.arch))
}

export async function resultProvenance() {
  return {
    commit: process.env.GITHUB_SHA?.trim() || await repositoryCommit(),
    buildProfile: process.env.ND_DSH_BENCH_PROFILE?.trim() || 'release',
    fixtureRevision: process.env.ND_DSH_BENCH_FIXTURE_REVISION?.trim() || 'prd-0002-v1',
  }
}

export async function writeResult(outputDir, name, data) {
  await fs.mkdir(outputDir, { recursive: true })
  const value = {
    ...data,
    schemaVersion: 1,
    benchmark: name,
    timestamp: new Date().toISOString(),
    backend: process.env.ND_DSH_BENCH_BACKEND || 'rust-core',
    environment: environmentMetadata(),
    ...await resultProvenance(),
  }
  assertResultEnvelope(value)
  await fs.writeFile(join(outputDir, name + '.json'), JSON.stringify(value, null, 2) + '\n', 'utf8')
  return value
}

export async function writeSummary(outputDir, results, failures = []) {
  const value = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    backend: process.env.ND_DSH_BENCH_BACKEND || 'rust-core',
    environment: environmentMetadata(),
    ...await resultProvenance(),
    status: failures.length ? 'fail' : 'pass',
    failures,
    benchmarks: Object.fromEntries(results.map((item) => [item.benchmark, item])),
  }
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(join(outputDir, 'summary.json'), JSON.stringify(value, null, 2) + '\n', 'utf8')
  return value
}

export function assertResultEnvelope(value) {
  const requiredStrings = ['benchmark', 'timestamp', 'backend', 'commit', 'buildProfile', 'fixtureRevision']
  if (value?.schemaVersion !== 1) throw new Error('Benchmark result schemaVersion must be 1.')
  for (const key of requiredStrings) {
    if (typeof value?.[key] !== 'string' || !value[key].trim()) throw new Error('Benchmark result is missing required field: ' + key)
  }
  if (!value.environment || typeof value.environment !== 'object') throw new Error('Benchmark result is missing environment metadata.')
  for (const key of ['os', 'osVersion', 'arch', 'cpuModel', 'logicalCpuCount', 'physicalMemoryBytes', 'nodeVersion']) {
    if (value.environment[key] === undefined || value.environment[key] === null) throw new Error('Benchmark environment is missing: ' + key)
  }
}

async function repositoryCommit() {
  commitPromise ??= execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: benchmarkRoot, windowsHide: true })
    .then(({ stdout }) => stdout.trim().toLowerCase())
    .catch(() => 'unknown')
  return await commitPromise
}
