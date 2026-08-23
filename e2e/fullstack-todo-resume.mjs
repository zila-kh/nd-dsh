/**
 * Resume driver: reopen an existing ND-DSH user-data profile and push a
 * stalled autonomy-4 pipeline forward. Unlike the fresh-run driver this only
 * monitors and nudges (runNext, explicit runTask retries for blocked tasks).
 *
 * Usage: node e2e/fullstack-todo-resume.mjs <userdata-dir-name>
 */
import { createWriteStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const RUN_ROOT = join(tmpdir(), 'nd-dsh-e2e-fullstack')
const TARGET_WS = 'C:\\Users\\dila\\Documents\\GitHub\\nd-dsh-todo-fullstack'
const USERDATA = process.argv[2]
if (!USERDATA) { console.error('usage: node e2e/fullstack-todo-resume.mjs <userdata-dir-name>'); process.exit(1) }

const POLL_MS = 20_000
const STALL_MS = 15 * 60_000
const DEADLINE_MS = 90 * 60_000
const NUDGE_IDLE_MS = 60_000
const MAX_NUDGES = 12

mkdirSync(RUN_ROOT, { recursive: true })
const logStream = createWriteStream(join(RUN_ROOT, `driver-resume-${Date.now()}.log`), { flags: 'a' })
function ts() { return new Date().toISOString().slice(11, 19) }
function log(line) { const text = `[${ts()}] ${line}`; console.log(text); logStream.write(`${text}\n`) }
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
  const userDataDir = join(RUN_ROOT, USERDATA)
  log(`resuming user-data dir: ${userDataDir}`)

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userDataDir}`], cwd: REPO })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const rendererErrors = []
  page.on('pageerror', (error) => rendererErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') rendererErrors.push(`console: ${message.text()}`)
  })

  // Kick recovery: prefer unblocking blocked tasks, else runNext.
  async function nudge(snap, projectId) {
    const blocked = snap.tasks.find((t) => t.status === 'blocked')
    if (blocked) {
      log(`explicit retry for blocked task "${blocked.title.slice(0, 40)}"`)
      await page.evaluate((id) => window.ndDshOrganization.runTask(id), blocked.id).catch((e) => log(`retry rejected: ${e.message.split('\n')[0]}`))
      return
    }
    log('issuing runNext')
    await page.evaluate((id) => window.ndDshOrganization.runNext(id), projectId).catch((e) => log(`runNext rejected: ${e.message.split('\n')[0]}`))
  }

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
    const project = snap.projects.find((p) => p.workspacePath && resolve(p.workspacePath.toLowerCase()) === resolve(TARGET_WS.toLowerCase())) ?? snap.projects[0]
    if (!project) { log('no project in store yet'); continue }
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

    if (!activeRun && nudges < MAX_NUDGES && Date.now() - lastNudgeAt > NUDGE_IDLE_MS) {
      const unfinished = tasks.some((t) => ['ready', 'in_progress', 'review', 'blocked'].includes(t.status))
      if ((unfinished || tasks.length === 0) && Date.now() - Math.max(lastChangeAt, lastNudgeAt) > NUDGE_IDLE_MS) {
        nudges += 1
        lastNudgeAt = Date.now()
        await nudge(snap, project.id)
      }
    }

    if (Date.now() - lastChangeAt > STALL_MS) { terminal = 'stalled'; break }
  }

  if (!terminal) terminal = 'deadline'

  let finalState = null
  try { finalState = await page.evaluate(() => window.ndDshOrganization.state()) } catch { /* window gone */ }
  writeFileSync(join(RUN_ROOT, 'final-state-resume.json'), JSON.stringify({
    terminal,
    elapsedMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(1)),
    targetWorkspaceFiles: countWorkspaceFiles(TARGET_WS),
    rendererErrors,
    state: finalState,
  }, null, 2))
  log(`terminal: ${terminal}; diagnostics written`)
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

main().catch((error) => {
  log(`FATAL: ${error.stack ?? error.message}`)
  logStream.end()
  process.exitCode = 1
})
