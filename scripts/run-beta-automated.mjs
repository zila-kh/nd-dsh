#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const continueOnFailure = flags.has('--continue-on-failure')
const skipLive = flags.has('--skip-live')
const skipPackage = flags.has('--skip-package')
const skipBenchmarks = flags.has('--skip-benchmarks')

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const commit = gitValue(['rev-parse', 'HEAD']) || 'unknown'
const branch = gitValue(['branch', '--show-current']) || 'detached'
const startedAt = new Date()
const outputDir = join(root, 'e2e-results', `beta-automated-${startedAt.toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(outputDir, { recursive: true })

const stages = [
  stage('unit', 'repository verification', 'verify'),
  stage('unit', 'TypeScript typecheck', 'typecheck'),
  stage('unit', 'unit/integration tests', 'test'),
  stage('unit', 'Rust fmt + clippy + tests', 'core:test'),
  stage('unit', 'browser native host Rust tests', 'browser:host:test'),
  stage('unit', 'browser platform focused tests', 'browser:platform:test'),
  stage('e2e', 'production renderer build', 'build'),
  stage('e2e', 'full Playwright desktop suite', 'e2e'),
  stage('e2e', 'explicit 3 companies x 2 projects matrix', 'e2e:beta:matrix'),
  ...(skipLive ? [] : [stage('e2e', 'live-model production journey + model stress', 'e2e:prod')]),
  ...(skipBenchmarks ? [] : [
    stage('evidence', 'built-in browser cookie/storage/download runtime proof', 'bench:browser-runtime'),
    stage('evidence', 'ND Core contract benchmark', 'bench:contract'),
    stage('evidence', 'agent-task committed baseline check', 'bench:tasks:check'),
  ]),
  ...(process.platform === 'win32' && !skipPackage ? [
    stage('artifact', 'Windows portable release build', 'dist:win:portable'),
    stage('artifact', 'forced nd-core crash cleans managed descendants', 'release:smoke:core-crash'),
    stage('artifact', 'packaged runtime/core/terminal/Git smoke', 'release:smoke:packaged'),
  ] : []),
]

const results = []
let failed = false
for (const item of stages) {
  if (failed && !continueOnFailure) {
    results.push({ ...item, status: 'not-run', durationMs: 0 })
    continue
  }
  console.log(`\n=== beta automated — ${item.layer} — ${item.name} (${item.script}) ===`)
  const began = Date.now()
  const outcome = runPnpmScript(item.script)
  const durationMs = Date.now() - began
  const status = outcome.status === 0 ? 'pass' : 'fail'
  results.push({
    ...item,
    status,
    exitCode: outcome.status,
    durationMs,
    ...(outcome.signal ? { signal: outcome.signal } : {}),
  })
  if (status === 'fail') failed = true
}

const requiredSkips = [
  ...(skipLive ? ['live-model production journey'] : []),
  ...(skipBenchmarks ? ['benchmark evidence'] : []),
  ...(skipPackage ? ['packaged artifact proof'] : []),
  ...(process.platform !== 'win32' ? ['Windows packaged artifact proof (must run on Windows RC machine)'] : []),
]
const allExecutedPassed = results.filter((row) => row.status !== 'not-run').every((row) => row.status === 'pass')
const releaseCompleteAutomated = allExecutedPassed && requiredSkips.length === 0 && results.every((row) => row.status === 'pass')

const artifact = resolvePackagedArtifact()
const report = {
  schemaVersion: 1,
  kind: 'nd-beta-automated-release-evidence',
  status: releaseCompleteAutomated ? 'pass' : failed ? 'fail' : 'partial',
  release: {
    version: packageJson.version,
    commit,
    branch,
    artifact,
  },
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpmEntrypoint: process.env.npm_execpath || null,
  },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  options: {
    continueOnFailure,
    skipLive,
    skipPackage,
    skipBenchmarks,
  },
  requiredSkips,
  stages: results,
  nextHumanSteps: [
    'Run the dedicated 24-hour soak on the exact RC artifact/environment.',
    'Run real-Chrome Browser Companion smoke and answer the native permission dialog.',
    'Complete docs/qa/beta-three-layer-evidence-<rc>.json Human evidence.',
    'Run beta:gate and let the human release owner record GO only after review.',
  ],
}
const reportPath = join(outputDir, 'beta-automated-summary.json')
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')

console.log('\n=== beta automated summary ===')
for (const row of results) {
  console.log(`  ${row.status.padEnd(8)} ${row.script.padEnd(26)} ${Math.round(row.durationMs / 1000)}s  ${row.name}`)
}
if (requiredSkips.length > 0) {
  console.log('\nRelease-complete automated evidence is still missing:')
  for (const item of requiredSkips) console.log(`  - ${item}`)
}
console.log(`\nReceipt: ${reportPath}`)
console.log(`Automated release status: ${report.status.toUpperCase()}`)

process.exitCode = releaseCompleteAutomated ? 0 : 1

function resolvePackagedArtifact() {
  if (process.platform !== 'win32' || skipPackage) return null
  const dist = join(root, 'dist')
  if (!existsSync(dist)) return null
  const name = readdirSync(dist).find((entry) => /^ND-DSH-.+-private-beta-.+\.exe$/i.test(entry))
  if (!name) return null
  const path = join(dist, name)
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  return {
    file: name,
    sha256,
    identity: `${name}#sha256:${sha256}`,
  }
}

function stage(layer, name, script) {
  return { layer, name, script }
}

function runPnpmScript(script) {
  const args = ['run', script]
  const pnpmEntrypoint = process.env.npm_execpath
  if (pnpmEntrypoint) {
    return spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    })
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  return result.status === 0 ? result.stdout.trim() : ''
}
