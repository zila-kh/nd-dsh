/**
 * Real-user production E2E driver — one coherent vibe-coder journey across
 * three AI companies, five tiny projects, three autonomy levels and three
 * model routes.
 *
 * Journey (implemented order; see docs/plan/real-user-production-e2e.md):
 *
 *   Phase A — fresh profile, SoloForge / Notes Mini used like a normal single
 *             coding agent through the visible Agent workbench (composer,
 *             model picker, explorer, terminal, source control).
 *   Setup   — SwiftCab Labs (autonomy 3) with Dispatch + Driver planned by the
 *             real AI PM while the company sits at the default level 2, then
 *             raised to 3; TinyCart Studio (autonomy 4) with Catalog (two
 *             independent tasks, two workers) and Checkout created pre-run.
 *   Start   — Dispatch started through the visible "Run next" button, Driver
 *             through the same explicit IPC, then TinyCart is raised to 4
 *             which autostarts Catalog while SwiftCab work is live, then
 *             Checkout. All four pipelines overlap.
 *   Phase E — deliberate company/project switch attempts + surface navigation
 *             while executions run; every running task's bound workspace must
 *             stay identical and background work must continue.
 *   Phase D — deliveries monitored to 100%: Catalog same-project parallelism,
 *             routes, checkpoints, fresh reviews, integrations, tests.
 *   Phase F — quit Electron during an active execution, relaunch on the same
 *             profile, assert explicit interruption semantics, retry the
 *             interrupted task through ND and finish the project.
 *   Engine  — optional local coding-engine compatibility probe (skipped when
 *             no Codex engine is installed/authenticated; never fails the
 *             core .env.e2e matrix).
 *
 * Rules honoured by this driver (production-realism contract):
 *   - NO hidden nudge/repair logic: no silently created tasks, no silent task
 *     completion, no mid-run model reassignment, no state-conditional retries
 *     other than the scripted Phase F "retry through ND" scenario step.
 *   - Every long wait is bounded with diagnostics; stalls fail loudly.
 *   - Every writable project uses its own fresh real Git repository with a
 *     baseline commit and a passing `node --test` smoke test; the developer's
 *     nd-dsh checkout is never a target.
 *   - The API key is never written to evidence; a final scan proves it.
 *
 * Usage:  pnpm build && node e2e/real-user-prod.mjs     (needs .env.e2e)
 * Exit:   0 pass · 1 test failure (or provider failure) · 2 config missing
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { _electron as electron } from '@playwright/test'
import {
  buildRouteEvidence,
  computeConcurrency,
  createEvidenceRun,
  environmentFacts,
  parseRoute,
  parseVerification,
  scanForSecrets,
  secretValues,
} from './lib/prod-evidence.mjs'

// E2E credentials live in the gitignored .env.e2e; plain .env supplies the rest.
// Load .env.e2e first so it wins.
loadDotenv({ path: '.env.e2e', quiet: true })
loadDotenv({ quiet: true })

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const EVIDENCE_ROOT = join(REPO, 'e2e-results')

const PROVIDER_ID = 'e2e-openai-compatible'
const PROVIDER_NAME = 'E2E OpenAI Compatible'

// ── Model configuration (all-or-none, live run required) ─────────────────────
const BASE_URL = process.env.E2E_MODEL_BASE_URL?.trim() ?? ''
const API_KEY = process.env.E2E_MODEL_API_KEY?.trim() ?? ''
const MODELS = [
  process.env.E2E_MODEL_1?.trim() ?? '',
  process.env.E2E_MODEL_2?.trim() ?? '',
  process.env.E2E_MODEL_3?.trim() ?? '',
]
const ANY_MODEL_ENV = Boolean(BASE_URL || API_KEY || MODELS.some(Boolean))
const MODEL_ENV_READY = Boolean(BASE_URL && API_KEY && MODELS.every(Boolean))
if (ANY_MODEL_ENV && !MODEL_ENV_READY) {
  console.error('Incomplete E2E model configuration. Set E2E_MODEL_BASE_URL, E2E_MODEL_API_KEY, E2E_MODEL_1, E2E_MODEL_2 and E2E_MODEL_3 together.')
  process.exit(2)
}
if (!MODEL_ENV_READY) {
  console.error('real-user-prod is a live-model production journey: configure .env.e2e (see .env.e2e.example) first.')
  process.exit(2)
}
const [M1, M2, M3] = MODELS
const CONTEXT = process.env.E2E_MODEL_CONTEXT?.trim() || '256000'

// ── Topology ─────────────────────────────────────────────────────────────────
const TOPOLOGY = {
  soloforge: {
    name: 'SoloForge',
    mission: 'Ship focused one-person tools with a normal coding-assistant workflow.',
    notes: {
      name: 'Notes Mini',
      objective: 'Deliver a tiny dependency-free notes formatter with one test.',
    },
  },
  swift: {
    name: 'SwiftCab Labs',
    mission: 'Coordinate a small mobility fleet with reliable dispatch and driver tooling.',
    dispatch: {
      name: 'Dispatch Mini',
      objective: 'Create a dependency-free JavaScript dispatch-status module for a tiny taxi fleet with the states AVAILABLE, BUSY and OFFLINE. Plan at most two small tasks (implementation and tests). Every task must leave `node --test` passing (ESM *.test.js files; package.json already sets type=module). Keep it tiny: one module file plus tests, nothing else.',
    },
    driver: {
      name: 'Driver Mini',
      objective: 'Create a dependency-free JavaScript driver-job formatter: input {pickup, destination} must format to exactly "Pickup -> Destination". Plan at most two small tasks (implementation and tests). Every task must leave `node --test` passing (ESM *.test.js files; package.json already sets type=module). Keep it tiny: one module file plus tests, nothing else.',
    },
  },
  tinycart: {
    name: 'TinyCart Studio',
    mission: 'Build focused commerce tools for very small sellers.',
    catalog: {
      name: 'Catalog Mini',
      objective: 'Two independent tiny catalog utilities: a catalog-item formatter and an inventory-count formatter, each with tests.',
    },
    checkout: {
      name: 'Checkout Mini',
      objective: 'A tiny checkout total/tax formatter with one test.',
    },
  },
}

const CATALOG_TASK_A = {
  title: 'Create catalog-item formatter + tests',
  description: 'Create catalog-item.js only (plus its test): ESM module exporting formatCatalogItem({name, price, stock}) returning exactly "Widget | 9.99 | 3" for {name:"Widget", price:9.99, stock:3} (price rendered with exactly two decimals). Also create catalog-item.test.js using node:test and node:assert/strict covering formatCatalogItem. Leave `node --test` passing. No dependencies, no other files.',
  criteria: [
    'catalog-item.js exists and exports formatCatalogItem.',
    'formatCatalogItem({name:"Widget", price:9.99, stock:3}) returns exactly "Widget | 9.99 | 3".',
    'catalog-item.test.js exists and `node --test` passes in the workspace.',
  ],
}
const CATALOG_TASK_B = {
  title: 'Create inventory-count formatter + tests',
  description: 'Create inventory-count.js only (plus its test): ESM module exporting formatInventoryCount(sku, count) returning exactly "WID=3" for ("WID", 3). Also create inventory-count.test.js using node:test and node:assert/strict covering formatInventoryCount. Leave `node --test` passing. No dependencies, no other files.',
  criteria: [
    'inventory-count.js exists and exports formatInventoryCount.',
    'formatInventoryCount("WID", 3) returns exactly "WID=3".',
    'inventory-count.test.js exists and `node --test` passes in the workspace.',
  ],
}
const CHECKOUT_TASK = {
  title: 'Create checkout-total formatter + tests',
  description: 'Create checkout-total.js only (plus its test): ESM module exporting formatCheckoutTotal(cents) returning exactly "$12.34" for 1234. Also create checkout-total.test.js using node:test and node:assert/strict covering formatCheckoutTotal. Leave `node --test` passing. No dependencies, no other files.',
  criteria: [
    'checkout-total.js exists and exports formatCheckoutTotal.',
    'formatCheckoutTotal(1234) returns exactly "$12.34".',
    'checkout-total.test.js exists and `node --test` passes in the workspace.',
  ],
}
const PHASE_F_VICTIM = {
  title: 'Create checkout-tax formatter + tests',
  description: 'Create checkout-tax.js only (plus its test): ESM module exporting formatCheckoutTax(cents, ratePercent) returning exactly "100" for (1000, 10) (tax in cents, rounded half-up). Also create checkout-tax.test.js using node:test and node:assert/strict covering formatCheckoutTax. Leave `node --test` passing. No dependencies, no other files.',
  criteria: [
    'checkout-tax.js exists and exports formatCheckoutTax.',
    'formatCheckoutTax(1000, 10) returns exactly "100".',
    'checkout-tax.test.js exists and `node --test` passes in the workspace.',
  ],
}

const CHAT_PROMPT_1 = [
  'Create a dependency-free JavaScript notes formatter in this workspace:',
  '1. notes-formatter.js — ESM module exporting formatNote(title, body) that returns "# " + title + "\\n\\n" + body with whitespace trimmed.',
  '2. notes-formatter.test.js — ESM test using node:test and node:assert/strict covering formatNote with at least one exact-output assertion.',
  '3. Append the line "- notes-formatter: formatNote(title, body) builds markdown notes" to README.md.',
  'Then run `node --test` and make sure all tests pass. Do not add dependencies and do not create other files.',
].join('\n')
const CHAT_PROMPT_2 = 'Run `node --test` in this workspace again and report the pass and fail counts in one short sentence.'

// ── Timeouts (ms) ────────────────────────────────────────────────────────────
const T = {
  ui: 45_000,
  chat: 10 * 60_000,
  plan: 10 * 60_000,
  start: 60_000,
  deliveries: 90 * 60_000,
  stall: 15 * 60_000,
  quiesce: 5 * 60_000,
  retry: 25 * 60_000,
  global: 210 * 60_000,
}
const DEADLINE_AT = Date.now() + T.global

// ── Evidence + run-level state ───────────────────────────────────────────────
const evidence = createEvidenceRun(EVIDENCE_ROOT)
const log = (line) => evidence.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
log(`evidence directory: ${evidence.dir}`)
evidence.writeJson('environment.json', environmentFacts())

const rendererErrors = []
const scriptedActions = []
const guardProbes = []
const runTimeline = new Map()
const liveObservations = []
let maxLiveObserved = 0
let liveCrossProjectAt = null
let liveCrossCompanyAt = null
let failureClass = null
let phaseResults = {}

const pushAction = (phase, action, detail) => {
  scriptedActions.push({ at: Date.now(), phase, action, detail })
}

function classifyFailure(text) {
  const value = String(text ?? '')
  if (/401|403|invalid_api_key|incorrect api key|unauthorized|missing api key|no api key|authentication/i.test(value)) return 'provider-auth'
  if (/429|rate.?limit|rate_limit|quota|too many requests|overloaded|529|503|service unavailable/i.test(value)) return 'provider-rate'
  return 'product'
}

/**
 * Thrown from inside waitUntil probes when waiting further is pointless
 * (provider auth failure, failed plan, blocked retry). waitUntil rethrows
 * these instead of swallowing them into the poll loop.
 */
class FatalWaitError extends Error {}

// ── Small utilities ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve_) => setTimeout(resolve_, ms))
}

function checkDeadline() {
  if (Date.now() > DEADLINE_AT) throw new Error(`Global driver deadline of ${Math.round(T.global / 60_000)} minutes exceeded.`)
}

function git(cwd, args) {
  const result = spawnSync('git', [
    '-c', 'user.name=ND-DSH Prod E2E', '-c', 'user.email=prod-e2e@nd-dsh.invalid', '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${String(result.stderr || '').trim() || result.status}`)
  return String(result.stdout ?? '')
}

function gitOk(cwd, args) {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true })
  return { ok: result.status === 0, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
}

/**
 * Every writable project gets its own fresh real Git repository with a
 * baseline commit and a passing `node --test` smoke file, so ND machine
 * verification (`node --test`) has a green baseline in every worktree and the
 * developer's own checkout is never a target.
 */
function createRepoWorkspace(label) {
  const dir = mkdtempSync(join(tmpdir(), `nd-prod-e2e-${label}-`))
  git(dir, ['init', '--initial-branch=main'])
  writeFileSync(join(dir, 'README.md'), `# ${label} workspace\n\nSeeded by e2e/real-user-prod.mjs with a passing node --test baseline.\n`, 'utf8')
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `${label}-workspace`, private: true, type: 'module' }, null, 2)}\n`, 'utf8')
  writeFileSync(join(dir, 'smoke.test.js'), [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "test('baseline smoke stays green in every worktree', () => {",
    '  assert.equal(1 + 1, 2)',
    '})',
    '',
  ].join('\n'), 'utf8')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', `chore: seed the ${label} workspace`])
  const probe = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', windowsHide: true })
  if (probe.status !== 0) {
    throw new Error(`Baseline node --test failed in seeded workspace ${dir}: ${stripAnsi(probe.stdout || '').slice(-500)}`)
  }
  return dir
}

function listNewArtifacts(wsRoot, baseline = new Set(['README.md', 'package.json', 'smoke.test.js', '.git'])) {
  try {
    return readdirSync(wsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !baseline.has(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function runNodeTests(wsRoot) {
  const probe = spawnSync(process.execPath, ['--test'], { cwd: wsRoot, encoding: 'utf8', windowsHide: true, timeout: 120_000 })
  return { exitCode: probe.status, output: stripAnsi(`${probe.stdout ?? ''}${probe.stderr ?? ''}`).slice(-4_000) }
}

// ── waitUntil: bounded, stall-aware, diagnostic-rich ─────────────────────────
async function waitUntil(label, probe, options = {}) {
  const { timeoutMs = 120_000, stallMs = 0, pollMs = 1_500 } = options
  const startedAt = Date.now()
  let lastSig
  let lastChangeAt = startedAt
  let lastDetail = '(no probe output yet)'
  for (;;) {
    checkDeadline()
    let out
    try {
      out = await probe()
    } catch (error) {
      if (error instanceof FatalWaitError) throw error
      out = { done: false, detail: `probe error: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (out.done) return out.value
    lastDetail = out.detail ?? lastDetail
    const sig = out.sig ?? lastDetail
    const now = Date.now()
    if (sig !== lastSig) {
      lastSig = sig
      lastChangeAt = now
    }
    if (now - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for: ${label}. Last observed: ${lastDetail}`)
    }
    if (stallMs && now - lastChangeAt > stallMs) {
      throw new Error(`Stalled waiting for: ${label} (no state change for ${Math.round((now - lastChangeAt) / 60_000)} min). Last observed: ${lastDetail}`)
    }
    await sleep(pollMs)
  }
}

// ── App lifecycle ────────────────────────────────────────────────────────────
let currentPage = null
let currentApp = null
let userDataDir = null
let approvalLoopToken = 0

function seedProviders(dir) {
  mkdirSync(dir, { recursive: true })
  const providers = [{
    id: PROVIDER_ID,
    name: PROVIDER_NAME,
    enabled: true,
    baseUrl: BASE_URL,
    apiFormat: 'OpenAI compatible (/v1/chat/completions)',
    apiKey: API_KEY,
    models: MODELS.map((id) => ({ id, context: CONTEXT })),
  }]
  // Written only into the throwaway profile; never into evidence.
  writeFileSync(join(dir, 'providers.json'), JSON.stringify(providers, null, 2), 'utf8')
}

function attachPageHandlers(page) {
  page.on('pageerror', (error) => {
    rendererErrors.push(`pageerror: ${error.message}`)
    evidence.noteError(`[renderer] pageerror: ${error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    rendererErrors.push(`console: ${message.text()}`)
    evidence.noteError(`[renderer] console: ${message.text()}`)
  })
}

