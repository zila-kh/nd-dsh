import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { environmentMetadata } from './metrics.mjs'
import { benchmarkRoot, defaultCoreBinary } from './core-rpc.mjs'

const execFileAsync = promisify(execFile)
let commitPromise

export function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return resolve(process.env.ND_DSH_BENCH_OUTPUT || join(benchmarkRoot, 'benchmark-results', stamp + '-' + process.platform + '-' + process.arch))
}

export async function resultProvenance() {
  const binary = defaultCoreBinary()
  const declaredProfile = process.env.ND_DSH_BENCH_PROFILE?.trim()
  const binaryProfile = profileFromBinaryPath(binary)
  if (declaredProfile && binaryProfile && declaredProfile !== binaryProfile) {
    throw new Error(`Benchmark profile ${declaredProfile} does not match ND Core binary path profile ${binaryProfile}: ${binary}`)
  }
  return {
    commit: process.env.GITHUB_SHA?.trim() || await repositoryCommit(),
    buildProfile: declaredProfile || binaryProfile || 'custom',
    fixtureRevision: process.env.ND_DSH_BENCH_FIXTURE_REVISION?.trim() || 'prd-0002-v1',
    ndCore: await ndCoreProvenance(),
  }
}

function profileFromBinaryPath(binary) {
  const match = /[\\/]target[\\/](debug|release)[\\/]/i.exec(binary)
  return match?.[1]?.toLowerCase()
}

/**
 * Identify the nd-core executable the run is about to measure.
 *
 * `commit` and `buildProfile` identify the repository, not the binary: two
 * nd-core builds from the same commit are indistinguishable in evidence without
 * a hash, and a Rust measurement taken from a stale sidecar would still satisfy
 * every relative budget. The recorder supplies the staged release manifest's
 * hash for the packaged step (the executable bundled into the app), which also
 * cross-checks that packaging copied the core it built.
 */
async function ndCoreProvenance() {
  const declared = process.env.ND_DSH_BENCH_ND_CORE_SHA256?.trim()
  if (declared) {
    if (!/^[a-f0-9]{64}$/i.test(declared)) throw new Error('ND Core benchmark provenance must be a 64-character SHA-256 digest.')
    return {
      sha256: declared.toLowerCase(),
      source: process.env.ND_DSH_BENCH_ND_CORE_SOURCE?.trim() || 'declared',
      path: process.env.ND_DSH_BENCH_ND_CORE_PATH?.trim() || process.env.ND_DSH_CORE_BIN?.trim() || null,
    }
  }
  const binary = defaultCoreBinary()
  try {
    const bytes = await fs.readFile(binary)
    return { sha256: hashOf(bytes), source: 'binary', path: binary, sizeBytes: bytes.byteLength }
  } catch {
    return null
  }
}

function hashOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
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
