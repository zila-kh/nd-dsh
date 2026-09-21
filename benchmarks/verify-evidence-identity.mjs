#!/usr/bin/env node
/**
 * Prove the evidence identity gates fail on the pairs the numbers cannot catch.
 *
 * A legacy/rust pair that is swapped, or a pair whose runs used different
 * nd-core executables, still satisfies every relative budget in both
 * directions - the deltas simply invert or agree. Only the labels and the
 * binary hash refute it, so this script builds synthetic bundles, swaps them on
 * purpose, and asserts that `bench:check` refuses them for the right reason and
 * reports it as an identity failure rather than a budget violation.
 *
 * Run: node benchmarks/verify-evidence-identity.mjs
 */
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { evaluateEvidence } from './lib/budgets.mjs'
import { benchmarkRoot } from './lib/core-rpc.mjs'

const checks = []
function check(condition, label, detail) {
  checks.push({ label, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) })
  console.log((condition ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' - ' + detail))
}

const HASH = 'a'.repeat(64)
const environment = {
  os: 'win32', osVersion: '10.0.26100', arch: 'x64', cpuModel: 'synthetic reference cpu',
  logicalCpuCount: 16, physicalMemoryBytes: 34359738368, nodeVersion: 'v24.0.0',
}
const provenance = { schemaVersion: 1, commit: 'b'.repeat(40), buildProfile: 'release', fixtureRevision: 'prd-0002-v1', environment }

/** A synthetic bundle with the labels and hashes under test. */
function bundle({ legacyBackend = 'legacy', rustBackend = 'rust-core', rustHash = HASH, legacyRuns = 10 } = {}) {
  return {
    coreSummary: { ...provenance, backend: 'rust-core', ndCore: { sha256: HASH, source: 'binary' }, benchmarks: {} },
    legacyRuntime: { ...provenance, backend: legacyBackend, measuredRuns: legacyRuns, ndCore: { sha256: HASH, source: 'binary' } },
    rustRuntime: { ...provenance, backend: rustBackend, measuredRuns: 10, ndCore: { sha256: rustHash, source: 'binary' } },
    packagedStartup: { ...provenance, backend: 'rust-core', measuredRuns: 10, records: [], ndCore: { sha256: HASH, source: 'release-manifest' } },
  }
}

function checksOf(evaluated, id) {
  return evaluated.checks.filter((check) => check.id === id)
}

// 1. A correctly labelled bundle with one nd-core executable clears the identity gates.
const honest = evaluateEvidence(bundle())
check(checksOf(honest, 'backend-identity')[0]?.passed === true, 'correctly labelled evidence passes the backend identity gate')
check(checksOf(honest, 'core-binary-identity')[0]?.passed === true, 'one nd-core executable passes the binary identity gate')
check(checksOf(honest, 'full-provenance')[0]?.passed === true, 'matching provenance passes the full-provenance gate')

// 2. Swapping the legacy and rust documents inverts every relative budget, so
//    only the labels can catch it.
const swapped = evaluateEvidence(bundle({ legacyBackend: 'rust-core', rustBackend: 'legacy' }))
check(checksOf(swapped, 'backend-identity')[0]?.passed === false, 'a swapped legacy/rust pair fails the backend identity gate')
check(swapped.failures.some((failure) => failure.startsWith('[identity] ')), 'the swapped pair is reported as an identity failure', swapped.failures.find((failure) => failure.startsWith('[identity]')))
check(!swapped.failures.every((failure) => failure.startsWith('[budget] ')), 'the swapped pair is not excused as a budget violation')

// 3. Two different nd-core executables under one commit are invisible to
//    provenance and to every relative budget.
const stale = evaluateEvidence(bundle({ rustHash: 'c'.repeat(64) }))
check(checksOf(stale, 'core-binary-identity')[0]?.passed === false, 'two nd-core executables in one bundle fail the binary identity gate')
check(stale.failures.some((failure) => failure.startsWith('[identity] ')), 'the binary mismatch is reported as an identity failure', stale.failures.find((failure) => failure.startsWith('[identity]')))
check(checksOf(stale, 'backend-identity')[0]?.passed === true, 'the binary mismatch leaves correctly labelled backends passing')

// 4. A real budget violation stays distinguishable from an identity failure.
const undersampled = evaluateEvidence(bundle({ legacyRuns: 9 }))
check(undersampled.failures.some((failure) => failure.startsWith('[budget] ')), 'a budget violation is reported as a budget failure', undersampled.failures.find((failure) => failure.startsWith('[budget]')))
check(!undersampled.failures.some((failure) => failure.startsWith('[identity] ')), 'a budget violation does not masquerade as an identity failure')

// 5. `bench:check` itself must exit non-zero on the swapped bundle: that is the
//    gate CI runs, not just the evaluator behind it.
await checkBundleRejection()

const failed = checks.filter((entry) => !entry.passed)
console.log(JSON.stringify({ status: failed.length ? 'fail' : 'pass', checks }, null, 2))
if (failed.length) process.exitCode = 1

async function checkBundleRejection() {
  const directory = await mkdtemp(join(tmpdir(), 'nd-dsh-evidence-identity-'))
  try {
    const swappedBundle = bundle({ legacyBackend: 'rust-core', rustBackend: 'legacy' })
    const paths = { core: 'core/summary.json', legacy: 'legacy/electron-responsiveness.json', rust: 'rust/electron-responsiveness.json', packaged: 'packaged/app-startup.json' }
    for (const [key, item] of [['core', swappedBundle.coreSummary], ['legacy', swappedBundle.legacyRuntime], ['rust', swappedBundle.rustRuntime], ['packaged', swappedBundle.packagedStartup]]) {
      const path = join(directory, paths[key])
      await fs.mkdir(join(path, '..'), { recursive: true })
      await fs.writeFile(path, JSON.stringify(item, null, 2) + '\n', 'utf8')
    }
    const summaryPath = join(directory, 'summary.json')
    await fs.writeFile(summaryPath, JSON.stringify({
      schemaVersion: 1,
      kind: 'nd-performance-evidence',
      status: 'pass',
      ...provenance,
      paths,
    }, null, 2) + '\n', 'utf8')

    const result = spawnSync(process.execPath, [join(benchmarkRoot, 'benchmarks', 'check-budgets.mjs'), summaryPath], { cwd: benchmarkRoot, encoding: 'utf8' })
    check(result.status === 1, 'bench:check exits non-zero for the swapped bundle', 'exit=' + String(result.status))
    check(result.stdout.includes('[identity]'), 'bench:check names the identity failure on stdout',
      (result.stdout.split('\n').find((line) => line.includes('[identity]')) ?? 'no identity failure reported').trim())
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
