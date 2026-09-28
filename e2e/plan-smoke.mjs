/**
 * Live-model AI PM planning smoke: one fresh profile, one company, one project on
 * a throwaway Git workspace, one "AI PM plan" request through the same IPC the
 * work board uses. Passes when the plan run completes and its goal, milestones
 * and tasks land on the board; prints any repairs ND made to the model's plan.
 *
 * It exercises planning only (the company stays at autonomy 2, so nothing is
 * executed) and is cheap enough to run on every planning change.
 *
 * Usage:  pnpm build && node e2e/plan-smoke.mjs        (needs .env.e2e)
 *         ND_E2E_APP_ENTRY=<path to out/main/index.js> to launch another build
 * Exit:   0 pass · 1 plan failed or timed out · 2 config missing
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { _electron as electron } from '@playwright/test'

loadDotenv({ path: '.env.e2e', quiet: true })
loadDotenv({ quiet: true })

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = process.env.E2E_MODEL_BASE_URL?.trim() ?? ''
const API_KEY = process.env.E2E_MODEL_API_KEY?.trim() ?? ''
const MODEL = process.env.E2E_MODEL_1?.trim() ?? ''
const CONTEXT = process.env.E2E_MODEL_CONTEXT?.trim() || '256000'
const PLAN_TIMEOUT_MS = Number(process.env.ND_E2E_PLAN_TIMEOUT_MS ?? 8 * 60_000)
const ENTRY = process.env.ND_E2E_APP_ENTRY?.trim() || '.'

if (!BASE_URL || !API_KEY || !MODEL) {
  console.error('plan-smoke needs E2E_MODEL_BASE_URL, E2E_MODEL_API_KEY and E2E_MODEL_1 in .env.e2e.')
  process.exit(2)
}

const log = (line) => console.log(`[plan-smoke] ${line}`)
const redact = (text) => String(text ?? '').split(API_KEY).join('<redacted>')

const profile = mkdtempSync(join(tmpdir(), 'nd-plan-smoke-profile-'))
const workspace = mkdtempSync(join(tmpdir(), 'nd-plan-smoke-ws-'))
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'providers.json'), JSON.stringify([{
  id: 'e2e-openai-compatible',
  name: 'E2E OpenAI Compatible',
  enabled: true,
  baseUrl: BASE_URL,
  apiFormat: 'OpenAI compatible (/v1/chat/completions)',
  apiKey: API_KEY,
  models: [{ id: MODEL, context: CONTEXT }],
}], null, 2), 'utf8')

const git = (args) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
git(['init'])
writeFileSync(join(workspace, 'README.md'), '# Team standup notes\n\nA tiny web page where a team posts daily standup updates.\n')
git(['add', '.'])
git(['-c', 'user.name=ND Smoke', '-c', 'user.email=smoke@local', 'commit', '-m', 'baseline'])

let app
let exitCode = 1
try {
  app = await electron.launch({
    args: [ENTRY === '.' ? '.' : resolve(REPO, ENTRY), `--user-data-dir=${profile}`],
    cwd: REPO,
    env: { ...process.env },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.ndDshOrganization), undefined, { timeout: 60_000 })
  log('app ready')

  const { projectId } = await page.evaluate(async ({ workspacePath }) => {
    let state = await window.ndDshOrganization.mutate({ type: 'company.create', name: 'Standup Co', mission: 'Help small teams run async standups.' })
    const company = state.companies.at(-1)
    state = await window.ndDshOrganization.mutate({
      type: 'project.create', companyId: company.id, name: 'Standup Board',
      objective: 'Build a single-page standup board: post an update (yesterday, today, blockers), list today\'s updates, and highlight blockers.',
      workspacePath,
    })
    return { projectId: state.projects.at(-1).id }
  }, { workspacePath: workspace })
  log(`project created; requesting AI PM plan (model ${MODEL})`)

  const receipt = await page.evaluate((id) => window.ndDshOrganization.planProject(id), projectId)
  const startedAt = Date.now()
  let run
  for (;;) {
    run = await page.evaluate((runId) => window.ndDshOrganization.state().then((state) => state.runs.find((item) => item.id === runId)), receipt.runId)
    if (run && run.status !== 'running') break
    if (Date.now() - startedAt > PLAN_TIMEOUT_MS) throw new Error(`plan run still running after ${PLAN_TIMEOUT_MS} ms`)
    await new Promise((done) => setTimeout(done, 3_000))
  }
  const state = await page.evaluate(() => window.ndDshOrganization.state())
  const goals = state.goals.filter((item) => item.projectId === projectId)
  const milestones = state.milestones.filter((item) => item.projectId === projectId)
  const tasks = state.tasks.filter((item) => item.projectId === projectId)
  const planActivity = state.activity.find((item) => item.projectId === projectId && item.type === 'pm.plan')
  log(`run ${run.status} in ${Math.round((Date.now() - startedAt) / 1000)} s`)
  if (run.error) log(`run error: ${redact(run.error).slice(0, 1_500)}`)
  log(`goals ${goals.length} · milestones ${milestones.length} · tasks ${tasks.length}`)
  for (const task of tasks) {
    const deps = task.dependsOn.map((id) => tasks.find((item) => item.id === id)?.title ?? id)
    log(`  [${task.status}] ${task.title}${deps.length ? `  ← ${deps.join(', ')}` : ''}`)
  }
  if (planActivity) log(`activity: ${redact(planActivity.message).slice(0, 1_500)}`)
  if (process.env.ND_E2E_PLAN_DUMP) writeFileSync(process.env.ND_E2E_PLAN_DUMP, redact(run.output ?? ''), 'utf8')
  exitCode = run.status === 'completed' && goals.length > 0 && tasks.length > 0 ? 0 : 1
  log(exitCode === 0 ? 'PASS' : 'FAIL')
} catch (error) {
  log(`FAIL: ${redact(error instanceof Error ? error.stack ?? error.message : error)}`)
} finally {
  await app?.close().catch(() => undefined)
  rmSync(profile, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
}
process.exit(exitCode)
