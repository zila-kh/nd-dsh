#!/usr/bin/env node
/**
 * ND universal extension transport.
 *
 * Modes:
 *   mcp                         expose every enabled MCP/plugin extension to ND Harness
 *   list <extension-id>         list one extension's portable tools (shell fallback)
 *   call <extension-id> <tool> [json-args]
 *
 * Custom MCP processes come from agent-extensions.json. Environment config is
 * reference-only: persisted values name parent variables; secret values never
 * enter the extension catalog. Built-in Counter MCP/Plugin demos are handled
 * directly here so they work without an external account or package install.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'

const CATALOG_PATH = process.env.ND_EXTENSION_CATALOG?.trim() ?? ''
const STATE_PATH = process.env.ND_EXTENSION_STATE?.trim() ?? ''
const REQUEST_TIMEOUT_MS = 30_000
const CACHE_MS = 5_000
const COUNTER_EXTENSION_IDS = new Set(['demo-counter-mcp', 'demo-counter-plugin'])

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

let toolsCache = { at: 0, tools: [], routes: new Map() }

async function readCatalog() {
  if (!CATALOG_PATH) return []
  try {
    const parsed = JSON.parse(await fs.readFile(CATALOG_PATH, 'utf8'))
    return parsed?.version === 1 && Array.isArray(parsed.extensions) ? parsed.extensions : []
  } catch (error) {
    if (error?.code !== 'ENOENT') console.error(`[nd-extensions] catalog read failed: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

function isEnabledToolExtension(extension) {
  if (!extension || extension.enabled !== true) return false
  if (extension.surface !== 'mcp' && extension.surface !== 'plugin') return false
  const harnessRoute = Array.isArray(extension.engineRoutes)
    ? extension.engineRoutes.find((route) => route?.engineId === 'nd-harness')
    : undefined
  return harnessRoute?.adapter !== 'disabled'
}

function isMcpRuntime(extension) {
  return extension?.runtime?.kind === 'mcp-stdio'
    && typeof extension.runtime.command === 'string'
    && extension.runtime.command.trim().length > 0
    && Array.isArray(extension.runtime.args)
    && extension.runtime.env
    && typeof extension.runtime.env === 'object'
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_]/g, '_')
}

async function discoverTools(force = false) {
  if (!force && Date.now() - toolsCache.at < CACHE_MS) return toolsCache
  const extensions = (await readCatalog()).filter(isEnabledToolExtension)
  const tools = []
  const routes = new Map()
  if (extensions.some((extension) => COUNTER_EXTENSION_IDS.has(extension.id))) {
    tools.push(...COUNTER_TOOLS)
    for (const tool of COUNTER_TOOLS) routes.set(tool.name, { kind: 'counter', tool: tool.name })
  }

  for (const extension of extensions) {
    if (!isMcpRuntime(extension)) continue
    try {
      const remoteTools = await withMcpRuntime(extension, (client) => client.request('tools/list', {}))
      for (const tool of Array.isArray(remoteTools?.tools) ? remoteTools.tools : []) {
        if (!tool || typeof tool.name !== 'string' || !tool.name.trim()) continue
        const exposedName = `ext_${safeId(extension.id)}__${safeId(tool.name)}`
        tools.push({
          name: exposedName,
          description: `[${extension.name ?? extension.id}] ${typeof tool.description === 'string' ? tool.description : tool.name}`.slice(0, 2_000),
          inputSchema: validSchema(tool.inputSchema),
        })
        routes.set(exposedName, { kind: 'external', extension, tool: tool.name })
      }
    } catch (error) {
      console.error(`[nd-extensions] ${extension.id} tool discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  toolsCache = { at: Date.now(), tools, routes }
  return toolsCache
}

function validSchema(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { type: 'object', properties: {} }
}

async function dispatchTool(name, args) {
  const discovered = await discoverTools()
  let route = discovered.routes.get(name)
  if (!route) route = (await discoverTools(true)).routes.get(name)
  if (!route) throw new Error(`unknown or disabled extension tool: ${name}`)
  if (route.kind === 'counter') return counterCall(route.tool, args)
  return withMcpRuntime(route.extension, (client) => client.request('tools/call', { name: route.tool, arguments: objectArgs(args) }))
}

async function listOne(extensionId) {
  const extension = (await readCatalog()).find((item) => item?.id === extensionId)
  if (!extension) throw new Error(`unknown extension: ${extensionId}`)
  if (!isEnabledToolExtension(extension)) throw new Error(`extension is disabled or is not a tool extension: ${extensionId}`)
  if (COUNTER_EXTENSION_IDS.has(extensionId)) return COUNTER_TOOLS
  if (!isMcpRuntime(extension)) throw new Error(`extension has no MCP stdio runtime: ${extensionId}`)
  const result = await withMcpRuntime(extension, (client) => client.request('tools/list', {}))
  return Array.isArray(result?.tools) ? result.tools : []
}

async function callOne(extensionId, tool, args) {
  const extension = (await readCatalog()).find((item) => item?.id === extensionId)
  if (!extension) throw new Error(`unknown extension: ${extensionId}`)
  if (!isEnabledToolExtension(extension)) throw new Error(`extension is disabled or is not a tool extension: ${extensionId}`)
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
    await writeCounter(0)
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

async function writeCounter(value) {
  return updateCounter(() => value)
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
    child.once('exit', (code, signal) => {
      this.closed = true
      const error = new Error(`${label} MCP process exited (${signal ?? String(code ?? 'unknown')})`)
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    })
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
    try { this.child.stdin.end() } catch { /* gone */ }
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try { this.child.kill() } catch { /* gone */ }
    }
  }
}