async function installFrameRecorder(page) {
  await page.evaluate(() => {
    const keep = new Set([
      'session-status', 'agent-error', 'stream-error',
      'approval-requested', 'approval-resolved', 'question-requested', 'question-resolved',
    ])
    const box = { frames: [], installedAt: Date.now() }
    window.__ndProdE2E = box
    window.ndDsh.dsh.onEvent((frame) => {
      if (!keep.has(frame.kind)) return
      const row = { kind: frame.kind, at: Date.now() }
      for (const key of ['sessionId', 'running', 'message', 'toolName', 'reason', 'rpcId', 'approvalId']) {
        if (frame[key] !== undefined) row[key] = frame[key]
      }
      box.frames.push(row)
      if (box.frames.length > 4000) box.frames.splice(0, 1500)
    })
  })
}

async function sessionFrames(sessionId) {
  return currentPage.evaluate((sid) => {
    const frames = window.__ndProdE2E?.frames ?? []
    return sid ? frames.filter((frame) => frame.sessionId === sid) : frames
  }, sessionId ?? null)
}

function startApprovalLoop() {
  const token = ++approvalLoopToken
  const tick = async () => {
    if (token !== approvalLoopToken || !currentPage) return
    try {
      const card = currentPage.locator('aside[aria-label="Runtime requests"]')
      if (await card.count() > 0) {
        const allow = card.getByRole('button', { name: 'Allow once' })
        const count = await allow.count()
        for (let i = 0; i < count; i += 1) {
          log(`[approval] allowing once (${i + 1}/${count})`)
          await allow.nth(i).click({ timeout: 2_500 }).catch(() => undefined)
        }
        const submit = card.getByRole('button', { name: 'Submit answer' })
        if (await submit.count() > 0) {
          const sections = card.locator('section')
          const sectionCount = await sections.count()
          log(`[approval] answering agent question (${sectionCount} section(s))`)
          for (let i = 0; i < sectionCount; i += 1) {
            await sections.nth(i).getByRole('button').first().click({ timeout: 2_000 }).catch(() => undefined)
          }
          await submit.first().click({ timeout: 2_000 }).catch(() => undefined)
        }
      }
    } catch {
      // The card can vanish between count() and click(); the next tick retries.
    }
    setTimeout(() => void tick(), 700)
  }
  void tick()
}

async function launchApp(profileDir) {
  const dir = profileDir ?? mkdtempSync(join(tmpdir(), 'nd-prod-e2e-profile-'))
  seedProviders(dir)
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dir}`], cwd: REPO })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.setDefaultTimeout(45_000)
  attachPageHandlers(page)
  await installFrameRecorder(page)
  currentApp = app
  currentPage = page
  userDataDir = dir
  startApprovalLoop()
  return { app, page, userDataDir: dir }
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve_) => {
    const timer = setTimeout(() => resolve_(child.exitCode !== null), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve_(true)
    })
  })
}

async function closeApp() {
  if (!currentApp) return
  approvalLoopToken += 1
  const app = currentApp
  const child = app.process()
  try {
    await Promise.race([
      app.evaluate(({ app: electronApp }) => { setImmediate(() => electronApp.quit()) }).catch(() => undefined),
      sleep(2_000),
    ])
  } catch {
    // fall through to bounded exit wait / force kill
  }
  let exited = await waitForProcessExit(child, 8_000)
  if (!exited) {
    log(`[close] graceful quit timed out; force-killing pid=${child.pid ?? 'unknown'}`)
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try { process.kill(child.pid, 'SIGKILL') } catch { /* already gone */ }
    }
    exited = await waitForProcessExit(child, 5_000)
  }
  await Promise.race([app.close().catch(() => undefined), sleep(15_000)])
  currentApp = null
  currentPage = null
  log(`[close] exited=${exited}`)
}

// ── Organization state / API wrappers (every call is a scripted action) ─────
function recordSnapshot(snap) {
  for (const run of snap.runs) runTimeline.set(run.id, { ...runTimeline.get(run.id), ...run })
  const live = snap.runs.filter((run) => run.status === 'running' && run.kind === 'task-execution')
  if (live.length > maxLiveObserved) maxLiveObserved = live.length
  const projectIds = [...new Set(live.map((run) => run.projectId))].sort()
  const companyIds = [...new Set(live.map((run) => run.companyId))].sort()
  const signature = JSON.stringify([live.map((run) => run.id).sort(), projectIds, companyIds])
  const last = liveObservations.at(-1)
  if (!last || last.signature !== signature) {
    const observation = { at: Date.now(), signature, runIds: live.map((run) => run.id), projectIds, companyIds }
    liveObservations.push(observation)
    if (liveObservations.length > 4000) liveObservations.splice(0, 1_500)
    if (projectIds.length >= 2 && !liveCrossProjectAt) liveCrossProjectAt = observation
    if (companyIds.length >= 2 && !liveCrossCompanyAt) liveCrossCompanyAt = observation
  }
  return snap
}

async function state() {
  const snap = await currentPage.evaluate(() => window.ndDshOrganization.state())
  return recordSnapshot(snap)
}

async function mutate(phase, mutation) {
  pushAction(phase, `mutate:${mutation.type}`, { ...mutation })
  log(`[action:${phase}] mutate ${mutation.type}`)
  const snap = await currentPage.evaluate((input) => window.ndDshOrganization.mutate(input), mutation)
  return recordSnapshot(snap)
}

async function apiRunNext(phase, projectId) {
  pushAction(phase, 'runNext', { projectId })
  log(`[action:${phase}] runNext(project=${projectId})`)
  const receipt = await currentPage.evaluate((id) => window.ndDshOrganization.runNext(id), projectId)
  if (!receipt) throw new Error(`Explicit runNext(${projectId}) returned null — nothing dispatched`)
  log(`[action:${phase}] runNext receipt runId=${receipt.runId} kind=${receipt.kind}`)
  return receipt
}

async function apiRunTask(phase, taskId) {
  pushAction(phase, 'runTask', { taskId })
  log(`[action:${phase}] runTask(task=${taskId})`)
  const receipt = await currentPage.evaluate((id) => window.ndDshOrganization.runTask(id), taskId)
  if (!receipt) throw new Error(`Explicit runTask(${taskId}) returned no receipt`)
  log(`[action:${phase}] runTask receipt runId=${receipt.runId}`)
  return receipt
}

async function apiReviewTask(phase, taskId) {
  pushAction(phase, 'reviewTask', { taskId })
  log(`[action:${phase}] reviewTask(task=${taskId})`)
  const receipt = await currentPage.evaluate((id) => window.ndDshOrganization.reviewTask(id), taskId)
  if (!receipt) throw new Error(`Explicit reviewTask(${taskId}) returned no receipt`)
  return receipt
}

const find = (snap, id) => snap.projects.find((item) => item.id === id)
const projectTasks = (snap, projectId) => snap.tasks.filter((task) => task.projectId === projectId)
const projectRuns = (snap, projectId) => snap.runs.filter((run) => run.projectId === projectId)

function briefState(snap, projectIds) {
  const parts = []
  for (const id of projectIds) {
    const project = find(snap, id)
    if (!project) { parts.push(`${id}=MISSING`); continue }
    const statuses = {}
    for (const task of projectTasks(snap, id)) statuses[task.status] = (statuses[task.status] ?? 0) + 1
    const running = projectRuns(snap, id).filter((run) => run.status === 'running').map((run) => run.kind)
    parts.push(`${project.name}=${project.progress}%/${project.status} tasks=${JSON.stringify(statuses)} running=[${running.join(',')}]`)
  }
  const failures = snap.runs.filter((run) => run.status === 'failed').slice(-3)
    .map((run) => `${run.kind}#${run.id.slice(0, 8)}: ${String(run.error ?? '').slice(0, 220)}`)
  return `${parts.join(' | ')}${failures.length ? ` recentFailures=${JSON.stringify(failures)}` : ''}`
}

function assertNoProviderFailure(snap) {
  const authFailure = snap.runs.find((run) => run.status === 'failed'
    && /401|403|invalid_api_key|incorrect api key|unauthorized|missing api key|no api key/i.test(String(run.error ?? '')))
  if (authFailure) {
    failureClass = 'provider-auth'
    throw new FatalWaitError(`Provider authentication failure during ${authFailure.kind} run ${authFailure.id}: ${authFailure.error}`)
  }
}

// ── UI helpers ───────────────────────────────────────────────────────────────
async function navTo(title) {
  await currentPage.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle(title).click()
  await sleep(400)
}

async function createCompanyViaUi(company) {
  await navTo('Company')
  const newButton = currentPage.getByRole('button', { name: '+ New', exact: true }).first()
  if (await newButton.isVisible().catch(() => false)) await newButton.click()
  const dialog = currentPage.getByRole('dialog')
  const scope = await dialog.count() > 0 ? dialog : currentPage
  await scope.getByPlaceholder('Company name').fill(company.name)
  await scope.getByPlaceholder('Company mission').fill(company.mission)
  await scope.getByRole('button', { name: 'Create AI company' }).click()
  await waitUntil(`company "${company.name}" appears in state`, async () => {
    const snap = await state()
    const found = snap.companies.some((item) => item.name === company.name)
    return { done: found, detail: `companies=${snap.companies.map((item) => item.name).join(', ') || '(none)'}` }
  }, { timeoutMs: T.ui })
}

async function createProjectViaUi(app, company, project, workspacePath) {
  await navTo('Company')
  const form = currentPage.locator('form').filter({ has: currentPage.getByPlaceholder('New project') })
  await waitUntil(`project form visible for ${company.name}`, async () => ({
    done: await form.isVisible().catch(() => false),
    detail: 'project creation form not visible',
  }), { timeoutMs: T.ui })
  await form.getByPlaceholder('New project').fill(project.name)
  await form.getByPlaceholder('Objective').fill(project.objective)
  // Stub the native folder picker so Browse resolves to the throwaway repo.
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, workspacePath)
  const browse = form.getByRole('button', { name: 'Browse for workspace folder' })
  await browse.click()
  await waitUntil(`workspace folder shown for ${project.name}`, async () => {
    const text = (await browse.textContent().catch(() => ''))?.trim() ?? ''
    return { done: resolve(text) === resolve(workspacePath), detail: `browse shows "${text}"` }
  }, { timeoutMs: 15_000 })
  await form.getByRole('button', { name: 'Add project' }).click()
  await waitUntil(`project "${project.name}" appears in state`, async () => {
    const snap = await state()
    const found = snap.projects.find((item) => item.name === project.name)
    return {
      done: Boolean(found && found.companyId === snap.companies.find((c) => c.name === company.name)?.id),
      detail: `projects=${snap.projects.map((item) => item.name).join(', ')}`,
    }
  }, { timeoutMs: T.ui })
}

async function switchCompanyViaUi(companyName) {
  const combo = currentPage.getByRole('combobox', { name: 'Switch company' })
  await combo.click()
  const option = currentPage.getByRole('option', { name: companyName })
  const count = await option.count()
  if (count === 0) {
    await currentPage.keyboard.press('Escape')
    await sleep(300)
    return 'absent'
  }
  const disabled = await option.first().isDisabled().catch(() => false)
  if (disabled) {
    await currentPage.keyboard.press('Escape')
    await sleep(300)
    return 'disabled'
  }
  await option.first().click()
  await sleep(800)
  return 'clicked'
}

async function switchProjectViaUi(projectName) {
  const combo = currentPage.getByRole('combobox', { name: 'Switch project' })
  await combo.click()
  const option = currentPage.getByRole('option', { name: projectName })
  const count = await option.count()
  if (count === 0) {
    await currentPage.keyboard.press('Escape')
    await sleep(300)
    return 'absent'
  }
  const disabled = await option.first().isDisabled().catch(() => false)
  if (disabled) {
    await currentPage.keyboard.press('Escape')
    await sleep(300)
    return 'disabled'
  }
  await option.first().click()
  await sleep(800)
  return 'clicked'
}

