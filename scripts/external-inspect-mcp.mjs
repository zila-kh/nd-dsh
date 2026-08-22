#!/usr/bin/env node
/**
 * ND-DSH external-app inspect MCP server.
 *
 * Mounts the cross-app inspector as agent tools through the same
 * dsh-mcp-client stdio pattern as the browser pane. The agent can attach to
 * an Electron app launched with --remote-debugging-port and inspect it:
 *
 *   external_app_list      — inspectable page targets on the debug port
 *   external_app_snapshot  — compact DOM/a11y tree of the target page
 *   external_app_eval      — evaluate an expression in the target page
 *
 * Loopback-only by construction: the CDP port must already be listening on
 * 127.0.0.1; this server never opens anything else.
 */

const DEFAULT_PORT = Number(process.env.ND_DSH_EXTERNAL_CDP_PORT) > 1024
  ? Number(process.env.ND_DSH_EXTERNAL_CDP_PORT)
  : 9333
const EVAL_TIMEOUT_MS = 20_000

// ── CDP plumbing ─────────────────────────────────────────────────────────────

async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`debug port answered HTTP ${response.status}`)
  const targets = await response.json()
  return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
}

class CdpSession {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (typeof message.id !== 'number') return
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message ?? 'CDP error'))
      else entry.resolve(message.result)
    })
  }

  static async open(url) {
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener('open', () => resolve(new CdpSession(socket)), { once: true })
      socket.addEventListener('error', () => reject(new Error('could not attach to the debugger socket')), { once: true })
    })
  }

  async send(method, params = {}) {
    const id = this.nextId++
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try { this.socket.close() } catch { /* gone */ }
  }
}

async function withPageTarget(port, run) {
  const targets = await listTargets(port)
  if (targets.length === 0) throw new Error('the debug port exposed no inspectable page target')
  const target = targets[0]
  const session = await CdpSession.open(target.webSocketDebuggerUrl)
  try {
    return await run(session, target)
  } finally {
    session.close()
  }
}

async function evaluateInPage(port, expression, awaitPromise = true) {
  return await withPageTarget(port, async (session) => {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      timeout: EVAL_TIMEOUT_MS,
    })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluation failed'
      throw new Error(String(detail).slice(0, 600))
    }
    return result.result?.value ?? null
  })
}

// ── Tool implementations ─────────────────────────────────────────────────────

async function toolList(port) {
  const targets = await listTargets(port)
  if (targets.length === 0) throw new Error('the debug port exposed no inspectable page target')
  return targets.map((target) => ({ title: target.title ?? '', url: target.url ?? '' }))
}

const SNAPSHOT_EXPRESSION = `(() => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TITLE'])
  const MAX_NODES = 250
  const MAX_DEPTH = 9
  const lines = []
  let count = 0
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label')
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    return (aria || text || '').slice(0, 60)
  }
  const walk = (el, depth) => {
    if (count >= MAX_NODES || depth > MAX_DEPTH) return
    if (SKIP.has(el.tagName)) return
    count += 1
    const parts = [el.tagName.toLowerCase()]
    if (el.id) parts.push('#' + el.id)
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\\s+/)[0] : ''
    if (cls) parts.push('.' + cls)
    const role = el.getAttribute('role')
    if (role) parts.push('role=' + role)
    const testid = el.getAttribute('data-testid')
    if (testid) parts.push('testid=' + testid)
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) parts.push(Math.round(rect.width) + 'x' + Math.round(rect.height))
    const label = labelOf(el)
    lines.push('  '.repeat(depth) + parts.join(' ') + (label ? ' — "' + label + '"' : ''))
    for (const child of el.children) walk(child, depth + 1)
  }
  walk(document.body, 0)
  return JSON.stringify({ url: location.href, title: document.title, nodes: count, tree: lines.join('\\n') })
})()`

async function toolSnapshot(port) {
  const value = await evaluateInPage(port, SNAPSHOT_EXPRESSION)
  if (!value) throw new Error('the target page returned no snapshot')
  return value
}

async function toolEval(port, expression) {
  const value = await evaluateInPage(port, expression)
  return value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

// ── MCP stdio server ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'external_app_list',
    description: 'List inspectable windows of the external Electron app running with --remote-debugging-port. Returns page titles and URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: `Debug port (default ${DEFAULT_PORT})` },
      },
    },
  },
  {
    name: 'external_app_snapshot',
    description: 'Snapshot the external app page as a compact DOM tree with ids, classes, roles, sizes, and text labels. Read-only; use it to locate elements before acting.',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: `Debug port (default ${DEFAULT_PORT})` },
      },
    },
  },
  {
    name: 'external_app_eval',
    description: 'Evaluate a JavaScript expression inside the external app page (DevTools-console equivalent, awaited). Returns the JSON result. Use for reading framework state or probing elements; changes you make are real.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'JavaScript expression to evaluate in the page' },
        port: { type: 'number', description: `Debug port (default ${DEFAULT_PORT})` },
      },
      required: ['expression'],
    },
  },
]

function readPort(args) {
  const port = Number(args?.port)
  return Number.isInteger(port) && port >= 1024 && port < 65536 ? port : DEFAULT_PORT
}

async function dispatchTool(name, args) {
  const port = readPort(args)
  if (name === 'external_app_list') return { value: await toolList(port) }
  if (name === 'external_app_snapshot') return { value: await toolSnapshot(port) }
  if (name === 'external_app_eval') {
    const expression = typeof args?.expression === 'string' ? args.expression.trim() : ''
    if (!expression) throw new Error('expression is required')
    return { value: await toolEval(port, expression) }
  }
  throw new Error(`unknown tool: ${name}`)
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function runMcpServer() {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      let message
      try { message = JSON.parse(line) } catch { continue }
      handleMessage(message).catch((error) => {
        if (typeof message.id === 'number') {
          writeMessage({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: `tool error: ${error.message}` }] } })
        }
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

async function handleMessage(message) {
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nd-dsh-external-inspect', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })
    return
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    try {
      const { value } = await dispatchTool(name, message.params?.arguments)
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      writeMessage({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text }] } })
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: { isError: true, content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }] },
      })
    }
    return
  }
  if (typeof message.id === 'number') {
    writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
  }
}

if (process.argv[2] === 'mcp') {
  runMcpServer()
} else {
  console.error('usage: external-inspect-mcp.mjs mcp')
  process.exit(1)
}
