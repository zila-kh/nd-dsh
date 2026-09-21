import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { evaluateEvidence } from './lib/budgets.mjs'
import { benchmarkRoot } from './lib/core-rpc.mjs'
import { defaultOutputDir, resultProvenance } from './lib/results.mjs'

if (process.platform !== 'win32') {
  console.error('Full PRD 0002 release evidence must run on the documented Windows x64 reference machine.')
  process.exit(2)
}

const outputDir = defaultOutputDir()
const root = benchmarkRoot
const runs = Math.max(10, Number(process.env.ND_DSH_BENCH_RUNS || 10))
const coreDir = join(outputDir, 'core')
const legacyDir = join(outputDir, 'legacy')
const rustDir = join(outputDir, 'rust')
const packagedDir = join(outputDir, 'packaged')

await fs.mkdir(outputDir, { recursive: true })

if (process.env.ND_DSH_BENCH_SKIP_PACKAGE_BUILD !== '1') {
  console.log('\nBuilding the current Windows portable artifact and staged nd-core...')
  await runPnpm(['dist:win:portable'])
}

const packagedApp = await resolvePortable()
const staged = await stagedCoreIdentity()
const shared = safeEnvironment()
Object.assign(shared, {
  ND_DSH_BENCH_PROFILE: 'release',
  ND_DSH_BENCH_FIXTURE_REVISION: 'prd-0002-v1',
  ND_DSH_BENCH_RUNS: String(runs),
})
if (staged) {
  console.log('Staged release manifest identifies nd-core ' + staged.sha256.slice(0, 12) + ' (from ' + staged.path + ').')
}

console.log('\nRecording release-profile nd-core suite...')
await runNode(['benchmarks/run-suite.mjs'], { ...shared, ND_DSH_BENCH_BACKEND: 'rust-core', ND_DSH_BENCH_OUTPUT: coreDir })

console.log('\nRecording same-build legacy Electron runtime...')
await runNode(['benchmarks/app-runtime.mjs', 'legacy'], { ...shared, ND_DSH_BENCH_BACKEND: 'legacy', ND_DSH_BENCH_OUTPUT: legacyDir })

console.log('\nRecording same-build Rust Electron runtime...')
await runNode(['benchmarks/app-runtime.mjs', 'rust-core'], { ...shared, ND_DSH_BENCH_BACKEND: 'rust-core', ND_DSH_BENCH_OUTPUT: rustDir })

console.log('\nRecording actual packaged Windows startup...')
await runNode(['benchmarks/app-startup.mjs'], {
  ...shared,
  ND_DSH_BENCH_BACKEND: 'rust-core',
  ND_DSH_BENCH_OUTPUT: packagedDir,
  ND_DSH_BENCH_PACKAGED_APP: packagedApp,
  ...(staged ? { ND_DSH_BENCH_ND_CORE_SHA256: staged.sha256, ND_DSH_BENCH_ND_CORE_SOURCE: 'release-manifest' } : {}),
})

const paths = {
  core: relative(outputDir, join(coreDir, 'summary.json')).replaceAll('\\', '/'),
  legacy: relative(outputDir, join(legacyDir, 'electron-responsiveness.json')).replaceAll('\\', '/'),
  rust: relative(outputDir, join(rustDir, 'electron-responsiveness.json')).replaceAll('\\', '/'),
  packaged: relative(outputDir, join(packagedDir, 'app-startup.json')).replaceAll('\\', '/'),
}
const coreSummary = await readJson(join(outputDir, paths.core))
const legacyRuntime = await readJson(join(outputDir, paths.legacy))
const rustRuntime = await readJson(join(outputDir, paths.rust))
const packagedStartup = await readJson(join(outputDir, paths.packaged))
const budget = evaluateEvidence({ coreSummary, legacyRuntime, rustRuntime, packagedStartup })
const provenance = await resultProvenance()

