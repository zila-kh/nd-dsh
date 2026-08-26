#!/usr/bin/env node
/**
 * Portable ND extension proxy.
 *
 * Modes:
 *   list <extension-id> <engine-id>
 *   call <extension-id> <tool-name> <json-args> <engine-id>
 *
 * ND Harness reaches this proxy through scripts/nd-extension-mcp.mjs. Engines
 * without MCP can invoke the same list/call interface through their shell.
 * Every invocation re-reads the durable catalog so enable/disable and per-
 * engine route changes are enforced without a runtime restart.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const CATALOG_PATH = process.env.ND_EXTENSION_CATALOG?.trim() ?? ''
const STATE_PATH = process.env.ND_EXTENSION_STATE?.trim() ?? ''
const REQUEST_TIMEOUT_MS = 30_000
const COUNTER_EXTENSION_IDS = new Set(['demo-counter-mcp', 'demo-counter-plugin'])
const ENGINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const SAFE_INHERITED_ENV = [
  'PATH', 'Path', 'PATHEXT',
  'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'TERM',
]

const COUNTER_TOOLS = [
  {
    name: 'counter_get',
    description: 'Return the current value of the ND Counter demo.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'counter_add',
    description: 'Add a finite number to the ND Counter demo and return the new value.',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number', description: 'Finite amount to add.' } },
      required: ['amount'],
    },
  },
  {
    name: 'counter_reset',
    description: 'Reset the ND Counter demo to zero and return 0.',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function readCatalog() {
  if (!CATALOG_PATH) throw new Error('ND_EXTENSION_CATALOG is not configured')
  try {
    const parsed = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'))
    if (parsed?.version !== 1 || !Array.isArray(parsed.extensions)) throw new Error('extension catalog has an unsupported schema')
    return parsed.extensions
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function engineId(value) {
  if (typeof value !== 'string' || !ENGINE_ID_PATTERN.test(value.trim())) throw new Error('a valid engine id is required')
  return value.trim()
}

function toolRouteAllowed(extension, targetEngineId) {
  const route = Array.isArray(extension.engineRoutes)
    ? extension.engineRoutes.find((item) => item?.engineId === targetEngineId)
    : undefined
  const adapter = route?.adapter ?? 'auto'
  return adapter === 'auto' || adapter === 'mcp' || adapter === 'nd-proxy' || adapter === 'native'
}

async function requireExtension(extensionId, targetEngineId) {
  const extension = (await readCatalog()).find((item) => item?.id === extensionId)
  if (!extension) throw new Error(`unknown extension: ${extensionId}`)
  if (extension.enabled !== true) throw new Error(`extension is disabled: ${extensionId}`)
  if (extension.surface !== 'mcp' && extension.surface !== 'plugin') throw new Error(`extension is not a tool extension: ${extensionId}`)
  if (!toolRouteAllowed(extension, targetEngineId)) throw new Error(`extension tool transport is disabled for engine ${targetEngineId}: ${extensionId}`)
  return extension
}

function isMcpRuntime(extension) {
  return extension?.runtime?.kind === 'mcp-stdio'
    && typeof extension.runtime.command === 'string'
    && extension.runtime.command.trim().length > 0
    && Array.isArray(extension.runtime.args)
    && extension.runtime.env
    && typeof extension.runtime.env === 'object'
    && !Array.isArray(extension.runtime.env)
}

async function listOne(extensionId, targetEngineId) {
  const extension = await requireExtension(extensionId, targetEngineId)
  if (COUNTER_EXTENSION_IDS.has(extensionId)) return COUNTER_TOOLS
  if (!isMcpRuntime(extension)) throw new Error(`extension has no MCP stdio runtime: ${extensionId}`)
  const result = await withMcpRuntime(extension, (client) => client.request('tools/list', {}))
  return Array.isArray(result?.tools) ? result.tools : []
}

async function callOne(extensionId, targetEngineId, tool, args) {
  const extension = await requireExtension(extensionId, targetEngineId)
  if (COUNTER_EXTENSION_IDS.has(extensionId)) return counterCall(tool, args)
  if (!isMcpRuntime(extension)) throw new Error(`extension has no MCP stdio runtime: ${extensionId}`)
  return withMcpRuntime(extension, (client) => client.request('tools/call', { name: tool, arguments: objectArgs(args) }))
}

function objectArgs(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

async function counterCall(tool, args) {
  if (tool === 'counter_get') return { content: [{ type: 'text', text: String(await readCounter()) }] }
  if (tool === 'counter_reset') {
    await updateCounter(() => 0)
    return { content: [{ type: 'text', text: '0' }] }
  }
  if (tool === 'counter_add') {
    const amount = Number(args?.amount)
    if (!Number.isFinite(amount)) throw new Error('counter_add requires a finite numeric amount')
    const next = await updateCounter((current) => current + amount)
    return { content: [{ type: 'text', text: String(next) }] }
  }
  throw new Error(`unknown Counter tool: ${tool}`)
}

async function readCounter() {
  const state = await readState()
  return Number.isFinite(state.counter) ? state.counter : 0
}

async function updateCounter(update) {
  if (!STATE_PATH) throw new Error('ND_EXTENSION_STATE is not configured')
  await fs.mkdir(dirname(STATE_PATH), { recursive: true })
  const release = await acquireLock(`${STATE_PATH}.lock`)
  try {
    const state = await readState()
    const current = Number.isFinite(state.counter) ? state.counter : 0
    const next = update(current)
    if (!Number.isFinite(next)) throw new Error('counter result must be finite')
    const payload = { version: 1, counter: next }
    const temp = `${STATE_PATH}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await fs.rename(temp, STATE_PATH)
    return next
  } finally {
    await release()
  }
}

async function readState() {
  if (!STATE_PATH) return { version: 1, counter: 0 }
  try {
    const value = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'))
    return value && typeof value === 'object' ? value : { version: 1, counter: 0 }
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error(`[nd-extensions] state read failed: ${error instanceof Error ? error.message : String(error)}`)
    return { version: 1, counter: 0 }
  }
}

async function acquireLock(path) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(path)
      return async () => { await fs.rmdir(path).catch(() => undefined) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error('timed out waiting for extension state lock')
}

class JsonLineMcpClient {
  constructor(child, label) {
    this.child = child
    this.label = label
    this.id = 0
    this.pending = new Map()
    this.closed = false
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => this.onLine(line))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => process.stderr.write(`[nd-extension:${label}] ${chunk}`))
    child.once('error', (error) => this.fail(error))
    child.once('exit', (code, signal) => {
      if (!this.closed) this.fail(new Error(`${label} MCP process exited (${signal ?? String(code ?? 'unknown')})`))
    })
  }

  fail(error) {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  onLine(line) {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message?.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message ?? 'MCP request failed'))
    else pending.resolve(message.result)
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error(`${this.label} MCP process is closed`))
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.label} MCP ${method} timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  notify(method, params = {}) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  close() {
    this.closed = true
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear()
    try { this.child.stdin.end() } catch { /* gone */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try { this.child.kill() } catch { /* gone */ }
    }
  }
}

