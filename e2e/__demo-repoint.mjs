/* One-off: wait until no task-execution is running, then immediately repoint
   the Tic-Tac-Toe project workspace to examples/tic-tac-toe over raw CDP. */
const PROJECT_ID = 'dbfb93b2-0aa7-42c7-bf38-d1ceded87f18'
const NEW_WS = 'C:/Users/MT-Staff/Documents/GitHub/nd-dsh/examples/tic-tac-toe'

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
const log = (line) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const deadline = Date.now() + 25 * 60_000
while (Date.now() < deadline) {
  const state = await evaluate('window.ndDshOrganization.state()')
  const running = state.runs.find((r) => r.status === 'running')
  if (running?.kind !== 'task-execution') {
    log(`execution phase over (run=${running ? running.kind : 'idle'}) — repointing workspace`)
    const mutation = { type: 'project.update', id: PROJECT_ID, patch: { workspacePath: NEW_WS } }
    try {
      await evaluate(`window.ndDshOrganization.mutate(${JSON.stringify(JSON.stringify(mutation))})`)
    } catch (error) {
      log(`mutate failed: ${error.message.split('\n')[0]}`)
      await sleep(5_000)
      continue
    }
    const after = await evaluate('window.ndDshOrganization.state()')
    const path = after.projects.find((p) => p.id === PROJECT_ID)?.workspacePath
    log(`workspace now: ${path}`)
    if (String(path).replaceAll('\\', '/') !== NEW_WS) throw new Error('workspace repoint did not stick')
    log('REPOINT OK')
    break
  }
  await sleep(10_000)
}
ws.close()
