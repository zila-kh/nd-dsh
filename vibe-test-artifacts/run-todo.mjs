/*
 * ND-DSH end-to-end ship trial: build a full-stack Todo app through the
 * real autonomous company pipeline (PM plan -> worker -> reviewer) using
 * the local Omiroute LLM proxy. Fresh user-data dir keeps this run isolated.
 */
import { _electron } from '@playwright/test'
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '..')
const userDataDir = join(tmpdir(), 'nd-dsh-todo-run')
const shotsDir = join(import.meta.dirname, 'shots')
const logFile = join(import.meta.dirname, 'todo-run.log')
const workspaceDir = 'C:\\Users\\dila\\Documents\\GitHub\\nd-dsh-todo-fullstack'
const PROVIDER_ID = 'omiroute-todo'
const MODEL_ID = 'antigravity/gemini-3.7-flash-high'

const MAX_RUN_MS = 50 * 60 * 1000
const STALL_MS = 8 * 60 * 1000

mkdirSync(shotsDir, { recursive: true })
for (const f of readdirSync(shotsDir)) rmSync(join(shotsDir, f), { force: true })
writeFileSync(logFile, '')

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`
  console.log(line)
  appendFileSync(logFile, line + '\n')
}

let shotIndex = 0
async function shot(page, label) {
  const path = join(shotsDir, `${String(++shotIndex).padStart(3, '0')}-${label}.png`)
  try { await page.screenshot({ path }); log('shot', path) } catch (error) { log('shot-failed', label, String(error).slice(0, 120)) }
}

function summarize(state) {
  const company = state.companies.find((c) => c.id === state.activeCompanyId)
  const projects = state.projects.filter((p) => p.companyId === company?.id)
  const ids = new Set(projects.map((p) => p.id))
  return {
    company: company ? { name: company.name, autonomy: company.autonomyLevel } : null,
    projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status, progress: p.progress })),
    goals: state.goals.filter((g) => ids.has(g.projectId)).map((g) => ({ title: g.title, status: g.status })),
    tasks: state.tasks.filter((t) => ids.has(t.projectId)).map((t) => ({
      id: t.id, title: t.title.slice(0, 60), status: t.status,
      result: t.resultSummary?.slice(0, 160), review: t.reviewSummary?.slice(0, 160),
    })),
    runs: state.runs.filter((r) => ids.has(r.projectId)).slice(-5).map((r) => ({
      kind: r.kind, status: r.status, error: r.error?.slice(0, 200),
    })),
  }
}

// Fresh, isolated profile: seeded provider metadata, zero organization state.
rmSync(userDataDir, { recursive: true, force: true })
mkdirSync(join(userDataDir, 'dsh-home'), { recursive: true })
writeFileSync(join(userDataDir, 'providers.json'), JSON.stringify([
  {
    id: PROVIDER_ID,
    name: 'Omiroute Local',
    enabled: true,
    baseUrl: 'http://localhost:20128/v1',
    apiFormat: 'OpenAI compatible (/v1/chat/completions)',
    models: [{ id: MODEL_ID, context: '1000000' }],
  },
], null, 2))
mkdirSync(workspaceDir, { recursive: true })
log('profile prepared at', userDataDir, '| workspace', workspaceDir)

const app = await _electron.launch({
  cwd: repo,
  args: ['.', `--user-data-dir=${userDataDir}`],
  env: { ...process.env, ND_DSH_CDP_PORT: '9933' },
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (error) => log('PAGEERROR', String(error).slice(0, 300)))
page.on('console', (message) => { if (message.type() === 'error') log('CONSOLE-ERROR', message.text().slice(0, 300)) })

await page.waitForTimeout(2500)
const mode = await page.evaluate(() => ({ dsh: typeof window.ndDsh === 'object', org: typeof window.ndDshOrganization === 'object' }))
log('runtime', JSON.stringify(mode))
if (!mode.dsh || !mode.org) { await shot(page, 'boot-fail'); await app.close(); process.exit(1) }

// Store the credential through the real IPC path so ProviderStore persists it.
await page.evaluate(async ({ id, key }) => window.ndDsh.providers.setApiKey(id, key), { id: PROVIDER_ID, key: 'sk-local-proxy' })
log('api key stored for', PROVIDER_ID)

// Company view: create the company through the UI like a real user.
await page.evaluate(() => { location.hash = '#/company' })
await page.waitForTimeout(900)
let summary = summarize(await page.evaluate(() => window.ndDshOrganization.state()))
if (!summary.company) {
  await page.getByPlaceholder('Company name').fill('TaskMaster Tech')
  await page.getByPlaceholder('Company mission').fill('Autonomous software company that builds, verifies, and ships production-quality full-stack web applications end to end.')
  await page.getByPlaceholder('Company name').press('Enter')
  await page.waitForTimeout(1500)
}
summary = summarize(await page.evaluate(() => window.ndDshOrganization.state()))
log('company', JSON.stringify(summary.company))
await shot(page, 'company-created')

// Project
await page.getByPlaceholder('New project').fill('Todo Fullstack')
await page.getByPlaceholder('Objective').fill('Build a complete full-stack Todo web application inside this workspace. Required: REST API server with CRUD endpoints for todo items; persistent storage using SQLite (or an equivalent real database layer); React frontend with add/toggle/delete todo UI; unit tests for API and storage; working dev and build scripts. Implement, run the tests yourself, and verify everything works before finishing.')
await page.getByPlaceholder('Workspace path').fill(workspaceDir)
await page.getByRole('button', { name: 'Add project' }).click()
await page.waitForTimeout(1500)
summary = summarize(await page.evaluate(() => window.ndDshOrganization.state()))
log('project', JSON.stringify(summary.projects))
await shot(page, 'project-created')

// Autonomy 4 then kick the pipeline.
if ((summary.company?.autonomy ?? 0) !== 4) {
  await page.locator('label[title="Autonomy level"] button').first().click()
  await page.waitForTimeout(400)
  await page.getByRole('option', { name: '4 Autopilot' }).click()
  await page.waitForTimeout(1500)
}
const runNext = page.getByRole('button', { name: 'Run next' })
if (await runNext.count() > 0 && !(await runNext.isDisabled())) await runNext.click()
log('pipeline kicked')
await page.waitForTimeout(4000)
await shot(page, 'pipeline-started')

// Monitor loop
const startedAt = Date.now()
let lastPrint = ''
let lastChangeAt = Date.now()
let reference = summarize(await page.evaluate(() => window.ndDshOrganization.state()))
let recoveryClicks = 0
let approvals = 0

while (Date.now() - startedAt < MAX_RUN_MS) {
  await page.waitForTimeout(20_000)

  const card = page.locator('aside[aria-label="Runtime requests"]')
  if (await card.count() > 0) {
    const text = (await card.first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)
    await shot(page, 'approval-card')
    log('APPROVAL CARD:', text)
    const allow = card.first().getByRole('button', { name: 'Allow once' })
    if (await allow.count() > 0) { await allow.click(); approvals++; log('approved #', approvals); await page.waitForTimeout(1000) }
  }

  let current
  try { current = summarize(await page.evaluate(() => window.ndDshOrganization.state())) }
  catch (error) { log('poll-failed', String(error).slice(0, 150)); continue }

  const print = JSON.stringify([current.goals, current.tasks.map((t) => [t.title, t.status]), current.runs])
  if (print !== lastPrint) {
    log('STATE', JSON.stringify({
      goals: current.goals.length,
      tasks: current.tasks.map((t) => `${t.title}=${t.status}`),
      runs: current.runs,
    }, null, 0))
    lastPrint = print
  }
  if (JSON.stringify(current.tasks) !== JSON.stringify(reference.tasks)) { lastChangeAt = Date.now(); reference = current; await shot(page, 'progress') }

  const active = current.runs.some((r) => r.status === 'running')
  const settled = current.tasks.length > 0 && current.tasks.every((t) => ['completed', 'blocked'].includes(t.status)) && !active
  if (settled) { log('PIPELINE SETTLED'); break }

  if (!active && Date.now() - lastChangeAt > STALL_MS && recoveryClicks < 3) {
    recoveryClicks++
    log('stall -> Run next #' + recoveryClicks)
    const btn = page.getByRole('button', { name: 'Run next' })
    if (await btn.count() > 0 && !(await btn.isDisabled())) await btn.click()
    lastChangeAt = Date.now()
  }
}

const final = summarize(await page.evaluate(() => window.ndDshOrganization.state()))
writeFileSync(join(import.meta.dirname, 'todo-final-state.json'), JSON.stringify(final, null, 2))
log('FINAL', JSON.stringify(final, null, 1))
await shot(page, 'final')
await app.close()
log('app closed; run complete')
