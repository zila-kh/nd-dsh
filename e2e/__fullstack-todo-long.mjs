/**
 * Full-stack Todo end-to-end scenario driver.
 *
 * Seeds a throwaway user-data profile with the Omiroute provider, launches the
 * built ND-DSH desktop app through Playwright's Electron launcher, creates the
 * TaskMaster Tech company at autonomy level 4, adds the Full-Stack Todo
 * project pointed at the target workspace, and runs the autopilot pipeline
 * (PM plan -> worker execution -> independent review) while polling
 * organization state until the project completes or a guard trips.
 *
 * Usage: node e2e/fullstack-todo.mjs   (build first: pnpm build)
 */
import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUN_ROOT = join(tmpdir(), 'nd-dsh-e2e-fullstack')
const TARGET_WS = process.env.TODO_TARGET_WS ?? 'C:\\Users\\dila\\Documents\\GitHub\\nd-dsh-todo-fullstack'
const MODEL_ID = process.env.TODO_MODEL ?? 'auto/coding:pro'
const PROVIDER_SEED = join(RUN_ROOT, 'providers.seed.json')

const POLL_MS = 20_000
const STALL_MS = 45 * 60_000
const DEADLINE_MS = 240 * 60_000
const NUDGE_IDLE_MS = 90_000
const MAX_NUDGES = 5

const COMPANY = { name: 'TaskMaster Tech', mission: 'Build reliable full-stack web applications end-to-end with tested, production-quality code.' }
const PROJECT = {
  name: 'Full-Stack Todo Application',
  objective: 'Build a full-stack Todo application with a React frontend, SQLite persistence layer, and REST API server, including unit tests and a build script.',
}

const logPath = join(RUN_ROOT, `driver-${Date.now()}.log`)
mkdirSync(RUN_ROOT, { recursive: true })
const logStream = createWriteStream(logPath, { flags: 'a' })