/** Whether a switcher option is disabled after a refused attempt (UI refusal marker). */
async function switcherOptionDisabled(kind, name) {
  const label = kind === 'company' ? 'Switch company' : 'Switch project'
  const combo = currentPage.getByRole('combobox', { name: label })
  await combo.click()
  const option = currentPage.getByRole('option', { name })
  const count = await option.count()
  if (count === 0) {
    await currentPage.keyboard.press('Escape')
    await sleep(300)
    return 'absent'
  }
  const disabled = await option.first().isDisabled().catch(() => 'unknown')
  await currentPage.keyboard.press('Escape')
  await sleep(300)
  return disabled ? 'disabled' : 'enabled'
}

async function setAutonomyViaUi(level, label) {
  await navTo('Company')
  const scope = currentPage.locator('label[title="Autonomy level"]')
  await scope.getByRole('combobox').or(scope.locator('button')).first().click()
  await currentPage.getByRole('option', { name: `${level} ${label}` }).click()
  return waitUntil(`autonomy level = ${level}`, async () => {
    const snap = await state()
    const company = snap.companies.find((item) => item.id === snap.activeCompanyId)
    return { done: company?.autonomyLevel === level, detail: `active company ${company?.name ?? '?'} level=${company?.autonomyLevel}` }
  }, { timeoutMs: 30_000 })
}

async function clickAiPmPlan(projectId) {
  await navTo('Company')
  const button = currentPage.getByRole('button', { name: 'AI PM plan' })
  await waitUntil('AI PM plan button enabled', async () => ({
    done: await button.isEnabled().catch(() => false),
    detail: 'AI PM plan button not enabled',
  }), { timeoutMs: 30_000 })
  pushAction('setup', 'ui:AI PM plan', { projectId })
  await button.click()
  log(`[action:setup] clicked AI PM plan for project ${projectId}`)
}

async function clickRunNext(projectId) {
  await navTo('Company')
  const button = currentPage.getByRole('button', { name: 'Run next' })
  await waitUntil('Run next button enabled', async () => ({
    done: await button.isEnabled().catch(() => false),
    detail: 'Run next button not enabled',
  }), { timeoutMs: 30_000 })
  pushAction('start', 'ui:Run next', { projectId })
  await button.click()
  log(`[action:start] clicked Run next for active project ${projectId}`)
}

async function assertBoardScope(expectedProject, snap) {
  await navTo('Company')
  const workspaceButton = currentPage.getByRole('button', { name: 'Company Workspace', exact: true })
  if (await workspaceButton.count() > 0) await workspaceButton.click()
  await currentPage.getByRole('button', { name: 'Work', exact: true }).click()
  const ownTitles = projectTasks(snap, expectedProject.id).map((task) => task.title)
  const foreignTitles = [...new Set(snap.tasks
    .filter((task) => task.projectId !== expectedProject.id)
    .map((task) => task.title)
    .filter((title) => !ownTitles.includes(title)))]
  for (const title of ownTitles) {
    const visible = await currentPage.getByText(title, { exact: true }).first()
      .isVisible().catch(() => false)
    if (!visible) throw new Error(`Board scope: expected task "${title}" of ${expectedProject.name} not visible`)
  }
  for (const title of foreignTitles) {
    const count = await currentPage.getByText(title, { exact: true }).count()
    if (count > 0) throw new Error(`Board scope leak: foreign task "${title}" visible while ${expectedProject.name} is active`)
  }
  log(`board scope OK for ${expectedProject.name} (${ownTitles.length} own titles, ${foreignTitles.length} foreign titles checked)`)
}

async function openModelPickerAndSelect(modelId) {
  const trigger = currentPage.getByRole('button', { name: 'Model', exact: true })
    .or(currentPage.getByRole('button', { name: PROVIDER_NAME }))
    .or(currentPage.getByRole('button', { name: modelId }))
    .first()
  await trigger.click()
  const menu = currentPage.getByRole('menu', { name: 'Model controls' })
  await menu.waitFor({ state: 'visible', timeout: 15_000 })
  const row = menu.getByRole('menuitem', { name: /^Model/ })
  if (await row.count() > 0) await row.first().click()
  const item = currentPage.locator(`[role="menuitemradio"][title="${modelId}"]`)
    .or(menu.getByRole('menuitemradio').filter({ hasText: modelId }))
    .first()
  await item.waitFor({ state: 'visible', timeout: 15_000 })
  const checked = await item.getAttribute('aria-checked')
  await item.click()
  log(`[workbench] model picker selected ${modelId} (was aria-checked=${checked})`)
  await sleep(600)
  return checked === 'true'
}

async function sendChat(prompt) {
  const textarea = currentPage.getByPlaceholder('Ask the agent to work here — @ files/browser targets, / skills')
  await textarea.waitFor({ state: 'visible', timeout: 30_000 })
  await textarea.fill(prompt)
  const send = currentPage.locator('button[title="Send"]')
  await send.waitFor({ state: 'visible', timeout: 15_000 })
  await send.click()
}

async function waitForChatIdle(sessionLabel) {
  // A turn flips harness status to 'running' when the stream starts; observe
  // that at least once (bounded), then require consecutive idle polls so the
  // queued-but-not-yet-running window cannot satisfy the completion check.
  const observeStartedAt = Date.now()
  let sawRunning = false
  while (!sawRunning && Date.now() - observeStartedAt < 90_000) {
    const status = await currentPage.evaluate(() => window.ndDsh.harness.status()).catch(() => null)
    if (status?.state === 'running') sawRunning = true
    else await sleep(300)
  }
  let idleStreak = 0
  let lastSession = null
  await waitUntil(`workbench turn completes (${sessionLabel})`, async () => {
    const status = await currentPage.evaluate(() => window.ndDsh.harness.status()).catch(() => null)
    if (status?.sessionId) lastSession = status.sessionId
    const sendEnabled = await currentPage.locator('button[title="Send"]').isEnabled().catch(() => false)
    const idle = Boolean(status) && status.state !== 'running' && sendEnabled
    idleStreak = idle ? idleStreak + 1 : 0
    return {
      done: idleStreak >= 3,
      sig: `${status?.state}|${sendEnabled}`,
      detail: `harness state=${status?.state ?? '?'} sendEnabled=${sendEnabled} idleStreak=${idleStreak} sawRunning=${sawRunning}`,
    }
  }, { timeoutMs: T.chat, pollMs: 1_200, stallMs: T.chat })
  return lastSession
}

async function runWorkbenchTerminalCheck() {
  const created = await currentPage.evaluate(async () => {
    const api = window.ndDshTerminal
    const sessionId = `prod-e2e-${Date.now()}`
    const result = await api.create({ sessionId, title: 'Prod E2E terminal' })
    return { sessionId, terminalId: result.terminals[0]?.id ?? null }
  })
  if (!created.terminalId) throw new Error('Terminal was not created')
  const output = await currentPage.evaluate(async ({ sessionId, terminalId }) => {
    return await new Promise((resolve_) => {
      const api = window.ndDshTerminal
      let buffer = ''
      const done = () => { clearTimeout(timeout); off(); resolve_(buffer) }
      const timeout = setTimeout(done, 60_000)
      const off = api.onOutput((event) => {
        if (event.sessionId !== sessionId || event.terminalId !== terminalId) return
        buffer += event.data
        if (buffer.includes('ND_PROD_E2E_TESTS_OK')) done()
      })
      api.write(sessionId, terminalId, 'node --test && echo ND_PROD_E2E_TESTS_OK\r').catch(() => done())
    })
  }, created)
  await currentPage.evaluate(async ({ sessionId, terminalId }) => {
    await window.ndDshTerminal.close(sessionId, terminalId).catch(() => undefined)
  }, created).catch(() => undefined)
  const clean = stripAnsi(output)
  if (!clean.includes('ND_PROD_E2E_TESTS_OK')) {
    throw new Error(`Terminal node --test did not report success. Output tail: ${clean.slice(-800)}`)
  }
  log('[workbench] terminal: node --test passed (sentinel observed)')
  return clean.slice(-4_000)
}

// ── Phase A — fresh user, normal coding agent ────────────────────────────────
async function phaseA(workspaces) {
  log('── Phase A: fresh user / Codex-like workbench journey ──')

  // Provider + model availability: structured API and visible Settings surface.
  const providers = await currentPage.evaluate(() => window.ndDsh.providers.list())
  const seeded = providers.find((item) => item.id === PROVIDER_ID)
  if (!seeded?.enabled) throw new Error(`Seeded provider ${PROVIDER_ID} missing or disabled`)
  const seededModels = (seeded.models ?? []).map((model) => model.id)
  for (const modelId of MODELS) {
    if (!seededModels.includes(modelId)) throw new Error(`Configured model ${modelId} not present in seeded provider (got ${seededModels.join(', ')})`)
  }
  await navTo('Settings')
  await currentPage.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Models', exact: true }).click()
  await currentPage.getByRole('heading', { name: PROVIDER_NAME }).waitFor({ state: 'visible', timeout: 15_000 })
  const modelList = currentPage.getByText('Model list').locator('..').locator('span.font-mono')
  await modelList.first().waitFor({ state: 'visible', timeout: 15_000 })
  await evidence.screenshot(currentPage, '01-settings-models')
  log(`[phaseA] provider verified: ${PROVIDER_ID} models=[${seededModels.join(', ')}] (UI Settings checked)`)

  // Company + project through the visible creation surfaces.
  await createCompanyViaUi(TOPOLOGY.soloforge)
  await createProjectViaUi(currentApp, TOPOLOGY.soloforge, TOPOLOGY.notes, workspaces.notes)
  await evidence.screenshot(currentPage, '02-soloforge-created')

  let snap = await state()
  const notes = snap.projects.find((item) => item.name === TOPOLOGY.notes.name)
  const solo = snap.companies.find((item) => item.name === TOPOLOGY.soloforge.name)
  if (!notes || !solo) throw new Error('SoloForge / Notes Mini missing after creation')
  // Isolation starts here: nothing else may exist yet.
  if (snap.companies.length !== 1 || snap.projects.length !== 1) {
    throw new Error(`Unexpected pre-existing org state at Phase A start: ${snap.companies.length} companies / ${snap.projects.length} projects`)
  }
  const wsState = await currentPage.evaluate(() => window.ndDsh.workspace.state())
  if (resolve(wsState.root ?? '') !== resolve(workspaces.notes)) {
    throw new Error(`Active workspace is ${wsState.root}, expected ${workspaces.notes}`)
  }
  log(`[phaseA] workspace bound to Notes Mini: ${wsState.root}`)

  // Workbench journey on the visible Agent surface.
  await navTo('Agent')
  const statusBefore = await currentPage.evaluate(() => window.ndDsh.harness.status())
  if (statusBefore.provider !== PROVIDER_ID) throw new Error(`Workbench provider route is ${statusBefore.provider}, expected ${PROVIDER_ID}`)
  if (!MODELS.includes(statusBefore.model)) throw new Error(`Workbench default model ${statusBefore.model} is not one of the configured E2E models`)

  await sendChat(CHAT_PROMPT_1)
  const session1 = await waitForChatIdle('turn 1 — create formatter')
  await waitUntil('notes formatter artifacts exist after turn 1', async () => {
    const artifacts = listNewArtifacts(workspaces.notes)
    const hasFormatter = artifacts.some((name) => name.endsWith('.js') && name !== 'smoke.test.js')
    const hasTest = artifacts.some((name) => name.endsWith('.test.js') && name !== 'smoke.test.js')
    const frames = await sessionFrames(session1)
    const errors = frames.filter((frame) => frame.kind === 'agent-error' || frame.kind === 'stream-error')
    return {
      done: hasFormatter && hasTest,
      detail: `artifacts=[${artifacts.join(', ')}]${errors.length ? ` errors=${JSON.stringify(errors.slice(-2))}` : ''}`,
    }
  }, { timeoutMs: T.chat, stallMs: 5 * 60_000, pollMs: 2_000 })
  const artifacts = listNewArtifacts(workspaces.notes)
  const formatterFile = artifacts.find((name) => name.endsWith('.js') && !name.endsWith('.test.js') && name !== 'smoke.test.js')
  const testFile = artifacts.find((name) => name.endsWith('.test.js') && name !== 'smoke.test.js')
  const readme = readFileSync(join(workspaces.notes, 'README.md'), 'utf8')
  if (!readme.includes('notes-formatter: formatNote')) {
    throw new Error('README.md was not updated by the workbench turn (expected the usage line)')
  }
  log(`[phaseA] artifacts: ${formatterFile}, ${testFile}, README updated`)

  // Exercise the visible model picker on the live session, then one more turn
  // on the explicit E2E_MODEL_1 route.
  const alreadySelected = await openModelPickerAndSelect(M1)
  await sendChat(CHAT_PROMPT_2)
  await waitForChatIdle('turn 2 — verify tests on E2E_MODEL_1')
  const statusAfter = await currentPage.evaluate(() => window.ndDsh.harness.status())
  if (statusAfter.provider !== PROVIDER_ID || statusAfter.model !== M1) {
    throw new Error(`Workbench route after picker is ${statusAfter.provider}/${statusAfter.model}, expected ${PROVIDER_ID}/${M1}`)
  }

  // Explorer shows the real files.
  await navTo('Agent')
  await currentPage.getByRole('button', { name: 'Files' }).click()
  const explorerName = formatterFile ?? testFile
  await currentPage.getByText(explorerName, { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 15_000 })

  // Terminal runs the real test suite.
  const terminalOutput = await runWorkbenchTerminalCheck()

  // Source control reflects the change.
  await currentPage.evaluate(() => window.ndDsh.git.refresh().catch(() => undefined))
  await sleep(1_000)
  const gitStatus = gitOk(workspaces.notes, ['status', '--porcelain'])
  if (!gitStatus.stdout.trim()) throw new Error('git status is clean after the workbench change — no diff to review')
  const gitDiff = gitOk(workspaces.notes, ['diff', '--stat'])
  await currentPage.getByRole('button', { name: 'Source Control' }).click()
  await currentPage.getByPlaceholder('Commit message (Ctrl+Enter to commit)')
    .waitFor({ state: 'visible', timeout: 15_000 })
  await evidence.screenshot(currentPage, '03-notes-workbench-done')

  // No unrelated org state leaked in.
  snap = await state()
  if (snap.companies.length !== 1 || snap.projects.length !== 1) {
    throw new Error(`Phase A isolation: expected exactly SoloForge/Notes Mini, got ${snap.companies.length} companies / ${snap.projects.length} projects`)
  }

  phaseResults.phaseA = {
    status: 'pass',
    provider: statusAfter.provider,
    model: statusAfter.model,
    pickerAlreadySelected: alreadySelected,
    artifacts,
    terminalPassed: true,
    terminalOutputTail: terminalOutput.slice(-1_200),
    gitStatus: gitStatus.stdout.trim().split('\n'),
    gitDiffStat: gitDiff.stdout.trim() || '(empty — changes are untracked new files; Source Control panel lists them)',
    isolationAtEnd: { companies: snap.companies.length, projects: snap.projects.length },
  }
  evidence.writeJson('workbench.json', phaseResults.phaseA)
  log('── Phase A passed ──')
}

