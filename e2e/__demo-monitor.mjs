/* One-off demo monitor: polls org state over raw CDP and logs progress until
   both demo projects finish or a guard trips. */
import { createWriteStream, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUN_ROOT = join(tmpdir(), 'nd-dsh-demo-monitor')
mkdirSync(RUN_ROOT, { recursive: true })
const logStream = createWriteStream(join(RUN_ROOT, 'monitor.log'), { flags: 'a' })
function log(line) {
  const text = `[${new Date().toISOString().slice(11, 19)}] ${line}`
  console.log(text)
  logStream.write(`${text}\n`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error('renderer page not found — is the dev app still running?')
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
async function runNext(projectId) {
  try { log(`runNext -> ${await evaluate(`window.ndDshOrganization.runNext(${JSON.stringify(projectId)}).then(v => JSON.stringify(v))`)}`) } catch (error) { log(`runNext failed: ${error.message.split('\n')[0]}`) }
}

const PROJECT_IDS = ['7c2491bd-03bd-4e1c-871e-934079145d8e', 'dbfb93b2-0aa7-42c7-bf38-d1ceded87f18']
const POLL_MS = 30_000
const IDLE_NUDGE_MS = 90_000
const MAX_NUDGES = 12
const STALL_MS = 45 * 60_000
const DEADLINE_MS = 4 * 60 * 60_000

const startedAt = Date.now()
let lastNudgeAt = 0
let nudges = 0
let lastSignature = ''
let lastChangeAt = Date.now()

while (Date.now() - startedAt < DEADLINE_MS) {
  await sleep(POLL_MS)
  const snap = await state()
  if (!snap) continue
  const activeRun = snap.runs.find((r) => r.status === 'running')
  const proj = (id) => snap.projects.find((p) => p.id === id)
  const tasksOf = (id) => snap.tasks.filter((t) => t.projectId === id)
  const byStatus = (tasks) => { const m = {}; for (const t of tasks) m[t.status] = (m[t.status] ?? 0) + 1; return m }
  const todo = proj(PROJECT_IDS[0])
  const ttt = proj(PROJECT_IDS[1])
  const signature = JSON.stringify([todo?.status, todo?.progress, ttt?.status, ttt?.progress, byStatus(tasksOf(PROJECT_IDS[0])), byStatus(tasksOf(PROJECT_IDS[1])), activeRun?.kind, activeRun?.sessionId])
  if (signature !== lastSignature) {
    lastSignature = signature
    lastChangeAt = Date.now()
    log(`todo=${todo?.status}:${todo?.progress}% ttt=${ttt?.status}:${ttt?.progress}% | run=${activeRun ? `${activeRun.kind}@${activeRun.sessionId.slice(0, 8)}` : 'idle'} | tasks=${JSON.stringify(byStatus([...tasksOf(PROJECT_IDS[0]), ...tasksOf(PROJECT_IDS[1])]))}`)
  }

  if (todo?.status === 'completed' && ttt?.status === 'completed') { log('BOTH PROJECTS COMPLETED'); break }

  const idleFor = Date.now() - Math.max(lastChangeAt, lastNudgeAt)
  if (!activeRun && nudges < MAX_NUDGES && idleFor > IDLE_NUDGE_MS) {
    const next = todo?.status !== 'completed'
      ? PROJECT_IDS[0]
      : PROJECT_IDS[1]
    const nextProj = proj(next)
    if (nextProj && ['active', 'planning'].includes(nextProj.status)) {
      nudges += 1
      lastNudgeAt = Date.now()
      log(`pipeline idle (nudge ${nudges}/${MAX_NUDGES}) — runNext on ${nextProj.name}`)
      await runNext(next)
    }
  }
  if (Date.now() - lastChangeAt > STALL_MS) { log('STALL guard tripped'); break }
}
log('monitor exit')
ws.close()
logStream.end()
