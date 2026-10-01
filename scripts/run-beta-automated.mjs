#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { releaseArtifact } from './release-artifact.mjs'
import { prepareReleaseTarget } from './prepare-release-target.mjs'
import { electronTargetIdentity } from './e2e-electron-target.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flags = new Set(process.argv.slice(2))
const continueOnFailure = flags.has('--continue-on-failure')
const skipLive = flags.has('--skip-live')
const skipPackage = flags.has('--skip-package')
const skipBenchmarks = flags.has('--skip-benchmarks')

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const commit = gitValue(['rev-parse', 'HEAD']) || 'unknown'
const branch = gitValue(['branch', '--show-current']) || 'detached'
const initialSourceStatus = gitValue(['status', '--porcelain', '--untracked-files=all'])
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
  ...(process.platform === 'win32' && !skipPackage ? [
    stage('artifact', 'Windows portable release build', 'dist:win:portable'),
    stage('artifact', 'forced packaged nd-core crash cleans managed descendants', 'release:smoke:core-crash'),
    stage('artifact', 'packaged runtime/core/terminal/Git smoke', 'release:smoke:packaged'),
  ] : []),
  stage('e2e', 'full Playwright desktop suite', 'e2e'),
  stage('e2e', 'explicit 3 companies x 2 projects matrix', 'e2e:beta:matrix'),
  ...(skipLive ? [] : [stage('e2e', 'live-model production journey + model stress', 'e2e:prod')]),
  ...(skipBenchmarks ? [] : [
    stage('evidence', 'built-in browser cookie/storage/download runtime proof', 'bench:browser-runtime'),
    stage('evidence', 'ND Core contract benchmark', 'bench:contract'),
    stage('evidence', 'agent-task committed baseline check', 'bench:tasks:check'),
  ]),
]

const results = []
let failed = false
let testedArtifact = null
let packagedTarget = null
let sourceChanged = initialSourceStatus !== ''
for (const item of stages) {
  if (failed && !continueOnFailure) {
    results.push({ ...item, status: 'not-run', durationMs: 0 })
    continue
  }
  console.log(`\n=== beta automated — ${item.layer} — ${item.name} (${item.script}) ===`)
  const began = Date.now()
  let outcome
  let applicationTarget
  try {
    assertCleanCandidate()
    const env = { ...process.env }
    if (process.platform === 'win32' && !skipPackage && (item.script.startsWith('e2e')
      || item.script.startsWith('release:smoke'))) {
      if (!packagedTarget) throw new Error('The current portable artifact has not been extracted for acceptance testing.')
      const target = electronTargetIdentity(packagedTarget.env)
      if (testedArtifact && testedArtifact.artifact !== target.artifact) throw new Error('Release artifact changed during acceptance testing.')
      testedArtifact = target
      if (item.script.startsWith('e2e')) Object.assign(env, packagedTarget.env)
      else {
        env.ND_DSH_E2E_EXECUTABLE = releaseArtifact(root).executable
        delete env.ND_DSH_E2E_PACKAGE_RECEIPT
      }
      applicationTarget = target
      if (item.script === 'release:smoke:core-crash') {
        env.ND_DSH_CORE_BIN = join(dirname(target.executable), 'resources', 'nd-core', 'nd-core.exe')
      }
    }
    outcome = runPnpmScript(item.script, env)
    if (item.script === 'dist:win:portable' && outcome.status === 0) {
      packagedTarget = await prepareReleaseTarget(root, outputDir)
    }
    assertCleanCandidate()
  } catch (error) {
    console.error(String(error))
    outcome = { status: 1 }
  }
  const durationMs = Date.now() - began
  const status = outcome.status === 0 ? 'pass' : 'fail'
  results.push({
    ...item,
    status,
    exitCode: outcome.status,
    durationMs,
    ...(applicationTarget ? { applicationTarget } : {}),
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
const artifact = resolvePackagedArtifact()
let payloadVerified = false
if (packagedTarget) {
  try { payloadVerified = electronTargetIdentity(packagedTarget.env).artifact === artifact?.identity }
  catch (error) { console.error(String(error)); failed = true }
}
const finalCommit = gitValue(['rev-parse', 'HEAD']) || 'unknown'
const finalSourceStatus = gitValue(['status', '--porcelain', '--untracked-files=all'])
const sourceStable = !sourceChanged && commit !== 'unknown' && commit === finalCommit
  && initialSourceStatus === '' && finalSourceStatus === ''
const releaseCompleteAutomated = allExecutedPassed
  && requiredSkips.length === 0
  && results.every((row) => row.status === 'pass')
  && artifact !== null
  && artifact.identity === testedArtifact?.artifact
  && sourceStable
  && payloadVerified
const report = {
  schemaVersion: 1,
  kind: 'nd-beta-automated-release-evidence',
  status: releaseCompleteAutomated ? 'pass' : failed ? 'fail' : 'partial',
  release: {
    version: packageJson.version,
    commit,
    branch,
    artifact,
    sourceStable,
    payloadVerified,
    finalCommit,
    initialSourceStatus,
    finalSourceStatus,
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
const missingEvidence = [...requiredSkips]
if (!artifact) missingEvidence.push('one exact versioned Windows portable artifact with SHA-256 identity')
if (!sourceStable) missingEvidence.push('an unchanged clean candidate commit throughout this run')
if (artifact && artifact.identity !== testedArtifact?.artifact) missingEvidence.push('acceptance tests against this exact artifact')
if (missingEvidence.length > 0) {
  console.log('\nRelease-complete automated evidence is still missing:')
  for (const item of missingEvidence) console.log(`  - ${item}`)
}
console.log(`\nReceipt: ${reportPath}`)
console.log(`Automated release status: ${report.status.toUpperCase()}`)

process.exitCode = releaseCompleteAutomated ? 0 : 1

function resolvePackagedArtifact() {
  if (process.platform !== 'win32' || skipPackage) return null
  try {
    const target = releaseArtifact(root)
    return { file: target.artifact.split('#sha256:')[0], sha256: target.sha256, identity: target.artifact }
  } catch { return null }
}

function stage(layer, name, script) {
  return { layer, name, script }
}

function runPnpmScript(script, env = process.env) {
  const args = ['run', script]
  const pnpmEntrypoint = process.env.npm_execpath
  if (pnpmEntrypoint) {
    return spawnSync(process.execPath, [pnpmEntrypoint, ...args], {
      cwd: root,
      stdio: 'inherit',
      env,
    })
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  })
}

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function assertCleanCandidate() {
  if (gitValue(['rev-parse', 'HEAD']) !== commit || gitValue(['status', '--porcelain', '--untracked-files=all']) !== '') {
    sourceChanged = true
    throw new Error('Release checks require the same clean candidate commit before and after every stage.')
  }
}