// ── Setup: SwiftCab (plans at level 2, then level 3) ────────────────────────
async function setupSwiftCab(workspaces) {
  log('── Setup: SwiftCab Labs with AI-PM-planned Dispatch + Driver ──')
  await mutate('setup', { type: 'company.create', name: TOPOLOGY.swift.name, mission: TOPOLOGY.swift.mission })
  let snap = await state()
  const company = snap.companies.find((item) => item.name === TOPOLOGY.swift.name)
  if (!company) throw new Error('SwiftCab Labs not created')
  const engineerRole = snap.roles.find((role) => role.companyId === company.id && /engineer/i.test(role.name))
  const pm = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'AI PM')
  const builder = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder')
  const reviewer = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Reviewer')
  if (!engineerRole || !pm || !builder || !reviewer) throw new Error('SwiftCab seeded workforce incomplete')

  await mutate('setup', { type: 'agent.update', id: pm.id, patch: { providerId: PROVIDER_ID, modelId: M2 } })
  await mutate('setup', { type: 'agent.update', id: builder.id, patch: { providerId: PROVIDER_ID, modelId: M1 } })
  await mutate('setup', { type: 'agent.update', id: reviewer.id, patch: { providerId: PROVIDER_ID, modelId: M3 } })
  const swiftEngineering = snap.teams.find((team) => team.companyId === company.id && /engineering/i.test(team.name))
  snap = await mutate('setup', {
    type: 'agent.create', companyId: company.id, name: 'Builder 2',
    roleId: engineerRole.id, ...(swiftEngineering ? { teamId: swiftEngineering.id } : {}),
    providerId: PROVIDER_ID, modelId: M2,
  })
  const swiftBuilder2Check = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder 2')
  if (!swiftBuilder2Check) throw new Error('SwiftCab Builder 2 not created')

  await mutate('setup', {
    type: 'project.create', companyId: company.id,
    name: TOPOLOGY.swift.dispatch.name, objective: TOPOLOGY.swift.dispatch.objective,
    workspacePath: workspaces.dispatch, testCommand: 'node --test',
  })
  await mutate('setup', {
    type: 'project.create', companyId: company.id,
    name: TOPOLOGY.swift.driver.name, objective: TOPOLOGY.swift.driver.objective,
    workspacePath: workspaces.driver, testCommand: 'node --test',
  })
  snap = await state()
  const dispatch = snap.projects.find((item) => item.name === TOPOLOGY.swift.dispatch.name)
  const driver = snap.projects.find((item) => item.name === TOPOLOGY.swift.driver.name)
  if (!dispatch || !driver) throw new Error('SwiftCab projects missing')

  // Plan Dispatch through the visible AI PM plan button, then Driver, both at
  // the default level 2 so plans cannot auto-start execution and the project
  // switcher stays usable between the two plans.
  await switchCompanyViaUi(TOPOLOGY.swift.name)
  await switchProjectViaUi(dispatch.name)
  await clickAiPmPlan(dispatch.id)
  await waitForPlan('Dispatch', dispatch.id, workspaces)
  await switchProjectViaUi(driver.name)
  await clickAiPmPlan(driver.id)
  await waitForPlan('Driver', driver.id, workspaces)

  // Level 3 via the visible Autonomy control (active company is SwiftCab).
  await setAutonomyViaUi(3, 'Workflow')

  // Explicit per-project builder routing: Dispatch -> MODEL_1, Driver -> MODEL_2.
  snap = await state()
  const swiftBuilder = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder')
  const swiftBuilder2 = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder 2')
  if (!swiftBuilder || !swiftBuilder2) throw new Error('SwiftCab builders missing before assignment pass')
  let reassigned = 0
  for (const task of projectTasks(snap, dispatch.id)) {
    if (task.assignedAgentId !== swiftBuilder.id) {
      await mutate('setup', { type: 'task.update', id: task.id, patch: { assignedAgentId: swiftBuilder.id } })
      reassigned += 1
    }
  }
  for (const task of projectTasks(snap, driver.id)) {
    if (task.assignedAgentId !== swiftBuilder2.id) {
      await mutate('setup', { type: 'task.update', id: task.id, patch: { assignedAgentId: swiftBuilder2.id } })
      reassigned += 1
    }
  }
  log(`[setup] explicit SwiftCab builder routing applied (${reassigned} task(s) re-bound before any run started)`)

  snap = await state()
  phaseResults.swiftSetup = {
    status: 'pass',
    autonomyLevel: 3,
    dispatchTasks: projectTasks(snap, dispatch.id).map((task) => ({ title: task.title, agent: 'Builder@' + M1 })),
    driverTasks: projectTasks(snap, driver.id).map((task) => ({ title: task.title, agent: 'Builder 2@' + M2 })),
    plansAppliedBeforeAnyExecution: true,
  }
  log('── SwiftCab setup passed ──')
  return { company, dispatch, driver }
}

async function waitForPlan(label, projectId, workspaces) {
  await waitUntil(`AI PM plan for ${label} completes`, async () => {
    const snap = await state()
    assertNoProviderFailure(snap)
    const runs = projectRuns(snap, projectId)
    const planRun = runs.filter((run) => run.kind === 'pm-plan').at(-1)
    if (!planRun) return { done: false, detail: 'no pm-plan run recorded yet' }
    if (planRun.status === 'failed') throw new FatalWaitError(`AI PM plan failed for ${label}: ${planRun.error}`)
    const goals = snap.goals.filter((goal) => goal.projectId === projectId)
    const tasks = projectTasks(snap, projectId)
    return {
      done: planRun.status === 'completed' && goals.length > 0 && tasks.length > 0,
      sig: `${planRun.status}|goals=${goals.length}|tasks=${tasks.length}`,
      detail: `plan=${planRun.status} goals=${goals.length} tasks=${tasks.length}`,
    }
  }, { timeoutMs: T.plan, stallMs: 8 * 60_000, pollMs: 2_000 })

  // Level-2 hold-back proof: a completed plan must not leak into execution.
  await sleep(3_000)
  const snap = await state()
  const execs = projectRuns(snap, projectId).filter((run) => run.kind === 'task-execution')
  const running = snap.runs.filter((run) => run.status === 'running')
  if (execs.length > 0 || running.length > 0) {
    throw new Error(`Level-2 hold-back violated for ${label}: ${execs.length} execution run(s), ${running.length} running run(s) after planning`)
  }
  const statuses = [...new Set(projectTasks(snap, projectId).map((task) => task.status))]
  log(`[setup] ${label} plan confirmed: ${projectTasks(snap, projectId).length} tasks (${statuses.join(',')}), no execution started at level 2`)
}

// ── Setup: TinyCart (level 4 target, explicit parallel tasks) ───────────────
async function setupTinyCart(workspaces) {
  log('── Setup: TinyCart Studio with Catalog (2 tasks / 2 workers) + Checkout ──')
  await mutate('setup', { type: 'company.create', name: TOPOLOGY.tinycart.name, mission: TOPOLOGY.tinycart.mission })
  let snap = await state()
  const company = snap.companies.find((item) => item.name === TOPOLOGY.tinycart.name)
  if (!company) throw new Error('TinyCart Studio not created')
  const engineerRole = snap.roles.find((role) => role.companyId === company.id && /engineer/i.test(role.name))
  const engineeringTeam = snap.teams.find((team) => team.companyId === company.id && /engineering/i.test(team.name))
  const pm = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'AI PM')
  const builder = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder')
  const reviewer = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Reviewer')
  if (!engineerRole || !pm || !builder || !reviewer) throw new Error('TinyCart seeded workforce incomplete')

  // Routing per plan: Builder -> MODEL_3, Builder 2 -> MODEL_1, Reviewer -> MODEL_2.
  await mutate('setup', { type: 'agent.update', id: builder.id, patch: { providerId: PROVIDER_ID, modelId: M3 } })
  await mutate('setup', { type: 'agent.update', id: reviewer.id, patch: { providerId: PROVIDER_ID, modelId: M2 } })
  await mutate('setup', { type: 'agent.update', id: pm.id, patch: { providerId: PROVIDER_ID, modelId: M2 } })
  snap = await mutate('setup', {
    type: 'agent.create', companyId: company.id, name: 'Builder 2',
    roleId: engineerRole.id, ...(engineeringTeam ? { teamId: engineeringTeam.id } : {}),
    providerId: PROVIDER_ID, modelId: M1,
  })
  const builder2 = snap.agents.find((agent) => agent.companyId === company.id && agent.name === 'Builder 2')
  if (!builder2) throw new Error('TinyCart Builder 2 not created')

  snap = await mutate('setup', {
    type: 'project.create', companyId: company.id,
    name: TOPOLOGY.tinycart.catalog.name, objective: TOPOLOGY.tinycart.catalog.objective,
    workspacePath: workspaces.catalog, testCommand: 'node --test',
  })
  const catalogProjectId = snap.projects.find((item) => item.name === TOPOLOGY.tinycart.catalog.name)?.id
  if (!catalogProjectId) throw new Error('Catalog Mini not created')
  snap = await mutate('setup', {
    type: 'goal.create', companyId: company.id,
    projectId: catalogProjectId,
    title: 'Two independent catalog utilities',
    description: 'Ship the catalog-item formatter and the inventory-count formatter as independent, parallel-safe tasks.',
  })
  const catalog = snap.projects.find((item) => item.name === TOPOLOGY.tinycart.catalog.name)
  snap = await mutate('setup', {
    type: 'task.create', companyId: company.id, projectId: catalog.id, assignedAgentId: builder.id,
    title: CATALOG_TASK_A.title, description: CATALOG_TASK_A.description, acceptanceCriteria: CATALOG_TASK_A.criteria,
  })
  snap = await mutate('setup', {
    type: 'task.create', companyId: company.id, projectId: catalog.id, assignedAgentId: builder2.id,
    title: CATALOG_TASK_B.title, description: CATALOG_TASK_B.description, acceptanceCriteria: CATALOG_TASK_B.criteria,
  })

  await mutate('setup', {
    type: 'project.create', companyId: company.id,
    name: TOPOLOGY.tinycart.checkout.name, objective: TOPOLOGY.tinycart.checkout.objective,
    workspacePath: workspaces.checkout, testCommand: 'node --test',
  })
  snap = await state()
  const checkout = snap.projects.find((item) => item.name === TOPOLOGY.tinycart.checkout.name)
  snap = await mutate('setup', {
    type: 'goal.create', companyId: company.id, projectId: checkout.id,
    title: 'Tiny checkout formatter', description: 'One formatter plus one test, nothing more.',
  })
  await mutate('setup', {
    type: 'task.create', companyId: company.id, projectId: checkout.id, assignedAgentId: builder.id,
    title: CHECKOUT_TASK.title, description: CHECKOUT_TASK.description, acceptanceCriteria: CHECKOUT_TASK.criteria,
  })

  // Forged cross-company ownership probes (must be rejected at the store).
  await runForgedOwnershipProbes(company)

  // TinyCart stays at level 2 until the pipelines are already running; raising
  // it to 4 later is what autostarts TinyCart work during live SwiftCab work.
  phaseResults.tinySetup = {
    status: 'pass',
    catalogTasks: [CATALOG_TASK_A.title, CATALOG_TASK_B.title],
    workers: { builder: `Builder@${M3}`, builder2: `Builder 2@${M1}`, reviewer: `Reviewer@${M2}` },
    autonomyRaisedTo4DuringLiveWork: 'deferred to start phase',
  }
  log('── TinyCart setup passed ──')
  return { company, catalog, checkout, builder, builder2 }
}

