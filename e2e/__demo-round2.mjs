/* Round 3 beta-acceptance driver: creates the Kla-Klok project, kicks the
   pipeline, and logs wall-clock phase durations to quantify pipeline speed. */
import { createWriteStream, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUN_ROOT = join(tmpdir(), 'nd-dsh-demo-round3')
mkdirSync(RUN_ROOT, { recursive: true })
const logStream = createWriteStream(join(RUN_ROOT, 'round3.log'), { flags: 'a' })
function log(line) {
  const text = `[${new Date().toISOString().slice(11, 19)}] ${line}`
  console.log(text)
  logStream.write(`${text}\n`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const COMPANY_ID = 'f8d0ac5a-1543-4f24-b866-ddffb01032e7'
const PROJECT_NAME = 'Kla-Klok Khmer Dice Game'
const OBJECTIVE = 'Build a polished, accessible web-based Kla-Klok (Khmer traditional dice game) in React TypeScript: six-symbol betting board (crab, fish, shrimp, tiger, gourd, rooster), three animated dice, correct payout multipliers for single/double/triple matches, betting chips with balance persistence, Khmer and English labels, and automated tests.'
const WORKSPACE = 'C:/Users/MT-Staff/Documents/GitHub/nd-dsh/examples/kla-klok'

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error('renderer page not found — is the dev app running?')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
})
async function evaluate(expression) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const reply = await new Promise((resolve) => pending.set(id, resolve))
  if (reply.error) throw new Error(reply.error.message)
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  return reply.result?.result?.value
}
async function state() {
  try { return await evaluate('window.ndDshOrganization.state()') } catch (error) { log(`state poll failed: ${error.message.split('\n')[0]}`); return null }
}

// 1. Create project with its own workspace (reuse if a previous attempt made it).
mkdirSync(WORKSPACE, { recursive: true })
let snap0 = await state()
let project = snap0.projects.find((p) => p.name === PROJECT_NAME)
if (!project) {
  const created = await evaluate(`window.ndDshOrganization.mutate(${JSON.stringify({ type: 'project.create', companyId: COMPANY_ID, name: PROJECT_NAME, objective: OBJECTIVE, workspacePath: WORKSPACE })})`)
  log(`project created: ${JSON.stringify(created).slice(0, 120)}…`)
  snap0 = await state()
  project = snap0.projects.find((p) => p.name === PROJECT_NAME)
}
if (!project) throw new Error('project not found after create')
log(`project id: ${project.id}`)

// 2. Kick the first run if nothing is running for it, then monitor with phase timing.
const runningNow = snap0.runs.find((r) => r.status === 'running')
if (!runningNow) await evaluate(`window.ndDshOrganization.runNext(${JSON.stringify(project.id)})`)
log(`pipeline active for ${PROJECT_NAME} — timing each phase`)

const startedAt = Date.now()
let phaseStart = { t: Date.now(), label: 'kickoff' }
let lastSignature = ''
const POLL_MS = 15_000
const STALL_MS = 45 * 60_000
const DEADLINE_MS = 3 * 60 * 60_000
let lastChangeAt = Date.now()
let nudges = 0
let lastNudgeAt = 0

while (Date.now() - startedAt < DEADLINE_MS) {
  await sleep(POLL_MS)
  const snap = await state()
  if (!snap) continue
  const proj = snap.projects.find((p) => p.id === project.id)
  if (!proj) { log('project missing'); continue }
  const tasks = snap.tasks.filter((t) => t.projectId === project.id)
  const by = {}
  for (const t of tasks) by[t.status] = (by[t.status] ?? 0) + 1
  const run = snap.runs.find((r) => r.status === 'running' && r.projectId === project.id)
  const signature = JSON.stringify([proj.status, proj.progress, by, run?.kind, run?.sessionId])
  if (signature !== lastSignature) {
    const now = Date.now()
    log(`phase ${phaseStart.label} took ${((now - phaseStart.t) / 60_000).toFixed(1)}min | now: ${proj.status} ${proj.progress}% run=${run?.kind ?? 'idle'} tasks=${JSON.stringify(by)}`)
    phaseStart = { t: now, label: run ? `${run.kind}@${(run.sessionId ?? '').slice(0, 8)}` : 'idle' }
    lastSignature = signature
    lastChangeAt = now
  }
  if (proj.status === 'completed') { log(`PROJECT COMPLETED in ${((Date.now() - startedAt) / 60_000).toFixed(1)}min total`); break }

  const idleFor = Date.now() - Math.max(lastChangeAt, lastNudgeAt)
  if (!run && nudges < 8 && idleFor > 90_000) {
    nudges += 1
    lastNudgeAt = Date.now()
    const blocked = tasks.find((t) => t.status === 'blocked')
    try {
      if (blocked) { log(`nudge ${nudges}: runTask retry on blocked "${blocked.title}"`); await evaluate(`window.ndDshOrganization.runTask(${JSON.stringify(blocked.id)})`) }
      else { log(`nudge ${nudges}: runNext`); await evaluate(`window.ndDshOrganization.runNext(${JSON.stringify(project.id)})`) }
    } catch (error) { log(`nudge failed: ${error.message.split('\n')[0]}`) }
  }
  if (Date.now() - lastChangeAt > STALL_MS) { log('STALL guard tripped'); break }
}
log('round3 exit')
ws.close()
logStream.end()