async function withMcpRuntime(extension, run) {
  if (!isMcpRuntime(extension)) throw new Error(`${extension.id} has no MCP stdio runtime`)
  const runtime = extension.runtime
  const child = spawn(runtime.command, runtime.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnvironment(runtime.env),
    cwd: process.cwd(),
    windowsHide: true,
  })
  const client = new JsonLineMcpClient(child, extension.id)
  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'nd-extension-router', version: '1.0.0' },
    })
    client.notify('notifications/initialized')
    return await run(client)
  } finally {
    client.close()
  }
}

function childEnvironment(references) {
  const env = {}
  for (const key of SAFE_INHERITED_ENV) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  for (const [target, source] of Object.entries(references)) {
    const value = process.env[source]
    if (value === undefined) throw new Error(`required environment variable is missing: ${source}`)
    env[target] = value
  }
  return env
}

function parseJsonArgs(raw) {
  if (raw === undefined) return {}
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('arguments must be a JSON object') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('arguments must be a JSON object')
  return parsed
}

async function main() {
  const [mode, extensionId, toolName, rawArgs, trailingEngineId] = process.argv.slice(2)
  if (mode === 'list') {
    const targetEngineId = engineId(toolName)
    if (!extensionId) throw new Error('usage: nd-extension-runtime.mjs list <extension-id> <engine-id>')
    process.stdout.write(`${JSON.stringify(await listOne(extensionId, targetEngineId), null, 2)}\n`)
    return
  }
  if (mode === 'call') {
    if (!extensionId || !toolName) throw new Error('usage: nd-extension-runtime.mjs call <extension-id> <tool-name> <json-args> <engine-id>')
    const targetEngineId = engineId(trailingEngineId)
    process.stdout.write(`${JSON.stringify(await callOne(extensionId, targetEngineId, toolName, parseJsonArgs(rawArgs)), null, 2)}\n`)
    return
  }
  throw new Error('usage: nd-extension-runtime.mjs <list|call> ...')
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