const summary = {
  schemaVersion: 1,
  kind: 'nd-performance-evidence',
  timestamp: new Date().toISOString(),
  status: budget.status,
  ...provenance,
  environment: rustRuntime.environment,
  packagedApp: {
    file: packagedApp,
    appStartupP50Ms: packagedStartup.summaryMs?.p50 ?? null,
    appStartupP95Ms: packagedStartup.summaryMs?.p95 ?? null,
  },
  paths,
  comparison: budget.comparison,
  budget: {
    status: budget.status,
    checks: budget.checks,
    failures: budget.failures,
    observations: budget.observations,
  },
}
await fs.writeFile(join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
await fs.writeFile(join(outputDir, 'summary.md'), renderMarkdown(summary, packagedStartup) + '\n', 'utf8')

console.log('\nBenchmark evidence ' + budget.status.toUpperCase())
console.log('Bundle: ' + outputDir)
console.log('Summary: ' + join(outputDir, 'summary.md'))
if (budget.failures.length) {
  for (const failure of budget.failures) console.error('FAIL: ' + failure)
  process.exitCode = 1
}

async function resolvePortable() {
  const explicit = process.env.ND_DSH_BENCH_PACKAGED_APP?.trim()
  if (explicit) {
    const path = resolve(explicit)
    if (!existsSync(path)) throw new Error('ND_DSH_BENCH_PACKAGED_APP does not exist: ' + path)
    return path
  }
  const dist = join(root, 'dist')
  const entries = await fs.readdir(dist)
  const matches = entries.filter((entry) => /^ND-DSH-.+-private-beta-.+\.exe$/i.test(entry)).sort()
  const name = matches.at(-1)
  if (!name) throw new Error('No Windows portable artifact found in ' + dist + '. Run pnpm dist:win:portable or omit ND_DSH_BENCH_SKIP_PACKAGE_BUILD.')
  return join(dist, name)
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

/**
 * The nd-core executable the staged release bundles, straight from the release
 * manifest. It is the identity the packaged evidence must claim; comparing it
 * with the core the suite measured is what proves the packaged app ran the same
 * sidecar build (see the `core-binary-identity` gate in lib/budgets.mjs).
 */
async function stagedCoreIdentity() {
  const manifestPath = join(root, '.release', 'release-manifest.json')
  try {
    const manifest = await readJson(manifestPath)
    const sha256 = manifest?.ndCore?.sha256
    if (typeof sha256 !== 'string' || !sha256.trim()) return undefined
    return { sha256: sha256.trim().toLowerCase(), path: relative(root, manifestPath).replaceAll('\\', '/') }
  } catch {
    return undefined
  }
}

function runPnpm(args) {
  const command = process.platform === 'win32' ? join(dirname(process.execPath), 'corepack.cmd') : 'corepack'
  return run(command, ['pnpm', ...args], process.env)
}

function runNode(args, env) {
  return run(process.execPath, args, env)
}

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command),
      env,
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(command + ' ' + args.join(' ') + ' exited with code ' + String(code)))
    })
  })
}

function safeEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)) continue
    env[key] = value
  }
  return env
}

function renderMarkdown(summary, packagedStartup) {
  const env = summary.environment ?? {}
  const checkById = new Map(summary.budget.checks.map((check) => [check.id, check]))
  const budgetByMetric = {
    'main-cpu-p50': 'relative-main-cpu',
    'idle-backend-memory-p50': 'relative-idle-memory',
    'session-growth-p50': 'relative-session-scaling',
    'terminal-stress-p50': 'relative-terminal',
    'git-refresh-p50': 'relative-git',
    'cancel-p95': 'relative-cancel',
  }
  const rows = summary.comparison.rows.map((row) => {
    const check = checkById.get(budgetByMetric[row.id])
    return '| ' + row.label + ' | ' + formatValue(row.baseline, row.unit) + ' | ' + formatValue(row.candidate, row.unit)
      + ' | ' + formatDelta(row.deltaPct) + ' | ' + (check?.budget ?? 'report') + ' | ' + (check ? (check.passed ? 'PASS' : 'FAIL') : 'INFO') + ' |'
  })
  const checks = summary.budget.checks.map((check) =>
    '| ' + check.label + ' | ' + (check.passed ? 'PASS' : 'FAIL') + ' | ' + escapeCell(formatActual(check.actual)) + ' | ' + escapeCell(check.budget) + ' |')
  const observations = summary.budget.observations.map((item) =>
    '- ' + item.label + ': ' + item.count + ' observed; max ' + formatValue(item.maxMs, 'ms') + '. Attribution: ' + item.attribution + '.')
  return [
    '# ND PRD 0002 Performance Evidence',
    '',
    '**Result: ' + summary.status.toUpperCase() + '**',
    '',
    '- Commit: `' + summary.commit + '`',
    '- Backend comparison: legacy vs rust-core, same built Electron app',
    '- Build profile: ' + summary.buildProfile,
    '- Fixture revision: ' + summary.fixtureRevision,
    '- Reference: ' + [env.os, env.osVersion, env.arch, env.cpuModel, formatBytes(env.physicalMemoryBytes)].filter(Boolean).join(' / '),
    '- Packaged Windows startup: p50 ' + formatValue(packagedStartup.summaryMs?.p50, 'ms') + ', p95 ' + formatValue(packagedStartup.summaryMs?.p95, 'ms'),
    '',
    '## Same-machine comparison',
    '',
    '| Metric | Legacy | Rust core | Delta | Budget | Result |',
    '| --- | ---: | ---: | ---: | --- | --- |',
    ...rows,
    '',
    '## Absolute and correctness gates',
    '',
    '| Gate | Result | Actual | Budget |',
    '| --- | --- | --- | --- |',
    ...checks,
    '',
    '## Notable outliers',
    '',
    ...(observations.length ? observations : ['- None recorded.']),
    '',
    '## Raw machine-readable evidence',
    '',
    '- [Core suite](' + summary.paths.core + ')',
    '- [Legacy Electron runtime](' + summary.paths.legacy + ')',
    '- [Rust Electron runtime](' + summary.paths.rust + ')',
    '- [Packaged startup](' + summary.paths.packaged + ')',
    '- [Combined budget summary](summary.json)',
    '',
    'All percentages and PASS/FAIL values above are generated from the linked JSON artifacts.',
  ].join('\n')
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return 'n/a'
  if (unit === 'bytes') return formatBytes(value)
  if (unit === 'ms') return Number(value).toFixed(2) + ' ms'
  return Number(value).toFixed(2)
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'n/a'
  return (value / (1024 * 1024)).toFixed(2) + ' MiB'
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return 'n/a'
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%'
}

function formatActual(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3)
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}
