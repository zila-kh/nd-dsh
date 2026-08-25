#!/usr/bin/env node
/**
 * Zero-dependency MCP stdio server for the ND extension Counter example.
 *
 * This deliberately uses newline-delimited JSON-RPC because ND's extension
 * proxy speaks the same stdio framing. It is a real executable transport for
 * manual QA and automated tests; it does not require an API key or network.
 */

import { createInterface } from 'node:readline'

let counter = 0

const TOOLS = [
  {
    name: 'counter_get',
    description: 'Return the current Counter example value.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'counter_add',
    description: 'Add a finite number to the Counter example.',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'number' } },
      required: ['amount'],
    },
  },
  {
    name: 'counter_reset',
    description: 'Reset the Counter example to zero.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function text(value) {
  return { content: [{ type: 'text', text: String(value) }] }
}

function callTool(name, args) {
  if (name === 'counter_get') return text(counter)
  if (name === 'counter_reset') {
    counter = 0
    return text(counter)
  }
  if (name === 'counter_add') {
    const amount = Number(args?.amount)
    if (!Number.isFinite(amount)) {
      return { isError: true, content: [{ type: 'text', text: 'counter_add requires a finite numeric amount' }] }
    }
    counter += amount
    return text(counter)
  }
  return { isError: true, content: [{ type: 'text', text: `unknown tool: ${String(name)}` }] }
}

function handle(message) {
  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nd-counter-example', version: '1.0.0' },
      },
    })
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'ping') {
    write({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.method === 'tools/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } })
    return
  }
  if (message.method === 'tools/call') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: callTool(message.params?.name, message.params?.arguments),
    })
    return
  }
  if (message.id !== undefined) {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${String(message.method)}` } })
  }
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    handle(JSON.parse(trimmed))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  }
})