function ts() { return new Date().toISOString().slice(11, 19) }
function log(line) {
  const text = `[${ts()}] ${line}`
  console.log(text)
  logStream.write(`${text}\n`)
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function countWorkspaceFiles(root) {
  let count = 0
  const walk = (dir, depth) => {
    if (depth > 6) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      if (entry.isFile()) count += 1
      else walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(root, 0)
  return count
}

async function main() {
  // 1. Seed user-data profile before launch so ProviderStore boots with Omiroute.
  const userDataDir = mkdtempSync(join(RUN_ROOT, 'userdata-'))
  writeFileSync(join(userDataDir, 'providers.json'), readFileSync(PROVIDER_SEED, 'utf8'))
  log(`user-data dir: ${userDataDir}`)
  log(`target workspace: ${TARGET_WS} (files now: ${countWorkspaceFiles(TARGET_WS)})`)

  // 2. Launch the built app.
  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: REPO })
  const mainOut = createWriteStream(join(RUN_ROOT, 'main-stdout.log'), { flags: 'a' })
  const mainErr = createWriteStream(join(RUN_ROOT, 'main-stderr.log'), { flags: 'a' })
  app.process().stdout.pipe(mainOut)
  app.process().stderr.pipe(mainErr)

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.setDefaultTimeout(45_000)

  const rendererErrors = []
  page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`)
  })

  // 3. Create the company.
  const nav = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  await nav.getByTitle('Company').click()
  await page.getByPlaceholder('Company name').fill(COMPANY.name)
  await page.getByPlaceholder('Company mission').fill(COMPANY.mission)
  await page.getByRole('button', { name: 'Create AI company' }).click()
  await expectWithLog(() => page.getByText('COMPANY', { exact: true }).first().isVisible(), 'company shell visible')
  log(`company created: ${COMPANY.name}`)

  // 4. Autonomy level 4 (Autopilot). Radix Select triggers are buttons, so
  // scope by the wrapper label's title attribute instead of getByLabel.
  const autonomyScope = page.locator('label[title="Autonomy level"]')
  await autonomyScope.getByRole('combobox').or(autonomyScope.locator('button')).first().click()
  await page.getByRole('option', { name: '4 Autopilot' }).click()
  await waitForState('autonomy level = 4', (s) => s.companies[0]?.autonomyLevel === 4, 45_000, page)
  log('autonomy level set to 4 (Autopilot)')

  // 5. Create the project pointed at the target workspace.
  await page.getByPlaceholder('New project').fill(PROJECT.name)
  await page.getByPlaceholder('Objective').fill(PROJECT.objective)
  const wsInput = page.getByPlaceholder('Workspace path')
  await wsInput.fill(TARGET_WS)
  const filled = await wsInput.inputValue()
  if (resolve(filled) !== resolve(TARGET_WS)) throw new Error(`workspace path field mismatch: ${filled}`)
  await page.getByRole('button', { name: 'Add project' }).click()
  await waitForState('project row in org state', (s) => s.projects.some((p) => p.name === PROJECT.name), 45_000, page)
  log(`project created: ${PROJECT.name}`)

  // 6. Kick off the pipeline through the same IPC the Run next button uses
  // (the button's disabled gating is a renderer busy-flag, not a domain rule).
  const projectId = await page.evaluate((name) => {
    return window.ndDshOrganization.state().then((s) => s.projects.find((p) => p.name === name)?.id)
  }, PROJECT.name)
  if (!projectId) throw new Error('project id not found after creation')
  try {
    await page.evaluate((id) => window.ndDshOrganization.runNext(id), projectId)
    log(`runNext issued for project ${projectId.slice(0, 8)} — PM planning should start`)
  } catch (error) {
    const text = error.message.split('\n')[0]
    // A concurrent kickoff can legitimately win; "already active" is the
    // domain guard working, not a failure.
    if (text.includes('already active')) log(`runNext rejected (run already active — continuing): ${text}`)
    else throw error
  }

  // 7. Monitor loop.
  const startedAt = Date.now()
  let lastSignature = ''
  let lastChangeAt = Date.now()
  let nudges = 0
  let lastNudgeAt = 0
  let terminal = null

  while (Date.now() - startedAt < DEADLINE_MS) {
    await sleep(POLL_MS)
    let snap
    try {
      snap = await page.evaluate(() => window.ndDshOrganization.state())
    } catch (error) {
      log(`state poll failed: ${error.message.split('\n')[0]}`)
      continue
    }

    const project = snap.projects.find((p) => p.name === PROJECT.name) ?? snap.projects.at(-1)
    if (!project) { log('project not found yet'); continue }
    const tasks = snap.tasks.filter((t) => t.projectId === project.id)
    const runs = snap.runs.filter((r) => r.projectId === project.id)
    const activeRun = snap.runs.find((r) => r.status === 'running')
    const byStatus = {}
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
    const files = countWorkspaceFiles(TARGET_WS)

    const signature = JSON.stringify([project.status, project.progress, byStatus, activeRun?.kind, activeRun?.sessionId])
    if (signature !== lastSignature) {
      lastSignature = signature
      lastChangeAt = Date.now()
      log(`proj=${project.status} ${project.progress}% | run=${activeRun ? `${activeRun.kind}@${activeRun.sessionId.slice(0, 8)}` : 'idle'} | tasks=${JSON.stringify(byStatus)} | files=${files}`)
    }

    if (project.status === 'completed') { terminal = 'completed'; break }

    const runnableExists = tasks.some((t) => ['ready', 'in_progress', 'review'].includes(t.status))
    const goalsExist = snap.goals.some((g) => g.projectId === project.id)

    // Bounded nudge when the pipeline is idle but unfinished. Two stall modes
    // exist: no plan yet, or a task errored mid-run (agent-error blocks the
    // task; autonomy rework only covers fail verdicts). A blocked task needs
    // an explicit runTask retry — runNext ignores blocked tasks by design.
    const idleFor = Date.now() - Math.max(lastChangeAt, lastNudgeAt)
    const blockedTask = tasks.find((t) => t.status === 'blocked')
    if (!activeRun && nudges < MAX_NUDGES && Date.now() - lastNudgeAt > NUDGE_IDLE_MS + NUDGE_IDLE_MS) {
      const stuckAfterPlan = !goalsExist && runs.some((r) => r.kind === 'pm-plan' && r.status === 'failed')
      const stuckMidFlight = goalsExist && tasks.length > 0
      if ((stuckAfterPlan || stuckMidFlight || blockedTask) && idleFor > NUDGE_IDLE_MS) {
        nudges += 1
        lastNudgeAt = Date.now()
        if (blockedTask) {
          log(`pipeline idle with blocked task (nudge ${nudges}/${MAX_NUDGES}) — issuing explicit runTask retry`)
          try { await page.evaluate((id) => window.ndDshOrganization.runTask(id), blockedTask.id) } catch (error) { log(`retry failed: ${error.message.split('\n')[0]}`) }
        } else {
          log(`pipeline idle but unfinished (nudge ${nudges}/${MAX_NUDGES}) — issuing runNext`)
          try { await page.evaluate((id) => window.ndDshOrganization.runNext(id), project.id) } catch (error) { log(`nudge failed: ${error.message.split('\n')[0]}`) }
        }
      }
    }

    if (Date.now() - lastChangeAt > STALL_MS) { terminal = 'stalled'; break }
  }

  if (!terminal) terminal = 'deadline'

  // 8. Diagnostics dump.
  let finalState = null
  try { finalState = await page.evaluate(() => window.ndDshOrganization.state()) } catch { /* window may be gone */ }
  const dumpPath = join(RUN_ROOT, 'final-state.json')
  writeFileSync(dumpPath, JSON.stringify({
    terminal,
    elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(1)),
    targetWorkspaceFiles: countWorkspaceFiles(TARGET_WS),
    rendererErrors,
    state: finalState,
  }, null, 2))
  log(`terminal: ${terminal}; diagnostics written to ${dumpPath}`)

  if (rendererErrors.length) {
    log(`renderer errors captured (${rendererErrors.length}):`)
    for (const line of rendererErrors.slice(0, 20)) log(`  ${line.slice(0, 300)}`)
  }

  // 9. Graceful close with force-kill fallback.
  await new Promise((resolveClose) => {
    const fallback = setTimeout(() => { void app.process().kill('SIGKILL'); resolveClose() }, 20_000)
    void app.close().finally(() => { clearTimeout(fallback); resolveClose() })
  })
  log('app closed')
  logStream.end()

  const exitCode = terminal === 'completed' ? 0 : 1
  process.exitCode = exitCode
}

async function expectWithLog(fn, label) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 45_000) {
    try { if (await fn()) return } catch { /* retry */ }
    await sleep(500)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

/** Poll org state through the preload bridge until the predicate holds. */
async function waitForState(label, predicate, timeoutMs = 45_000, pageRef) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const snap = await pageRef.evaluate(() => window.ndDshOrganization.state())
      if (predicate(snap)) return
    } catch { /* retry */ }
    await sleep(500)
  }
  await pageRef.screenshot({ path: join(RUN_ROOT, `fatal-${Date.now()}.png`) }).catch(() => {})
  throw new Error(`timed out waiting for state: ${label}`)
}

main().catch((error) => {
  log(`FATAL: ${error.stack ?? error.message}`)
  logStream.end()
  process.exitCode = 1
})