async function runForgedOwnershipProbes(tinyCompany) {
  let snap = await state()
  const swift = snap.companies.find((item) => item.name === TOPOLOGY.swift.name)
  const catalog = snap.projects.find((item) => item.name === TOPOLOGY.tinycart.catalog.name)
  const swiftAgent = snap.agents.find((agent) => agent.companyId === swift.id && agent.name === 'Builder')

  const wrongProject = await currentPage.evaluate(async ({ companyId, projectId }) => {
    try {
      await window.ndDshOrganization.mutate({
        type: 'task.create', companyId, projectId,
        title: 'FORGED cross-company task', description: 'This must never be accepted.',
      })
      return { accepted: true, error: '' }
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, { companyId: swift.id, projectId: catalog.id })

  const wrongAgent = await currentPage.evaluate(async ({ companyId, projectId, assignedAgentId }) => {
    try {
      await window.ndDshOrganization.mutate({
        type: 'task.create', companyId, projectId,
        title: 'FORGED cross-company agent', description: 'This must never be accepted.',
        assignedAgentId,
      })
      return { accepted: true, error: '' }
    } catch (error) {
      return { accepted: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, { companyId: tinyCompany.id, projectId: catalog.id, assignedAgentId: swiftAgent.id })

  snap = await state()
  const stray = snap.tasks.filter((task) => task.title.startsWith('FORGED'))
  const result = {
    wrongProjectRejected: !wrongProject.accepted && wrongProject.error.includes('Project does not belong to company'),
    wrongAgentRejected: !wrongAgent.accepted && wrongAgent.error.includes('Assigned agent crosses company boundary'),
    wrongProjectError: wrongProject.error,
    wrongAgentError: wrongAgent.error,
    strayTasks: stray.length,
  }
  if (!result.wrongProjectRejected || !result.wrongAgentRejected || stray.length > 0) {
    throw new Error(`Forged cross-company probes were not rejected cleanly: ${JSON.stringify(result)}`)
  }
  guardProbes.push({ phase: 'setup', kind: 'forged-ownership', ...result })
  log('[setup] forged cross-company ownership probes rejected at the store boundary')
}

// ── Start: all four pipelines, then guard probes while live ─────────────────
async function startPipelines(ctx) {
  log('── Start: Dispatch (UI Run next) → Driver → TinyCart@4 autostart → Checkout ──')
  const { dispatch, driver, tiny } = ctx

  // Switch to SwiftCab / Dispatch through the visible switchers while quiet.
  await switchCompanyViaUi(TOPOLOGY.swift.name)
  let snap = await state()
  if (snap.activeProjectId !== dispatch.id) await switchProjectViaUi(dispatch.name)
  snap = await state()
  const activeCompany = snap.companies.find((item) => item.id === snap.activeCompanyId)
  if (activeCompany?.name !== TOPOLOGY.swift.name || snap.activeProjectId !== dispatch.id) {
    throw new Error(`Could not focus SwiftCab / Dispatch before start (active=${activeCompany?.name}/${snap.activeProjectId})`)
  }

  // 1. Explicit level-3 start through the visible "Run next" button.
  await clickRunNext(dispatch.id)
  await waitForExecutionRunning('Dispatch', dispatch.id)

  // 2. Second project of the same company — same explicit IPC, no activation
  //    (the product refuses context switches during active runs; runNext takes
  //    the project id exactly like the button does).
  await apiRunNext('start', driver.id)
  await waitForExecutionRunning('Driver', driver.id)

  // 3. Raise TinyCart to 4 while SwiftCab work is live. The product's own
  //    autopilot rule (company -> level 4) autostarts an incomplete TinyCart
  //    project; we still dispatch explicitly so the start never depends on it.
  await mutate('start', { type: 'company.update', id: tiny.company.id, patch: { autonomyLevel: 4 } })
  await waitUntil('TinyCart level-4 autostart or explicit dispatch brings Catalog up', async () => {
    const current = await state()
    const running = current.runs.filter((run) => run.status === 'running' && run.kind === 'task-execution' && run.projectId === tiny.catalog.id)
    return { done: running.length > 0, detail: `catalog running executions=${running.length}` }
  }, { timeoutMs: T.start, pollMs: 1_000 })
  // Explicit ensure (idempotent: returns the already-running receipt or starts
  // whatever ready work the autostart round did not reach). Scripted
  // unconditionally — never conditional on observed failure.
  await apiRunNext('start', tiny.catalog.id)
  await waitUntil('Catalog runs both independent tasks in parallel', async () => {
    const current = await state()
    const running = current.runs.filter((run) => run.status === 'running' && run.kind === 'task-execution' && run.projectId === tiny.catalog.id)
    return { done: running.length >= 2, detail: `catalog parallel executions=${running.length}` }
  }, { timeoutMs: 90_000, pollMs: 1_000 })

  // 4. Checkout joins while everything else is live.
  await apiRunNext('start', tiny.checkout.id)
  await waitForExecutionRunning('Checkout', tiny.checkout.id)

  snap = await state()
  const live = snap.runs.filter((run) => run.status === 'running' && run.kind === 'task-execution')
  log(`[start] live task executions: ${live.length} across projects=${[...new Set(live.map((run) => run.projectId))].length} companies=${[...new Set(live.map((run) => run.companyId))].length}`)
  await evidence.screenshot(currentPage, '06-pipelines-running')

  // Phase C guard evidence: a real switch attempt during live work is refused
  // by the product; TinyCart work is started without needing that switch.
  await attemptSwitchDuringRuns('C', { company: TOPOLOGY.tinycart.name, project: TOPOLOGY.tinycart.catalog.name })
  phaseResults.start = {
    status: 'pass',
    liveExecutionsAfterStart: live.length,
    liveCrossCompanyObservedLive: Boolean(liveCrossCompanyAt),
    note: 'TinyCart company record was created during quiet setup because company.create is refused while any run is active (recorded guard evidence); TinyCart work itself autostarts via the level-4 rule during live SwiftCab work.',
  }
  log('── Start phase passed ──')
}

async function waitForExecutionRunning(label, projectId) {
  await waitUntil(`${label} task execution is running`, async () => {
    const snap = await state()
    assertNoProviderFailure(snap)
    const running = projectRuns(snap, projectId).filter((run) => run.status === 'running' && run.kind === 'task-execution')
    const failed = projectRuns(snap, projectId).filter((run) => run.status === 'failed')
    if (!running.length && failed.length) {
      throw new FatalWaitError(`${label} dispatch failed: ${failed.at(-1).kind} — ${failed.at(-1).error}`)
    }
    return { done: running.length > 0, detail: `${label} running executions=${running.length} failed=${failed.length}` }
  }, { timeoutMs: T.start, pollMs: 1_000 })
}

// ── Phase E — switch attempts + navigation while runs are live ──────────────
async function attemptSwitchDuringRuns(phase, target) {
  const before = await state()
  const activeBefore = { companyId: before.activeCompanyId, projectId: before.activeProjectId }
  const runningBefore = before.runs.filter((run) => run.status === 'running')
  const workspacesBefore = Object.fromEntries(runningBefore.map((run) => [run.taskId, { root: run.workspaceRoot, branch: run.workspaceBranch }]))

  let companySwitch = null
  if (target.company) {
    const companyBefore = activeBefore.companyId
    await switchCompanyViaUi(target.company)
    const mid = await state()
    const companyChanged = mid.activeCompanyId !== companyBefore
    companySwitch = {
      targetCompany: target.company,
      refused: !companyChanged,
      activeCompanyUnchanged: !companyChanged,
      refusalMarkedInUi: companyChanged ? null : await switcherOptionDisabled('company', target.company).catch(() => 'unknown'),
    }
  }
  let projectSwitch = null
  if (target.project) {
    const projectBefore = (await state()).activeProjectId
    await switchProjectViaUi(target.project)
    const mid = await state()
    const projectChanged = mid.activeProjectId !== projectBefore
    projectSwitch = {
      targetProject: target.project,
      refused: !projectChanged,
      activeProjectUnchanged: !projectChanged,
      ...(projectChanged ? {} : { refusalMarkedInUi: await switcherOptionDisabled('project', target.project).catch(() => 'unknown') }),
    }
  }

  await sleep(1_500)
  const after = await state()
  const activeAfter = { companyId: after.activeCompanyId, projectId: after.activeProjectId }
  const stillTracked = runningBefore.filter((run) => runTimeline.get(run.id)?.status === 'running'
    || after.runs.find((item) => item.id === run.id)?.status === 'running')
  const workspaceMismatches = []
  for (const run of stillTracked) {
    const now = after.runs.find((item) => item.id === run.id)
    if (!now) continue
    const beforeRow = workspacesBefore[run.taskId]
    if (beforeRow && (now.workspaceRoot !== beforeRow.root || now.workspaceBranch !== beforeRow.branch)) {
      workspaceMismatches.push({ runId: run.id, before: beforeRow, after: { root: now.workspaceRoot, branch: now.workspaceBranch } })
    }
  }
  const transitionedToFailed = runningBefore
    .map((run) => ({ run, now: after.runs.find((item) => item.id === run.id) }))
    .filter((row) => row.now && row.now.status === 'failed' && !/Interrupted:/.test(String(row.now.error ?? '')))
    .map((row) => ({ runId: row.run.id, error: row.now.error }))

  const probe = {
    phase,
    target,
    activeBefore,
    activeAfter,
    activeContextUnchanged: JSON.stringify(activeBefore) === JSON.stringify(activeAfter),
    companySwitch,
    projectSwitch,
    runningTaskWorkspacesUnchanged: workspaceMismatches.length === 0,
    workspaceMismatches,
    backgroundRunsFailedDuringSwitch: transitionedToFailed,
    runningRunsTracked: stillTracked.length,
  }
  guardProbes.push({ kind: 'switch-attempt', ...probe })
  if (workspaceMismatches.length) throw new Error(`Switch attempt redirected a running task workspace: ${JSON.stringify(workspaceMismatches)}`)
  if (transitionedToFailed.length) throw new Error(`Switch attempt failed running work: ${JSON.stringify(transitionedToFailed)}`)
  log(`[phaseE/${phase}] switch attempt ${JSON.stringify({ company: companySwitch, project: projectSwitch, activeUnchanged: probe.activeContextUnchanged, running: stillTracked.length })}`)
  return probe
}

async function phaseE(ctx) {
  log('── Phase E: switch/navigate while workers run ──')
  const { dispatch, tiny } = ctx
  const snap0 = await state()
  const activeProject = find(snap0, snap0.activeProjectId)
  if (!activeProject || activeProject.id !== dispatch.id) {
    throw new Error(`Phase E expected active project Dispatch, got ${activeProject?.name ?? 'none'}`)
  }

  // Current scope is visible and correctly scoped.
  await assertBoardScope(dispatch, snap0)
  guardProbes.push({ phase: 'E', kind: 'current-scope', project: dispatch.name, scoped: true })

  const attempts = [
    { company: TOPOLOGY.tinycart.name, project: TOPOLOGY.tinycart.catalog.name },
    { company: TOPOLOGY.soloforge.name, project: TOPOLOGY.soloforge.notes.name },
    { project: TOPOLOGY.swift.driver.name },
    { company: TOPOLOGY.tinycart.name, project: TOPOLOGY.tinycart.checkout.name },
  ]
  const results = []
  for (const [index, target] of attempts.entries()) {
    results.push(await attemptSwitchDuringRuns(`E${index + 1}`, target))
    // Background work continues: board remains Dispatch-scoped after each try.
    const snap = await state()
    await assertBoardScope(dispatch, snap)
  }

  // Memory surface for the active scope (visible where exposed).
  await navTo('Company')
  const memoryButton = currentPage.getByRole('button', { name: 'Memory & Policies', exact: true })
  if (await memoryButton.count() > 0) {
    await memoryButton.click()
    await sleep(500)
  } else {
    log('[phaseE] Memory & Policies section not exposed in this build; recorded as not-visible')
  }

  // Surface navigation while runs continue.
  await navTo('Agent')
  const composerVisible = await currentPage.getByPlaceholder('Ask the agent to work here — @ files/browser targets, / skills')
    .isVisible().catch(() => false)
  if (!composerVisible) throw new Error('Agent composer not visible during background navigation')
  await navTo('Settings')
  await currentPage.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Models', exact: true }).click()
  await currentPage.getByRole('heading', { name: PROVIDER_NAME }).waitFor({ state: 'visible', timeout: 15_000 })
  await navTo('Company')
  await currentPage.getByRole('button', { name: 'Work', exact: true }).click()
  const snapNav = await state()
  await assertBoardScope(dispatch, snapNav)
  await evidence.screenshot(currentPage, '07-phase-e-switches')

  phaseResults.phaseE = {
    status: 'pass',
    attempts: results.map((row) => ({
      target: row.target,
      refused: row.companySwitch?.refused ?? row.projectSwitch?.refused ?? false,
      activeContextUnchanged: row.activeContextUnchanged,
      runningTaskWorkspacesUnchanged: row.runningTaskWorkspacesUnchanged,
      refusalMarkedInUi: row.companySwitch?.refusalMarkedInUi ?? row.projectSwitch?.refusalMarkedInUi ?? null,
    })),
    surfaceNavigation: { composerVisible: true, settingsModelHeadingVisible: true, boardStillScoped: true },
    note: 'ND refuses company/project context switches while any organization run is active (fail-closed guard); the refusal itself is the workspace-redirection protection and is asserted per attempt, together with unchanged running-task workspaces and continued background execution.',
  }
  log('── Phase E passed ──')
}

// ── Deliveries: monitor all pipelines to completion (Phases B/C/D) ──────────
async function waitForDeliveries(ctx) {
  log('── Deliveries: waiting for all four pipelines at 100% ──')
  const ids = [ctx.dispatch.id, ctx.driver.id, ctx.tiny.catalog.id, ctx.tiny.checkout.id]
  await waitUntil('all organization projects reach 100%', async () => {
    const snap = await state()
    assertNoProviderFailure(snap)
    const detail = briefState(snap, ids)
    const done = ids.every((id) => {
      const project = find(snap, id)
      return project && project.progress === 100 && project.status === 'completed'
    })
    return { done, sig: detail, detail }
  }, { timeoutMs: T.deliveries, stallMs: T.stall, pollMs: 3_000 })

  const final = await state()
  const blocked = final.tasks.filter((task) => ids.includes(task.projectId) && task.status === 'blocked')
  if (blocked.length) {
    throw new FatalWaitError(`Unexpected blocked task(s) after delivery: ${blocked.map((task) => `${task.title}(${task.reviewSummary ?? ''})`).join('; ').slice(0, 600)}`)
  }
  const failedRuns = final.runs.filter((run) => ids.includes(run.projectId) && run.status === 'failed')
  const unexpectedFailures = failedRuns.filter((run) => !/Interrupted:/.test(String(run.error ?? '')))
  if (unexpectedFailures.length) {
    failureClass = failureClass ?? classifyFailure(unexpectedFailures.at(-1).error)
    throw new FatalWaitError(`Failed organization run(s) after delivery: ${unexpectedFailures.map((run) => `${run.kind}:${String(run.error ?? '').slice(0, 200)}`).join(' | ')}`)
  }
  await evidence.screenshot(currentPage, '08-delivery-complete')
  log('── Deliveries complete: all four pipelines at 100% ──')
  return final
}

// ── Phase F — restart during active execution ───────────────────────────────
async function phaseF(ctx) {
  log('── Phase F: restart/recovery during an active execution ──')
  await waitUntil('all runs quiesce before the restart leg', async () => {
    const snap = await state()
    const running = snap.runs.filter((run) => run.status === 'running')
    return { done: running.length === 0, detail: `running=${running.map((run) => run.kind).join(',') || '(none)'}` }
  }, { timeoutMs: T.quiesce, pollMs: 1_500 })

  const preRestart = await state()
  const activeBeforeQuit = { companyId: preRestart.activeCompanyId, projectId: preRestart.activeProjectId }
  const completedBefore = preRestart.tasks.filter((task) => task.status === 'completed').map((task) => task.id).sort()
  const tinyBuilder = preRestart.agents.find((agent) => agent.companyId === ctx.tiny.company.id && agent.name === 'Builder')
    ?? preRestart.agents.find((agent) => agent.companyId === ctx.tiny.company.id && agent.name === 'Builder 2')

  // A real user adds one more tiny task and starts it — that run is the one
  // interrupted by the quit.
  let snap = await mutate('F', {
    type: 'task.create', companyId: ctx.tiny.company.id, projectId: ctx.tiny.checkout.id,
    ...(tinyBuilder ? { assignedAgentId: tinyBuilder.id } : {}),
    title: PHASE_F_VICTIM.title, description: PHASE_F_VICTIM.description, acceptanceCriteria: PHASE_F_VICTIM.criteria,
  })
  const victim = snap.tasks.find((task) => task.title === PHASE_F_VICTIM.title)
  if (!victim) throw new Error('Phase F victim task not created')
  await apiRunNext('F', ctx.tiny.checkout.id)
  await waitUntil('victim execution is actively running', async () => {
    const current = await state()
    const task = current.tasks.find((item) => item.id === victim.id)
    const run = current.runs.filter((item) => item.taskId === victim.id && item.kind === 'task-execution' && item.status === 'running').at(-1)
    return {
      done: Boolean(task?.status === 'in_progress' && run?.workspaceRoot),
      detail: `task=${task?.status} run=${run ? 'running' : 'none'}`,
    }
  }, { timeoutMs: 120_000, pollMs: 800 })

  let snapNow = await state()
  const victimRun = snapNow.runs.filter((item) => item.taskId === victim.id && item.kind === 'task-execution' && item.status === 'running').at(-1)
  const victimWorktree = {
    workspaceRoot: victimRun.workspaceRoot,
    branch: victimRun.workspaceBranch,
    baselineCommit: victimRun.baselineCommit ?? null,
    rootExists: existsSync(victimRun.workspaceRoot),
    branchExists: gitOk(ctx.tiny.checkout.workspacePath, ['rev-parse', '--verify', victimRun.workspaceBranch]).ok,
    baseCleanBefore: gitOk(ctx.tiny.checkout.workspacePath, ['status', '--porcelain']).stdout.trim() === '',
    baseHeadBefore: gitOk(ctx.tiny.checkout.workspacePath, ['rev-parse', 'HEAD']).stdout.trim(),
  }
  log(`[phaseF] interrupting execution: task=${victim.title} workspace=${victimWorktree.workspaceRoot} branch=${victimWorktree.branch}`)
  await evidence.screenshot(currentPage, '09-before-restart')

  // Close Electron with the run live, then relaunch on the SAME profile.
  await closeApp()
  await sleep(2_000)
  await launchApp(userDataDir)

  const after = await state()
  const expectedCompanyNames = [TOPOLOGY.soloforge.name, TOPOLOGY.swift.name, TOPOLOGY.tinycart.name].sort()
  const actualCompanyNames = after.companies.map((item) => item.name).sort()
  const expectedProjectNames = [
    TOPOLOGY.soloforge.notes.name, TOPOLOGY.swift.dispatch.name, TOPOLOGY.swift.driver.name,
    TOPOLOGY.tinycart.catalog.name, TOPOLOGY.tinycart.checkout.name,
  ].sort()
  const actualProjectNames = after.projects.map((item) => item.name).sort()

  const victimRunAfter = after.runs.find((item) => item.id === victimRun.id)
  const victimTaskAfter = after.tasks.find((item) => item.id === victim.id)
  const victimAgentAfter = after.agents.find((item) => item.id === tinyBuilder?.id)
  const completedAfter = after.tasks.filter((task) => task.status === 'completed').map((task) => task.id).sort()
  const activeCompanyAfter = after.companies.find((item) => item.id === after.activeCompanyId)
  const interruptedActivity = after.activity.filter((item) => item.type === 'run.interrupted')

  const checks = {
    companiesRestored: JSON.stringify(actualCompanyNames) === JSON.stringify(expectedCompanyNames),
    projectsRestored: JSON.stringify(actualProjectNames) === JSON.stringify(expectedProjectNames),
    activeContextRestored: after.activeCompanyId === activeBeforeQuit.companyId && after.activeProjectId === activeBeforeQuit.projectId,
    interruptedRunMarkedFailed: victimRunAfter?.status === 'failed' && /^Interrupted:/.test(String(victimRunAfter?.error ?? '')),
    interruptedTaskBlocked: victimTaskAfter?.status === 'blocked' && String(victimTaskAfter?.reviewSummary ?? '').includes('Execution interrupted:'),
    workerReleased: !victimAgentAfter || ['idle', 'blocked', 'offline'].includes(victimAgentAfter.status),
    completedTasksPreserved: JSON.stringify(completedAfter) === JSON.stringify(completedBefore),
    noFalseCompletion: !completedAfter.includes(victim.id) && victimTaskAfter?.status !== 'completed',
    worktreePreserved: existsSync(victimWorktree.workspaceRoot),
    branchPreserved: gitOk(ctx.tiny.checkout.workspacePath, ['rev-parse', '--verify', victimWorktree.branch]).ok,
    baseCheckoutClean: gitOk(ctx.tiny.checkout.workspacePath, ['status', '--porcelain']).stdout.trim() === '',
    baseHeadUnchanged: gitOk(ctx.tiny.checkout.workspacePath, ['rev-parse', 'HEAD']).stdout.trim() === victimWorktree.baseHeadBefore,
    interruptedActivityRecorded: interruptedActivity.length > 0,
    unrelatedProjectsUnaffected: [ctx.dispatch.id, ctx.driver.id, ctx.tiny.catalog.id].every((id) => {
      const project = after.projects.find((item) => item.id === id)
      return project && project.status === 'completed' && project.progress === 100
    }),
  }
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
  evidence.writeJson('restart.json', { checks, victimTaskId: victim.id, victimRunId: victimRun.id, victimWorktree, interruptedRunError: victimRunAfter?.error, interruptedActivity: interruptedActivity.slice(0, 5) })
  await evidence.screenshot(currentPage, '10-after-restart')
  if (failedChecks.length) {
    throw new Error(`Restart recovery checks failed: ${failedChecks.join(', ')} (see restart.json)`)
  }
  log(`[phaseF] restart recovery verified: ${Object.keys(checks).length}/${Object.keys(checks).length} checks pass`)

  // Retry/continue the interrupted task through ND — the scenario's one
  // scripted state-conditional retry.
  await apiRunTask('F', victim.id)
  await waitUntil('interrupted task completes after explicit retry', async () => {
    const current = await state()
    assertNoProviderFailure(current)
    const task = current.tasks.find((item) => item.id === victim.id)
    const detail = `status=${task?.status} integration=${task?.integrationState ?? '-'} summary=${String(task?.reviewSummary ?? '').slice(0, 160)}`
    if (task?.status === 'blocked') throw new FatalWaitError(`Retried task blocked again: ${detail}`)
    return { done: task?.status === 'completed' && task?.integrationState === 'integrated', sig: detail, detail }
  }, { timeoutMs: T.retry, stallMs: 10 * 60_000, pollMs: 2_000 })

  await waitUntil('Checkout Mini reaches 100% after recovery', async () => {
    const current = await state()
    const project = find(current, ctx.tiny.checkout.id)
    return { done: project?.progress === 100 && project?.status === 'completed', detail: `checkout=${project?.progress}%/${project?.status}` }
  }, { timeoutMs: 120_000, pollMs: 1_500 })

  const victimArtifact = listNewArtifacts(ctx.tiny.checkout.workspacePath)
  if (!victimArtifact.includes('checkout-tax.js')) {
    throw new Error(`Integrated base repo is missing checkout-tax.js after recovery (files: ${victimArtifact.join(', ')})`)
  }

  phaseResults.phaseF = {
    status: 'pass',
    checks,
    interruptedRunError: victimRunAfter?.error,
    reviewInterruptionSemantics: 'not exercised in this run (the quit landed during execution; the review-interruption branch is covered by reconcileInterruptedRuns code path but no review was active at quit)',
    retriedToCompletion: true,
  }
  log('── Phase F passed ──')
  return { victimTaskId: victim.id }
}

// ── Optional local engine compatibility probe (never gates the core matrix) ─
async function engineCompatibilityProbe(ctx) {
  log('── Optional engine compatibility probe (codex) ──')
  const result = { engineId: null, status: 'skipped', reason: null, evidence: {} }
  try {
    const engines = await currentPage.evaluate(() => window.ndDsh.engines.list())
    const codex = engines.find((item) => item.id === 'codex-cli' && item.available)
      ?? engines.find((item) => /codex/i.test(item.id) && item.available)
    result.availableEngines = engines.map((item) => ({ id: item.id, available: item.available, unavailableReason: item.unavailableReason ?? null }))
    if (!codex) {
      result.status = 'skipped'
      result.reason = 'No installed/authenticated Codex engine available locally; core .env.e2e matrix is engine-neutral by design.'
      evidence.writeJson('engine-compat.json', result)
      log(`[engine] skipped: ${result.reason}`)
      return result
    }
    result.engineId = codex.id

    const snap = await state()
    const solo = snap.companies.find((item) => item.name === TOPOLOGY.soloforge.name)
    const notes = snap.projects.find((item) => item.name === TOPOLOGY.soloforge.notes.name)
    const builder = snap.agents.find((agent) => agent.companyId === solo.id && agent.name === 'Builder')
    await currentPage.evaluate(({ agentId, engineId }) => window.ndDsh.engines.assign(agentId, engineId), { agentId: builder.id, engineId: codex.id })
    pushAction('engine', 'engines.assign', { agentId: builder.id, engineId: codex.id })

    let current = await mutate('engine', {
      type: 'task.create', companyId: solo.id, projectId: notes.id, assignedAgentId: builder.id,
      title: 'Create engine-boundary smoke file',
      description: `Create engine-smoke.txt containing exactly ENGINE_BOUNDARY_OK (${codex.id}). No other changes.`,
      acceptanceCriteria: ['engine-smoke.txt exists with ENGINE_BOUNDARY_OK'],
    })
    const task = current.tasks.find((item) => item.title === 'Create engine-boundary smoke file')
    await apiRunTask('engine', task.id)

    await waitUntil('engine-routed execution records engine receipt', async () => {
      const current2 = await state()
      const run = current2.runs.filter((item) => item.taskId === task.id && item.kind === 'task-execution').at(-1)
      if (!run) return { done: false, detail: 'no execution run yet' }
      if (run.status === 'failed') {
        result.status = 'failed'
        result.reason = run.error
        throw new FatalWaitError(`Engine execution failed: ${run.error}`)
      }
      return {
        done: run.status === 'completed' && Boolean(run.checkpointCommit) && Boolean(run.workspaceRoot),
        detail: `status=${run.status} engine=${run.engineId} checkpoint=${run.checkpointCommit ?? '-'}`,
      }
    }, { timeoutMs: 12 * 60_000, stallMs: 6 * 60_000, pollMs: 2_000 })

    const snapExec = await state()
    const execRun = snapExec.runs.filter((item) => item.taskId === task.id && item.kind === 'task-execution').at(-1)
    result.evidence.execution = { engineId: execRun.engineId, checkpoint: execRun.checkpointCommit, workspaceRoot: execRun.workspaceRoot, status: execRun.status }
    if (execRun.engineId !== codex.id) {
      result.status = 'failed'
      result.reason = `Expected engine ${codex.id}, receipt shows ${execRun.engineId}`
      evidence.writeJson('engine-compat.json', result)
      return result
    }

    await apiReviewTask('engine', task.id)
    await waitUntil('engine task review integrates', async () => {
      const current2 = await state()
      const item = current2.tasks.find((row) => row.id === task.id)
      if (item?.status === 'blocked') throw new FatalWaitError(`Engine task blocked at review: ${item.reviewSummary ?? ''}`)
      return { done: item?.status === 'completed' && item?.integrationState === 'integrated', detail: `status=${item?.status} integration=${item?.integrationState ?? '-'}` }
    }, { timeoutMs: 10 * 60_000, stallMs: 6 * 60_000, pollMs: 2_000 })

    result.status = 'passed'
    result.reason = `ND task → ND-selected workspace → ${codex.id} → checkpoint → ND reviewer → integration boundary verified.`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    result.status = result.status === 'skipped' ? 'failed' : result.status
    if (!result.reason) result.reason = message
    result.classification = classifyFailure(message)
    log(`[engine] probe failed (${result.classification}): ${message} — recorded only; core matrix unaffected`)
  }
  evidence.writeJson('engine-compat.json', result)
  return result
}

// ── Final gates + evidence ──────────────────────────────────────────────────
function buildExecutions(snap) {
  return snap.runs
    .filter((run) => run.kind === 'task-execution' && run.taskId)
    .map((run) => {
      const task = snap.tasks.find((item) => item.id === run.taskId)
      const agent = task?.assignedAgentId ? snap.agents.find((item) => item.id === task.assignedAgentId) : undefined
      const route = parseRoute(run.output)
      return {
        runId: run.id,
        companyId: run.companyId,
        companyName: snap.companies.find((item) => item.id === run.companyId)?.name ?? '(unknown)',
        projectId: run.projectId,
        projectName: snap.projects.find((item) => item.id === run.projectId)?.name ?? '(unknown)',
        taskId: run.taskId,
        taskTitle: task?.title ?? '(unknown)',
        agentId: agent?.id ?? null,
        agentName: agent?.name ?? '(unassigned)',
        modelId: agent?.modelId ?? route?.model ?? null,
        engineId: run.engineId ?? route?.engineId ?? null,
        sessionId: run.sessionId,
        workspaceRoot: run.workspaceRoot ?? null,
        branch: run.workspaceBranch ?? null,
        startTimestamp: run.startedAt,
        endTimestamp: run.completedAt ?? null,
        checkpoint: run.checkpointCommit ?? null,
        finalStatus: run.status,
        error: run.error ?? null,
        verification: parseVerification(run.output),
        route,
      }
    })
}

function evaluateGates(ctx) {
  const { snap, concurrency, routes, workbench, restart, engine, phaseE: phaseEResult, deliveries } = ctx
  const pipelineIds = [ctx.dispatch.id, ctx.driver.id, ctx.tiny.catalog.id, ctx.tiny.checkout.id]
  const gates = []
  const gate = (id, title, status, evidenceText) => gates.push({ id, title, status, evidence: evidenceText })

  // 1 — fresh user single-agent journey
  gate(1, 'Fresh user can use ND like a normal single-agent coding tool',
    workbench?.status === 'pass' ? 'pass' : 'fail',
    workbench ? `workbench route ${workbench.provider}/${workbench.model}, artifacts ${workbench.artifacts?.join(', ')}, terminal ${workbench.terminalPassed ? 'passed' : 'failed'}, git status non-empty, source-control panel visible` : 'phase A did not complete')

  // 2 — exact topology
  const companyNames = snap.companies.map((item) => item.name).sort()
  const projectNames = snap.projects.map((item) => item.name).sort()
  const expectedCompanies = [TOPOLOGY.soloforge.name, TOPOLOGY.swift.name, TOPOLOGY.tinycart.name].sort()
  const expectedProjects = [
    TOPOLOGY.soloforge.notes.name, TOPOLOGY.swift.dispatch.name, TOPOLOGY.swift.driver.name,
    TOPOLOGY.tinycart.catalog.name, TOPOLOGY.tinycart.checkout.name,
  ].sort()
  const topologyOk = JSON.stringify(companyNames) === JSON.stringify(expectedCompanies)
    && JSON.stringify(projectNames) === JSON.stringify(expectedProjects)
    && snap.projects.every((project) => expectedCompanies.includes(snap.companies.find((item) => item.id === project.companyId)?.name ?? ''))
  gate(2, 'Exactly the intended company/project topology is created', topologyOk ? 'pass' : 'fail',
    `companies=${companyNames.join(', ')} projects=${projectNames.join(', ')}`)

  // 3 — state stays isolated
  const forged = ctx.forgedProbes ?? []
  const ownershipOk = snap.tasks.every((task) => {
    const project = snap.projects.find((item) => item.id === task.projectId)
    return project && project.companyId === task.companyId
  }) && snap.agents.every((agent) => snap.companies.some((item) => item.id === agent.companyId))
    && forged.every((probe) => probe.wrongProjectRejected && probe.wrongAgentRejected && probe.strayTasks === 0)
  gate(3, 'Company/project state stays isolated', ownershipOk ? 'pass' : 'fail',
    `ownership consistent=${ownershipOk}; forged probes rejected=${forged.length > 0 ? forged.every((p) => p.wrongProjectRejected && p.wrongAgentRejected) : 'n/a'}`)

  // 4 — three configured models observed in execution evidence
  const observed = [...new Set(routes.map((row) => row.actualModel).filter(Boolean))]
  const observedOk = MODELS.every((modelId) => observed.includes(modelId))
  gate(4, 'All three configured E2E models observed in actual execution evidence', observedOk ? 'pass' : 'fail',
    `configured=${MODELS.join(', ')} observed=${observed.join(', ') || '(none)'}`)

  // 5 — cross-project overlap (required minimum)
  gate(5, 'At least two task executions overlap across different projects',
    concurrency.crossProjectOverlap ? 'pass' : 'fail',
    `overlappingPairs=${concurrency.overlappingPairs.filter((p) => p.crossProject).length} maxParallel=${concurrency.maxParallelTaskRuns}`)

  // 6 — same-project parallel workers/worktrees
  const catalogRuns = concurrency.executions.filter((row) => row.projectId === ctx.tiny.catalog.id)
  const catalogWorkspaces = [...new Set(catalogRuns.map((row) => row.workspaceRoot).filter(Boolean))]
  const catalogBranches = [...new Set(catalogRuns.map((row) => row.branch).filter(Boolean))]
  const catalogAgents = [...new Set(catalogRuns.map((row) => row.agentName))]
  const sameProjectOk = concurrency.sameProjectParallelism && catalogWorkspaces.length >= 2
    && catalogBranches.length >= 2 && catalogAgents.length >= 2
  gate(6, 'Catalog Mini proves same-project parallel execution with two separate workers/worktrees', sameProjectOk ? 'pass' : 'fail',
    `overlap=${concurrency.sameProjectParallelism} workspaces=${catalogWorkspaces.length} branches=${catalogBranches.length} agents=${catalogAgents.join(', ')}`)

  // 7 — switching cannot redirect a running task workspace
  const switchProbes = ctx.guardProbeList.filter((probe) => probe.kind === 'switch-attempt')
  const gate7 = switchProbes.length > 0 && switchProbes.every((probe) => probe.runningTaskWorkspacesUnchanged && probe.activeContextUnchanged
    && (probe.companySwitch?.refused ?? true) && (probe.projectSwitch?.refused ?? true))
  gate(7, 'Project/company switching cannot redirect a running task workspace', gate7 ? 'pass' : 'fail',
    `${switchProbes.length} switch attempt(s) during live runs; all refused with unchanged active context and unchanged running-task workspaces=${gate7}`)

  // 8 — background work continues while the user navigates
  const navOk = phaseEResult?.status === 'pass'
    && switchProbes.every((probe) => probe.backgroundRunsFailedDuringSwitch.length === 0)
    && (liveCrossProjectAt !== null || concurrency.crossProjectOverlap)
  gate(8, 'Background work continues while the user navigates elsewhere', navOk ? 'pass' : 'fail',
    phaseEResult ? `surface navigation OK; no running run failed during ${switchProbes.length} switch attempt(s); cross-project work observed live/interval overlap` : 'phase E did not complete')

  // 9 — level 3 completes explicit-start work through execution and review
  const swiftTasks = snap.tasks.filter((task) => [ctx.dispatch.id, ctx.driver.id].includes(task.projectId))
  const swiftReviews = snap.runs.filter((run) => [ctx.dispatch.id, ctx.driver.id].includes(run.projectId) && run.kind === 'task-review' && run.status === 'completed')
  const gate9 = swiftTasks.length > 0 && swiftTasks.every((task) => task.status === 'completed' && task.integrationState === 'integrated')
    && swiftReviews.length >= swiftTasks.length
    && [ctx.dispatch.id, ctx.driver.id].every((id) => snap.projects.find((item) => item.id === id)?.progress === 100)
  gate(9, 'Workflow level 3 completes explicit-start work through execution and review', gate9 ? 'pass' : 'fail',
    `swift tasks=${swiftTasks.length} allCompletedIntegrated=${swiftTasks.every((task) => task.status === 'completed' && task.integrationState === 'integrated')} completedReviews=${swiftReviews.length}`)

  // 10 — level 4 happy path with no hidden driver nudges
  const dispatchActions = ctx.actionLog.filter((row) => ['runNext', 'runTask'].includes(row.action))
  const repairActions = ctx.actionLog.filter((row) => row.action === 'repair' || /nudge|repair/i.test(String(row.phase)))
  const tinyTasks = snap.tasks.filter((task) => [ctx.tiny.catalog.id, ctx.tiny.checkout.id].includes(task.projectId))
  const gate10 = tinyTasks.every((task) => task.status === 'completed' && task.integrationState === 'integrated')
    && repairActions.length === 0
    && [ctx.tiny.catalog.id, ctx.tiny.checkout.id].every((id) => snap.projects.find((item) => item.id === id)?.progress === 100)
  gate(10, 'Autopilot level 4 completes happy-path work without hidden test-driver nudges', gate10 ? 'pass' : 'fail',
    `tiny tasks all completed+integrated=${tinyTasks.every((task) => task.status === 'completed' && task.integrationState === 'integrated')}; scripted dispatch actions=${JSON.stringify(dispatchActions.map((row) => `${row.phase}:${row.action}`))}; repair actions=${repairActions.length}`)

  // 11 — durable receipt/workspace/checkpoint evidence
  const missingEvidence = concurrency.executions.filter((row) => !row.workspaceRoot || !row.checkpoint || !row.runId)
  gate(11, 'Every execution has durable run receipt/workspace/checkpoint evidence', missingEvidence.length === 0 ? 'pass' : 'fail',
    `executions=${concurrency.executions.length} missing(any of receipt/workspace/checkpoint)=${missingEvidence.length}`)

  // 12 — fresh review sessions
  const staleReviews = []
  for (const task of snap.tasks.filter((item) => pipelineIds.includes(item.projectId) && item.status === 'completed')) {
    const exec = snap.runs.find((run) => run.taskId === task.id && run.kind === 'task-execution')
    const review = snap.runs.find((run) => run.taskId === task.id && run.kind === 'task-review')
    if (!review || !exec || review.sessionId === exec.sessionId) staleReviews.push(task.title)
  }
  gate(12, 'Independent review uses fresh review sessions', staleReviews.length === 0 ? 'pass' : 'fail',
    `tasks with distinct review sessions=${snap.tasks.filter((item) => pipelineIds.includes(item.projectId) && item.status === 'completed').length - staleReviews.length}/${snap.tasks.filter((item) => pipelineIds.includes(item.projectId) && item.status === 'completed').length}`)

  // 13 — integrated repos contain the expected changes
  const integrationProblems = []
  for (const task of snap.tasks.filter((item) => pipelineIds.includes(item.projectId))) {
    if (task.integrationState !== 'integrated' || !task.integratedHead) integrationProblems.push(`${task.title}=${task.integrationState ?? 'none'}`)
  }
  const catalogBaseFiles = listNewArtifacts(ctx.tiny.catalog.workspacePath)
  const checkoutBaseFiles = listNewArtifacts(ctx.tiny.checkout.workspacePath)
  const expectedCatalog = ['catalog-item.js', 'inventory-count.js']
  const expectedCheckout = ['checkout-total.js', 'checkout-tax.js']
  for (const file of expectedCatalog) if (!catalogBaseFiles.includes(file)) integrationProblems.push(`catalog base missing ${file}`)
  for (const file of expectedCheckout) if (!checkoutBaseFiles.includes(file)) integrationProblems.push(`checkout base missing ${file}`)
  gate(13, 'Integrated repos contain the expected changes', integrationProblems.length === 0 ? 'pass' : 'fail',
    integrationProblems.length ? integrationProblems.join('; ') : 'all pipeline tasks integrated; exact TinyCart artifacts present in base checkouts')

  // 14 — each tiny project passes its own test/build command
  const testResults = ctx.workspaceTestResults
  const gate14 = Object.values(testResults).every((row) => row.exitCode === 0)
  gate(14, 'Each tiny project passes its own test/build commands', gate14 ? 'pass' : 'fail',
    JSON.stringify(Object.fromEntries(Object.entries(testResults).map(([name, row]) => [name, row.exitCode]))))

  // 15 — restart produces correct explicit interruption recovery
  const gate15 = restart?.status === 'pass' && Object.values(restart.checks).every(Boolean)
  gate(15, 'Restart during active work produces correct explicit interruption recovery', gate15 ? 'pass' : 'fail',
    restart ? `${Object.entries(restart.checks).filter(([, ok]) => ok).length}/${Object.keys(restart.checks).length} restart checks; error=${restart.interruptedRunError}` : 'phase F did not complete')

  // 16 — retried interrupted work completes
  gate(16, 'Retried interrupted work can subsequently complete', restart?.retriedToCompletion ? 'pass' : 'fail',
    restart?.retriedToCompletion ? 'victim task retried through ND to completed+integrated; Checkout Mini at 100%' : 'retry leg missing')

  // 17 — no renderer/page errors
  gate(17, 'No renderer/page errors remain', ctx.rendererErrorList.length === 0 ? 'pass' : 'fail',
    ctx.rendererErrorList.length ? JSON.stringify(ctx.rendererErrorList.slice(0, 10)) : 'none captured across launch, relaunch, all phases')

  // 18 — no credential logged or persisted (scan runs before this, count passed in)
  gate(18, 'No API credential is logged or persisted', ctx.secretLeakCount === 0 ? 'pass' : 'fail',
    `secret scan findings=${ctx.secretLeakCount}`)

  // 19 — evidence directory produced
  gate(19, 'Evidence directory produced even on failure', existsSync(ctx.evidenceDir) ? 'pass' : 'fail', ctx.evidenceDir)

  // 20 — existing E2E suites remain green (external to this driver)
  gate(20, 'Existing E2E suites remain green', ctx.externalSuiteStatus ?? 'not-run',
    ctx.externalSuiteStatus ? 'recorded from local validation commands in docs/plan/real-user-production-e2e.md' : 'evaluated by local validation (playwright sweep + e2e suites), not by this driver')

  return gates
}

async function finalize(opts) {
  const { terminal, failureMessage, engineResult } = opts
  log('── Finalizing evidence ──')
  let snap = null
  if (currentPage) {
    try {
      snap = await state()
    } catch (error) {
      evidence.noteError(`final state snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (snap) {
    evidence.writeJson('final-state.json', snap)
    evidence.writeJson('companies.json', snap.companies.map((item) => ({
      id: item.id, name: item.name, autonomyLevel: item.autonomyLevel, status: item.status,
    })))
    evidence.writeJson('projects.json', snap.projects.map((item) => ({
      id: item.id, name: item.name, companyId: item.companyId,
      companyName: snap.companies.find((company) => company.id === item.companyId)?.name,
      status: item.status, progress: item.progress, workspacePath: item.workspacePath, testCommand: item.testCommand ?? null,
    })))
    evidence.writeJson('tasks.json', snap.tasks.map((item) => ({
      id: item.id, title: item.title, companyId: item.companyId, projectId: item.projectId,
      projectName: snap.projects.find((project) => project.id === item.projectId)?.name,
      status: item.status, assignedAgentId: item.assignedAgentId ?? null,
      assignedAgentName: item.assignedAgentId ? snap.agents.find((agent) => agent.id === item.assignedAgentId)?.name : null,
      integrationState: item.integrationState ?? null, integratedHead: item.integratedHead ?? null,
      executionSessionId: item.executionSessionId ?? null, reviewSessionId: item.reviewSessionId ?? null,
      reviewSummary: String(item.reviewSummary ?? '').slice(0, 1_200),
      resultSummary: String(item.resultSummary ?? '').slice(0, 1_200),
    })))
    evidence.writeJson('runs.json', snap.runs.map((run) => ({
      id: run.id, kind: run.kind, status: run.status, companyId: run.companyId, projectId: run.projectId, taskId: run.taskId ?? null,
      sessionId: run.sessionId, engineId: run.engineId ?? null, workspaceKind: run.workspaceKind ?? null,
      workspaceRoot: run.workspaceRoot ?? null, workspaceBranch: run.workspaceBranch ?? null,
      baselineCommit: run.baselineCommit ?? null, checkpointCommit: run.checkpointCommit ?? null,
      runtimePermitId: run.runtimePermitId ?? null, startedAt: run.startedAt, completedAt: run.completedAt ?? null,
      error: run.error ?? null,
      route: parseRoute(run.output), verification: parseVerification(run.output),
      outputExcerpt: String(run.output ?? '').slice(0, 600),
    })))
  }

  const executions = snap ? buildExecutions(snap) : []
  const concurrency = computeConcurrency(executions)
  const routes = snap ? buildRouteEvidence({
    runs: snap.runs, tasks: snap.tasks, agents: snap.agents, companies: snap.companies, projects: snap.projects,
  }) : []
  evidence.writeJson('concurrency.json', {
    definition: 'Overlap is computed from durable task-execution run-receipt intervals (startTimestamp/endTimestamp); pairs list every intersecting couple.',
    executions,
    overlappingPairs: concurrency.overlappingPairs,
    maxParallelTaskRuns: concurrency.maxParallelTaskRuns,
    crossProjectOverlap: concurrency.crossProjectOverlap,
    crossCompanyOverlap: concurrency.crossCompanyOverlap,
    sameProjectParallelism: concurrency.sameProjectParallelism,
    liveObservations: {
      crossProjectFirstSeenAt: liveCrossProjectAt?.at ?? null,
      crossCompanyFirstSeenAt: liveCrossCompanyAt?.at ?? null,
      maxParallelSeenInPolls: maxLiveObserved,
      sampleCount: liveObservations.length,
    },
  })
  evidence.writeJson('routes.json', {
    configuredModels: MODELS,
    provider: PROVIDER_ID,
    rows: routes,
    observedModels: [...new Set(routes.map((row) => row.actualModel).filter(Boolean))],
    allMatched: routes.every((row) => row.matched),
  })
  evidence.writeJson('guard-probes.json', guardProbes)
  evidence.writeJson('actions.json', scriptedActions)

  // Workspace tests: ground truth for gate 14.
  const workspaceTestResults = {}
  const wsByProject = opts.workspaces ?? {}
  const labelBySlug = {
    notes: TOPOLOGY.soloforge.notes.name,
    dispatch: TOPOLOGY.swift.dispatch.name,
    driver: TOPOLOGY.swift.driver.name,
    catalog: TOPOLOGY.tinycart.catalog.name,
    checkout: TOPOLOGY.tinycart.checkout.name,
  }
  for (const [slug, path] of Object.entries(wsByProject)) {
    if (!path) continue
    const label = labelBySlug[slug] ?? slug
    workspaceTestResults[label] = runNodeTests(path)
  }

  // Secret scan — after every artifact except summary/errors has been written.
  const leaks = scanForSecrets(evidence.dir, secretValues())
  const secretLeakCount = leaks.length
  if (secretLeakCount) evidence.noteError(`SECRET LEAK: ${JSON.stringify(leaks)}`)

  const workbench = phaseResults.phaseA ?? null
  const restart = phaseResults.phaseF ?? null
  const engine = engineResult ?? { status: 'not-run', reason: 'driver failed before the engine probe' }

  let gates = []
  if (snap && opts.dispatch && opts.driver && opts.tiny) {
    try {
      gates = evaluateGates({
        snap,
        concurrency,
        routes,
        workbench,
        restart,
        engine,
        phaseE: phaseResults.phaseE ?? null,
        guardProbeList: guardProbes,
        actionLog: scriptedActions,
        workspaceTestResults,
        rendererErrorList: rendererErrors,
        secretLeakCount,
        evidenceDir: evidence.dir,
        dispatch: opts.dispatch,
        driver: opts.driver,
        tiny: opts.tiny,
        externalSuiteStatus: opts.externalSuiteStatus ?? null,
      })
    } catch (error) {
      evidence.noteError(`gate evaluation failed: ${error instanceof Error ? error.message : String(error)}`)
      gates = [{ id: 'eval', title: 'Gate evaluation', status: 'fail', evidence: error instanceof Error ? error.message : String(error) }]
    }
  } else {
    gates = [{ id: 'eval', title: 'Gate evaluation', status: 'not-run', evidence: failureMessage ?? 'driver failed before gates could be evaluated' }]
  }

  const gateFailures = gates.filter((item) => item.status === 'fail')
  const terminalFinal = terminal ?? (gateFailures.length ? 'fail' : 'pass')

  const summary = {
    terminal: terminalFinal,
    failureClass,
    failureMessage: failureMessage ?? null,
    companies: snap?.companies.length ?? null,
    projects: snap?.projects.length ?? null,
    configuredModels: MODELS.length,
    observedModels: new Set(routes.map((row) => row.actualModel).filter(Boolean)).size,
    maxParallelTaskRuns: concurrency.maxParallelTaskRuns,
    crossProjectOverlap: concurrency.crossProjectOverlap,
    crossCompanyOverlap: concurrency.crossCompanyOverlap,
    sameProjectParallelism: concurrency.sameProjectParallelism,
    workspaceIsolation: executions.length > 0 && new Set(executions.map((row) => row.workspaceRoot)).size === executions.length
      && executions.every((row) => !Object.values(wsByProject).includes(row.workspaceRoot)),
    routeIsolation: routes.length > 0 && routes.every((row) => row.matched),
    restartRecovery: restart?.status === 'pass',
    allProjectsBuilt: Object.values(workspaceTestResults).length === 5 && Object.values(workspaceTestResults).every((row) => row.exitCode === 0)
      && (snap ? [ctxSafe(snap, opts.dispatch)?.progress, ctxSafe(snap, opts.driver)?.progress, ctxSafe(snap, opts.tiny?.catalog)?.progress, ctxSafe(snap, opts.tiny?.checkout)?.progress].every((value) => value === 100) : false),
    allProjectTestsPassed: Object.values(workspaceTestResults).every((row) => row.exitCode === 0),
    rendererErrors: rendererErrors.length,
    secretLeaks: secretLeakCount,
    phases: phaseResults,
    gates,
    gateFailures: gateFailures.map((item) => item.id),
    engineCompatibility: engine,
    workspaceTestResults,
    scriptedActionCounts: scriptedActions.reduce((acc, row) => {
      const key = `${row.phase}:${row.action}`
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
    durationMinutes: Number(((Date.now() - (DEADLINE_AT - T.global)) / 60_000).toFixed(1)),
    evidenceDir: evidence.dir,
    environment: environmentFacts(),
    externalValidation: opts.externalValidation ?? null,
  }
  evidence.writeJson('summary.json', summary)
  evidence.writeErrorsLog()

  const leakFindings = scanForSecrets(evidence.dir, secretValues())
  if (leakFindings.length) {
    console.error(`SECRET LEAK DETECTED: ${JSON.stringify(leakFindings)}`)
    process.exitCode = 1
  }

  log('════════ REAL-USER PROD E2E SUMMARY ════════')
  log(`terminal: ${summary.terminal}${failureClass ? ` (${failureClass})` : ''}`)
  log(`companies=${summary.companies} projects=${summary.projects} configuredModels=${summary.configuredModels} observedModels=${summary.observedModels}`)
  log(`maxParallelTaskRuns=${summary.maxParallelTaskRuns} crossProjectOverlap=${summary.crossProjectOverlap} crossCompanyOverlap=${summary.crossCompanyOverlap} sameProjectParallelism=${summary.sameProjectParallelism}`)
  log(`workspaceIsolation=${summary.workspaceIsolation} routeIsolation=${summary.routeIsolation} restartRecovery=${summary.restartRecovery}`)
  log(`rendererErrors=${summary.rendererErrors} secretLeaks=${summary.secretLeaks} duration=${summary.durationMinutes}min`)
  for (const item of gates) log(`  gate ${String(item.id).padStart(2)} ${item.status.toUpperCase().padEnd(7)} ${item.title}`)
  log(`evidence: ${evidence.dir}`)
  if (failureMessage) log(`FAILURE: ${failureMessage}`)

  if (currentPage) {
    await evidence.screenshot(currentPage, '99-final').catch(() => undefined)
  }
  evidence.close()
}

function ctxSafe(snap, project) {
  if (!project) return null
  return snap.projects.find((item) => item.id === project.id) ?? null
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  log('real-user production E2E starting')
  log(`models: [${MODELS.join(', ')}] provider=${PROVIDER_ID} (key present: ${Boolean(API_KEY)})`)

  // Fresh real Git repositories — one per writable project.
  const workspaces = {
    notes: createRepoWorkspace('notes'),
    dispatch: createRepoWorkspace('dispatch'),
    driver: createRepoWorkspace('driver'),
    catalog: createRepoWorkspace('catalog'),
    checkout: createRepoWorkspace('checkout'),
  }
  evidence.writeJson('workspaces.json', Object.fromEntries(Object.entries(workspaces).map(([key, value]) => [key, {
    path: value, baselineHead: gitOk(value, ['rev-parse', 'HEAD']).stdout.trim(), smokeTest: runNodeTests(value).exitCode === 0,
  }])))
  log(`workspaces seeded: ${Object.entries(workspaces).map(([key, value]) => `${key}=${value}`).join(' | ')}`)

  const built = existsSync(join(REPO, 'out', 'main', 'index.js'))
  if (!built) throw new Error('App is not built — run `pnpm build` before e2e:prod:user.')

  await launchApp()
  log(`launched with fresh profile ${userDataDir}`)

  await phaseA(workspaces)
  const swift = await setupSwiftCab(workspaces)
  const tiny = await setupTinyCart(workspaces)

  const snapForContext = await state()
  const dispatch = snapForContext.projects.find((item) => item.name === TOPOLOGY.swift.dispatch.name)
  const driver = snapForContext.projects.find((item) => item.name === TOPOLOGY.swift.driver.name)
  const catalog = snapForContext.projects.find((item) => item.name === TOPOLOGY.tinycart.catalog.name)
  const checkout = snapForContext.projects.find((item) => item.name === TOPOLOGY.tinycart.checkout.name)
  if (!dispatch || !driver || !catalog || !checkout) throw new Error('Pipeline project context missing after setup')
  void swift

  await startPipelines({ dispatch, driver, tiny: { ...tiny, catalog, checkout } })
  await phaseE({ dispatch, tiny: { ...tiny, catalog, checkout } })
  await waitForDeliveries({ dispatch, driver, tiny: { ...tiny, catalog, checkout } })
  await phaseF({ dispatch, driver, tiny: { ...tiny, catalog, checkout } })
  const engineResult = await engineCompatibilityProbe({ dispatch, driver, tiny: { ...tiny, catalog, checkout } })

  await finalize({
    terminal: null,
    failureMessage: null,
    engineResult,
    workspaces,
    dispatch,
    driver,
    tiny: { ...tiny, catalog, checkout },
    forgedProbes: guardProbes.filter((probe) => probe.kind === 'forged-ownership'),
  })

  const summary = JSON.parse(readFileSync(join(evidence.dir, 'summary.json'), 'utf8'))
  process.exitCode = summary.terminal === 'pass' && summary.gateFailures.length === 0 ? 0 : 1
  if (currentApp) await closeApp()
}

main().catch(async (error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  if (!failureClass) failureClass = classifyFailure(message)
  try {
    await finalize({
      terminal: failureClass === 'provider-auth' || failureClass === 'provider-rate' ? 'provider-error' : 'fail',
      failureMessage: message,
      engineResult: null,
      workspaces: null,
      dispatch: null,
      driver: null,
      tiny: null,
    })
  } catch (finalizeError) {
    console.error('Evidence finalization also failed:', finalizeError)
    evidence.noteError(`finalize failed: ${finalizeError instanceof Error ? finalizeError.message : String(finalizeError)}`)
    evidence.writeErrorsLog()
    evidence.close()
  }
  try { await closeApp() } catch { /* already gone */ }
  process.exitCode = 1
})
