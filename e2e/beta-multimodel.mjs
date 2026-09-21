/**
 * Multi-agent, multi-model beta driver — 3 combo routes only.
 *
 * Mirrors a real ND-DSH user profile: the throwaway profile is seeded by
 * COPYING the developer's real providers.json and provider-secrets.json, then
 * trimming the model list to ONLY the three allowed combos (combo-free,
 * combo-free1, combo-free-2). No catalog auto-discovery happens anywhere in the
 * app — the agent model picker is `providers.flatMap(p => p.models)` — so the
 * three configured models are exactly the three selectable ones.
 *
 * Builds a 5-agent / 3-team company, assigns each agent one of the three
 * combos, then runs the autopilot pipeline (PM plan -> automatic least-open-work
 * distribution -> parallel worker execution in per-task Git worktrees ->
 * independent review). The driver never reassigns planned work manually: it
 * fails if both same-role builder routes are not exercised by ND itself:
 *
 *   AI PM      -> combo-free1   (cx/gpt-5.6-luna)
 *   Builder    -> combo-free    (ocg/mimo-v2.5)
 *   Builder 2  -> combo-free-2  (ocg/longcat-2.0)
 *   Reviewer   -> combo-free1   (independent of both builder tiers)
 *   Researcher -> combo-free
 *
 * Usage: node e2e/beta-multimodel.mjs   (build first: pnpm build)
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUN_ROOT = join(tmpdir(), 'nd-dsh-beta-multimodel')

// ── Provider: mirror the real Settings profile, limited to the three combos ──
// The ND-DSH agent model picker is `providers.flatMap(p => p.models)`, so the
// only way a model becomes selectable is by being in provider settings — there
// is no catalog auto-discovery. This driver copies the developer's real
// providers.json + provider-secrets.json (same safeStorage credential) into a
// throwaway profile and rewrites the model list to EXACTLY the three combos.
const SOURCE_PROFILE = process.env.BETA_SOURCE_PROFILE ?? join(process.env.APPDATA ?? '', 'nd-dsh')
const COMBO_IDS = ['combo-free', 'combo-free1', 'combo-free-2']

// ── One combo per agent; reviewer stays off both builder tiers ───────────────
const AGENT_MODELS = {
  'AI PM': 'combo-free1',
  Builder: 'combo-free',
  'Builder 2': 'combo-free-2',
  Reviewer: 'combo-free1',
  Researcher: 'combo-free',
}
// Fresh Git repository: per-task worktrees (real parallel execution) require one.
const TARGET_WS = process.env.BETA_TARGET_WS ?? 'C:\\Users\\dila\\Documents\\GitHub\\nd-dsh-beta-teams'
const COMPANY = {
  name: 'Polyglot Systems',
  mission: 'Ship verified software with a multi-model AI workforce: planning on a reasoning route, parallel implementation on two coding routes, and independent review on a third.',
}
const PROJECT = {
  name: 'Team Board Dashboard',
  objective: 'Build a small dashboard app (static frontend + JSON-file persistence + tiny Node server) that shows team tasks and live progress. Include unit tests and an npm build script.',
}

const POLL_MS = 15_000
const STALL_MS = 15 * 60_000
const DEADLINE_MS = 100 * 60_000
const NUDGE_IDLE_MS = 90_000
const MAX_NUDGES = 5

const logPath = join(RUN_ROOT, `driver-${Date.now()}.log`)
const logStream = createWriteStream(logPath, { flags: 'a' })

function ts() { return new Date().toISOString().slice(11, 19) }
function log(line) {
  const text = `[${ts()}] ${line}`
  console.log(text)
  logStream.write(`${text}\n`)
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
function short(id = '') { return id.slice(0, 8) }

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

function git(cwd, args) {
  const result = spawnSync('git', [
    '-c', 'user.name=ND-DSH Beta', '-c', 'user.email=beta@nd-dsh.invalid', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr?.trim() || String(result.status)}`)
}

/** Per-task worktrees need a real repository; a non-Git folder stays serial. */
function ensureGitWorkspace(root) {
  if (spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', windowsHide: true }).status === 0) return
  mkdirSync(root, { recursive: true })
  git(root, ['init', '--initial-branch=main'])
  writeFileSync(join(root, 'README.md'), '# ND-DSH beta workspace\n\nSeeded by e2e/beta-multimodel.mjs.\n', 'utf8')
  git(root, ['add', '.'])
  git(root, ['commit', '-m', 'chore: seed the beta workspace'])
}

/**
 * Copy the real Settings profile into a throwaway userData dir, then rewrite the
 * model list to exactly the three combos. The encrypted credential file is
 * copied as-is: safeStorage decrypts per OS user, so the stored key keeps
 * working without ever handling the secret in this script.
 */
function seedProfile(userDataDir) {
  const providersPath = join(SOURCE_PROFILE, 'providers.json')
  const secretsPath = join(SOURCE_PROFILE, 'provider-secrets.json')
  const providers = JSON.parse(readFileSync(providersPath, 'utf8'))
  const enabled = providers.filter((provider) => provider.enabled)
  const provider = enabled[0]
  if (!provider) throw new Error(`no enabled provider in ${providersPath}`)

  const template = provider.models?.[0] ?? {}
  // Keep the configured model entry's shape (context/inputTypes/maxOutputTokens)
  // and expose only the three combo routes.
  provider.models = COMBO_IDS.map((id) => ({ ...template, id }))
  writeFileSync(join(userDataDir, 'providers.json'), JSON.stringify(providers, null, 2))

  const secrets = readFileSync(secretsPath, 'utf8')
  const hasStoredKey = Object.keys(JSON.parse(secrets).keys ?? {}).includes(provider.id)
  writeFileSync(join(userDataDir, 'provider-secrets.json'), secrets)
  // safeStorage (Chromium OSCrypt) wraps its key inside "Local State"; without
  // it the copied ciphertext cannot be decrypted and the provider reports
  // "No API key for provider".
  writeFileSync(join(userDataDir, 'Local State'), readFileSync(join(SOURCE_PROFILE, 'Local State'), 'utf8'))
  log(`seeded provider "${provider.name}" (${provider.id}) baseUrl=${provider.baseUrl} models=[${COMBO_IDS.join(', ')}] credential=${hasStoredKey ? 'stored' : 'MISSING'}`)
  return provider
}

async function main() {
  mkdirSync(RUN_ROOT, { recursive: true })
  ensureGitWorkspace(TARGET_WS)

  const userDataDir = mkdtempSync(join(RUN_ROOT, 'userdata-'))
  const provider = seedProfile(userDataDir)

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
  page.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`) })

  // 1. Company.
  const nav = page.getByRole('navigation', { name: 'ND-DSH navigation' })
  await nav.getByTitle('Company').click()
  await page.getByPlaceholder('Company name').fill(COMPANY.name)
  await page.getByPlaceholder('Company mission').fill(COMPANY.mission)
  await page.getByRole('button', { name: 'Create AI company' }).click()
  await expectWithLog(() => page.getByText('COMPANY', { exact: true }).first().isVisible(), 'company shell visible')
  log(`company created: ${COMPANY.name}`)

  // 2. Autopilot, so parallel worker fill is enabled.
  const autonomyScope = page.locator('label[title="Autonomy level"]')
  await autonomyScope.getByRole('combobox').or(autonomyScope.locator('button')).first().click()
  await page.getByRole('option', { name: '4 Autopilot' }).click()
  await waitForState('autonomy level = 4', (s) => s.companies[0]?.autonomyLevel === 4, 45_000, page)
  log('autonomy level set to 4 (Autopilot)')

  // 3. Second engineer so two build tasks can run in parallel worktrees.
  await page.evaluate(({ providerId }) => window.ndDshOrganization.state().then(async (snap) => {
    const company = snap.companies[0]
    const engineer = snap.roles.find((r) => r.companyId === company.id && /engineer/i.test(r.name))
    const engineering = snap.teams.find((t) => t.companyId === company.id && /engineering/i.test(t.name))
    if (!engineer || !engineering) throw new Error('seeded engineer role / engineering team missing')
    if (!snap.agents.some((a) => a.companyId === company.id && a.name === 'Builder 2')) {
      await window.ndDshOrganization.mutate({
        type: 'agent.create',
        companyId: company.id,
        name: 'Builder 2',
        roleId: engineer.id,
        teamId: engineering.id,
        providerId,
      })
    }
  }), { providerId: provider.id })

  // 4. Put one combo route on every agent.
  const assignments = await page.evaluate(({ providerId, agentModels }) => window.ndDshOrganization.state().then(async (snap) => {
    const applied = []
    for (const agent of snap.agents) {
      const modelId = agentModels[agent.name]
      if (!modelId) continue
      await window.ndDshOrganization.mutate({ type: 'agent.update', id: agent.id, patch: { providerId, modelId } })
      applied.push({ name: agent.name, modelId })
    }
    return applied
  }), { providerId: provider.id, agentModels: AGENT_MODELS })
  for (const row of assignments) log(`  agent ${row.name} -> ${row.modelId}`)
  log(`model assignments applied to ${assignments.length} agents`)

  // 5. Project.
  await page.getByPlaceholder('New project').fill(PROJECT.name)
  await page.getByPlaceholder('Objective').fill(PROJECT.objective)
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, TARGET_WS)
  const browse = page.getByRole('button', { name: 'Browse for workspace folder' })
  await browse.click()
  // React re-renders asynchronously, so poll for the picked path instead of
  // reading the button text once.
  await expectWithLog(async () => {
    const text = (await browse.textContent())?.trim() ?? ''
    return resolve(text) === resolve(TARGET_WS)
  }, `workspace folder shown in the Browse field (${TARGET_WS})`)
  log(`workspace folder picked: ${TARGET_WS}`)
  await page.getByRole('button', { name: 'Add project' }).click()
  await waitForState('project row in org state', (s) => s.projects.some((p) => p.name === PROJECT.name), 45_000, page)
  log(`project created: ${PROJECT.name} -> ${TARGET_WS}`)

  // 6. Kick off the pipeline.
  const projectId = await page.evaluate((name) => {
    return window.ndDshOrganization.state().then((s) => s.projects.find((p) => p.name === name)?.id)
  }, PROJECT.name)
  if (!projectId) throw new Error('project id not found after creation')
  try {
    await page.evaluate((id) => window.ndDshOrganization.runNext(id), projectId)
    log(`runNext issued for project ${short(projectId)} — PM planning should start`)
  } catch (error) {
    const text = error.message.split('\n')[0]
    if (text.includes('already active')) log(`runNext rejected (run already active — continuing): ${text}`)
    else throw error
  }

  // 7. Monitor: state, parallel concurrency, and which combo each run used.
  const startedAt = Date.now()
  let lastSignature = ''
  let lastChangeAt = Date.now()
  let nudges = 0
  let lastNudgeAt = 0
  let terminal = null
  let maxParallel = 0
  const routeUse = {}

  while (Date.now() - startedAt < DEADLINE_MS) {
    await sleep(POLL_MS)
    let snap
    try { snap = await page.evaluate(() => window.ndDshOrganization.state()) }
    catch (error) { log(`state poll failed: ${error.message.split('\n')[0]}`); continue }

    const approvalCard = page.locator('aside[aria-label="Runtime requests"]')
    const allowOnce = approvalCard.getByRole('button', { name: 'Allow once' })
    if (await allowOnce.count() > 0) {
      log('runtime approval requested — allowing once')
      await allowOnce.first().click()
      await sleep(1_000)
    }

    const project = snap.projects.find((p) => p.name === PROJECT.name) ?? snap.projects.at(-1)
    if (!project) { log('project not found yet'); continue }

    const tasks = snap.tasks.filter((t) => t.projectId === project.id)
    const runs = snap.runs.filter((r) => r.projectId === project.id)
    const failedRuns = runs.filter((r) => r.status === 'failed')
    const lastFailure = failedRuns.at(-1)
    // An auth failure never resolves by nudging; report it and stop.
    if (lastFailure && /401|invalid_api_key|Missing API key|No API key|Unauthorized/i.test(lastFailure.error ?? '')) {
      log(`AUTH FAILURE: ${lastFailure.kind} run failed — ${lastFailure.error}`)
      terminal = 'auth-error'
      break
    }
    const activeRuns = runs.filter((r) => r.status === 'running')
    const parallelNow = activeRuns.filter((r) => r.kind === 'task-execution').length
    if (parallelNow > maxParallel) maxParallel = parallelNow
    for (const run of activeRuns) {
      const task = run.taskId ? tasks.find((t) => t.id === run.taskId) : undefined
      const agent = task ? snap.agents.find((a) => a.id === task.assignedAgentId) : undefined
      if (!agent) continue
      routeUse[agent.modelId ?? 'default'] = (routeUse[agent.modelId ?? 'default'] ?? 0) + 1
    }
    const runningLabel = activeRuns
      .map((run) => {
        const task = run.taskId ? tasks.find((t) => t.id === run.taskId) : undefined
        const agent = task ? snap.agents.find((a) => a.id === task.assignedAgentId) : undefined
        return `${run.kind}:${agent ? `${agent.name}@${agent.modelId}` : short(run.sessionId)}`
      })
      .join(' | ')
    const byStatus = {}
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1

    const signature = JSON.stringify([project.status, project.progress, byStatus, runningLabel, failedRuns.length, lastFailure?.error ?? ''])
    if (signature !== lastSignature) {
      lastSignature = signature
      lastChangeAt = Date.now()
      log(`proj=${project.status} ${project.progress}% | running=${activeRuns.length} (parallel tasks=${parallelNow}) ${runningLabel || '(idle)'} | tasks=${JSON.stringify(byStatus)} | failed=${failedRuns.length} | files=${countWorkspaceFiles(TARGET_WS)}`)
      if (lastFailure) log(`  last failure: ${lastFailure.kind} — ${(lastFailure.error ?? '').slice(0, 300)}`)
    }

    if (project.status === 'completed') { terminal = 'completed'; break }

    // Assignment is intentionally left untouched. This beta driver is an
    // acceptance test for ND's automatic least-open-work distribution, not a
    // manager script that repairs the plan after the fact.
    const idleFor = Date.now() - Math.max(lastChangeAt, lastNudgeAt)
    const blockedTask = tasks.find((t) => t.status === 'blocked')
    if (activeRuns.length === 0 && nudges < MAX_NUDGES && Date.now() - lastNudgeAt > NUDGE_IDLE_MS * 2) {
      const stuckAfterPlan = !snap.goals.some((g) => g.projectId === project.id) && runs.some((r) => r.kind === 'pm-plan' && r.status === 'failed')
      const stuckMidFlight = snap.goals.some((g) => g.projectId === project.id) && tasks.length > 0
      if ((stuckAfterPlan || stuckMidFlight || blockedTask) && idleFor > NUDGE_IDLE_MS) {
        nudges += 1
        lastNudgeAt = Date.now()
        if (blockedTask) {
          log(`pipeline idle with blocked task (nudge ${nudges}/${MAX_NUDGES}) — issuing explicit runTask retry`)
          try { await page.evaluate((id) => window.ndDshOrganization.runTask(id), blockedTask.id) }
          catch (error) { log(`retry failed: ${error.message.split('\n')[0]}`) }
        } else {
          log(`pipeline idle but unfinished (nudge ${nudges}/${MAX_NUDGES}) — issuing runNext`)
          try { await page.evaluate((id) => window.ndDshOrganization.runNext(id), project.id) }
          catch (error) { log(`nudge failed: ${error.message.split('\n')[0]}`) }
        }
      }
    }

    if (Date.now() - lastChangeAt > STALL_MS) { terminal = 'stalled'; break }
  }

  if (!terminal) terminal = 'deadline'

  // 8. Final report + diagnostics.
  let finalState = null
  try { finalState = await page.evaluate(() => window.ndDshOrganization.state()) } catch { /* window may be gone */ }
  const project = finalState?.projects.find((p) => p.name === PROJECT.name)
  const tasks = finalState && project ? finalState.tasks.filter((t) => t.projectId === project.id) : []
  const taskSummary = tasks.map((t) => {
    const agent = finalState.agents.find((a) => a.id === t.assignedAgentId)
    const runs = finalState.runs.filter((r) => r.taskId === t.id)
    const executionRuns = runs.filter((r) => r.kind === 'task-execution')
    const route = executionRuns.find((r) => r.output?.includes('<nd-dsh-execution-route>'))?.output?.match(/<nd-dsh-execution-route>(.*?)<\/nd-dsh-execution-route>/s)?.[1]
    return { title: t.title, status: t.status, agent: agent?.name, model: agent?.modelId, attempts: runs.length, executionAttempts: executionRuns.length, route }
  })
  const builderModelsRequired = new Set([AGENT_MODELS.Builder, AGENT_MODELS['Builder 2']])
  const builderModelsObserved = new Set(taskSummary
    .filter((row) => (row.agent === 'Builder' || row.agent === 'Builder 2') && row.executionAttempts > 0 && row.model)
    .map((row) => row.model))
  const missingBuilderRoutes = [...builderModelsRequired].filter((model) => !builderModelsObserved.has(model))
  if (terminal === 'completed' && missingBuilderRoutes.length > 0) {
    terminal = 'distribution-failed'
    log(`automatic same-role distribution did not exercise builder route(s): ${missingBuilderRoutes.join(', ')}`)
  }
  const dumpPath = join(RUN_ROOT, 'final-state.json')
  writeFileSync(dumpPath, JSON.stringify({
    terminal,
    elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(1)),
    maxParallelTaskRuns: maxParallel,
    routeUse,
    automaticBuilderRoutes: {
      required: [...builderModelsRequired],
      observed: [...builderModelsObserved],
      missing: missingBuilderRoutes,
    },
    agentAssignments: AGENT_MODELS,
    targetWorkspaceFiles: countWorkspaceFiles(TARGET_WS),
    tasks: taskSummary,
    rendererErrors,
    state: finalState,
  }, null, 2))

  log(`terminal: ${terminal} | elapsed=${((Date.now() - startedAt) / 60_000).toFixed(1)}min | max parallel task runs=${maxParallel}`)
  log(`route usage: ${JSON.stringify(routeUse)}`)
  log(`automatic builder routes: required=${JSON.stringify([...builderModelsRequired])} observed=${JSON.stringify([...builderModelsObserved])}`)
  for (const t of taskSummary) log(`  task "${t.title}" [${t.status}] ${t.agent ?? 'unassigned'}@${t.model ?? 'default'}${t.route ? ` route=${t.route}` : ''}`)
  log(`diagnostics written to ${dumpPath}`)
  if (rendererErrors.length) {
    log(`renderer errors captured (${rendererErrors.length}):`)
    for (const line of rendererErrors.slice(0, 20)) log(`  ${line.slice(0, 300)}`)
  }

  await new Promise((resolveClose) => {
    const fallback = setTimeout(() => { void app.process().kill('SIGKILL'); resolveClose() }, 20_000)
    void app.close().finally(() => { clearTimeout(fallback); resolveClose() })
  })
  log('app closed')
  logStream.end()

  process.exitCode = terminal === 'completed' ? 0 : 1
}

async function expectWithLog(fn, label) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 45_000) {
    if (await fn()) return
    await sleep(500)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

async function waitForState(label, predicate, timeoutMs, page) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(2_000)
    let snap
    try { snap = await page.evaluate(() => window.ndDshOrganization.state()) } catch { continue }
    if (predicate(snap)) return
  }
  throw new Error(`timed out waiting for: ${label}`)
}

main().catch((error) => {
  log(`FATAL: ${error.stack ?? error.message}`)
  logStream.end()
  process.exitCode = 1
})