async function withMcpRuntime(extension, run) {
  const runtime = extension.runtime
  if (!isMcpRuntime(extension)) throw new Error(`${extension.id} has no MCP stdio runtime`)
  const env = { ...process.env }
  for (const [target, source] of Object.entries(runtime.env)) {
    const value = process.env[source]
    if (value !== undefined) env[target] = value
    else delete env[target]
  }
  const child = spawn(runtime.command, runtime.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
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

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handleMcpMessage(message) {
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0', id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'nd-extensions', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'ping') {
    writeMessage({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.method === 'tools/list') {
    const { tools } = await discoverTools(true)
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { tools } })
    return
  }
  if (message.method === 'tools/call') {
    try {
      const result = await dispatchTool(message.params?.name, message.params?.arguments)
      writeMessage({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0', id: message.id,
        result: { isError: true, content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }] },
      })
    }
    return
  }
  if (message.id !== undefined) writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
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
      void handleMcpMessage(message).catch((error) => {
        if (message.id !== undefined) writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

function parseJsonArgs(raw) {
  if (raw === undefined) return {}
  let parsed
  try { parsed = JSON.parse(raw) } catch { throw new Error('arguments must be a JSON object') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('arguments must be a JSON object')
  return parsed
}

async function main() {
  const [mode, extensionId, toolName, rawArgs] = process.argv.slice(2)
  if (mode === 'mcp') {
    runMcpServer()
    return
  }
  if (mode === 'list') {
    if (!extensionId) throw new Error('usage: nd-extension-runtime.mjs list <extension-id>')
    process.stdout.write(`${JSON.stringify(await listOne(extensionId), null, 2)}\n`)
    return
  }
  if (mode === 'call') {
    if (!extensionId || !toolName) throw new Error('usage: nd-extension-runtime.mjs call <extension-id> <tool-name> [json-args]')
    process.stdout.write(`${JSON.stringify(await callOne(extensionId, toolName, parseJsonArgs(rawArgs)), null, 2)}\n`)
    return
  }
  throw new Error('usage: nd-extension-runtime.mjs <mcp|list|call> ...')
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
