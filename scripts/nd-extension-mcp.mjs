#!/usr/bin/env node
/**
 * Stable MCP gateway for ND universal extensions.
 *
 * The tool catalog never changes, so enabling/disabling an extension does not
 * require a Harness restart. `nd_extension_list` and `nd_extension_call`
 * delegate to the portable proxy runtime, which reads the durable catalog on
 * every invocation and resolves built-in demos or custom MCP stdio processes.
 */

import { spawn } from 'node:child_process'

const NODE = process.env.ND_EXTENSION_NODE?.trim() || process.execPath
const PROXY = process.env.ND_EXTENSION_PROXY?.trim() || process.env.ND_DSH_EXTENSION_PROXY_ENTRY?.trim() || ''
const TIMEOUT_MS = 120_000
const HARNESS_ENGINE_ID = 'nd-harness'

const TOOLS = [
  {
    name: 'nd_extension_list',
    description: 'List the tool schema for one enabled ND MCP/plugin extension. Use this before nd_extension_call when you do not already know the extension tool names.',
    inputSchema: {
      type: 'object',
      properties: {
        extensionId: { type: 'string', description: 'ND extension id from the trusted extension context.' },
      },
      required: ['extensionId'],
    },
  },
  {
    name: 'nd_extension_call',
    description: 'Call one tool on an enabled ND MCP/plugin extension through the universal extension router.',
    inputSchema: {
      type: 'object',
      properties: {
        extensionId: { type: 'string', description: 'ND extension id from the trusted extension context.' },
        toolName: { type: 'string', description: 'Raw tool name returned by nd_extension_list.' },
        arguments: { type: 'object', description: 'Tool arguments.' },
      },
      required: ['extensionId', 'toolName'],
    },
  },
]

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function cleanId(value, label) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,127}$/.test(value.trim())) throw new Error(`${label} is invalid`)
  return value.trim()
}

function cleanTool(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('toolName is invalid')
  return value.trim()
}

async function runProxy(args) {
  if (!PROXY) throw new Error('ND extension proxy entry is not configured')
  return await new Promise((resolve, reject) => {
    const child = spawn(NODE, [PROXY, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* gone */ }
      reject(new Error('ND extension proxy timed out'))
    }, TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000) })
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 32_000) stderr = stderr.slice(-32_000) })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `extension proxy exited (${signal ?? String(code)})`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('extension proxy returned invalid JSON'))
      }
    })
  })
}

async function dispatch(name, args) {
  if (name === 'nd_extension_list') {
    const extensionId = cleanId(args?.extensionId, 'extensionId')
    return { mode: 'list', value: await runProxy(['list', extensionId, HARNESS_ENGINE_ID]) }
  }
  if (name === 'nd_extension_call') {
    const extensionId = cleanId(args?.extensionId, 'extensionId')
    const toolName = cleanTool(args?.toolName)
    const input = args?.arguments && typeof args.arguments === 'object' && !Array.isArray(args.arguments) ? args.arguments : {}
    return { mode: 'call', value: await runProxy(['call', extensionId, toolName, JSON.stringify(input), HARNESS_ENGINE_ID]) }
  }
  throw new Error(`unknown tool: ${name}`)
}

function normalizeCallResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.content)) {
    return {
      content: value.content,
      ...(value.isError === true ? { isError: true } : {}),
      ...(value.structuredContent && typeof value.structuredContent === 'object' ? { structuredContent: value.structuredContent } : {}),
    }
  }
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

async function handleMessage(message) {
  if (message.method === 'initialize') {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
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
    writeMessage({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })
    return
  }
  if (message.method === 'tools/call') {
    try {
      const dispatched = await dispatch(message.params?.name, message.params?.arguments)
      const result = dispatched.mode === 'call'
        ? normalizeCallResult(dispatched.value)
        : { content: [{ type: 'text', text: JSON.stringify(dispatched.value, null, 2) }] }
      writeMessage({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: { isError: true, content: [{ type: 'text', text: `error: ${error instanceof Error ? error.message : String(error)}` }] },
      })
    }
    return
  }
  if (message.id !== undefined) writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } })
}

function run() {
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
      void handleMessage(message).catch((error) => {
        if (message.id !== undefined) writeMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
      })
    }
  })
  process.stdin.on('end', () => process.exit(0))
}

run()
