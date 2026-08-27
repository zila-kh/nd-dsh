/* One-off helpers: talk to the running dev app over raw loopback CDP.
   Usage: node e2e/__demo-state.mjs [state|run PROJECT_ID|runTask TASK_ID] */
const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:5173'))
if (!page) throw new Error(`renderer page not found; targets: ${targets.map((t) => `${t.type}:${t.url}`).join(', ')}`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject) })

let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id !== undefined && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})

async function evaluate(expression) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const reply = await new Promise((resolve) => pending.set(id, resolve))
  if (reply.error) throw new Error(reply.error.message)
  if (reply.result?.exceptionDetails) {
    throw new Error(reply.result.exceptionDetails.exception?.description ?? 'evaluate failed')
  }
  return reply.result?.result?.value
}

const [, , action = 'state', targetId] = process.argv
switch (action) {
  case 'state': {
    const state = await evaluate('window.ndDshOrganization.state()')
    console.log(JSON.stringify({
      companies: state.companies,
      projects: state.projects.map((p) => ({ id: p.id, name: p.name, status: p.status, progress: p.progress, workspacePath: p.workspacePath })),
      goals: state.goals.map((g) => ({ id: g.id, projectId: g.projectId, title: g.title ?? g.name, status: g.status })),
      tasks: state.tasks.map((t) => ({ id: t.id, projectId: t.projectId, title: t.title, status: t.status })),
      runs: state.runs.map((r) => ({ id: r.id, projectId: r.projectId, kind: r.kind, status: r.status, sessionId: r.sessionId })),
    }, null, 2))
    break
  }
  case 'run': {
    console.log(await evaluate(`window.ndDshOrganization.runNext(${JSON.stringify(targetId)}).then(v => JSON.stringify(v)).catch(e => { throw new Error(e.message ?? String(e)) })`))
    break
  }
  case 'runTask': {
    console.log(await evaluate(`window.ndDshOrganization.runTask(${JSON.stringify(targetId)}).then(v => JSON.stringify(v)).catch(e => { throw new Error(e.message ?? String(e)) })`))
    break
  }
  case 'mutate': {
    const mutation = JSON.parse(process.argv[3])
    console.log(JSON.stringify(await evaluate(`window.ndDshOrganization.mutate(${JSON.stringify(mutation)})`)))
    break
  }
  default:
    throw new Error(`unknown action: ${action}`)
}
ws.close()
