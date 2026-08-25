import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { cloneBuiltinExtensionDemos } from '../src/shared/extensions.js'

const execFileAsync = promisify(execFile)
const roots: string[] = []

const proxyScript = resolve('scripts/nd-extension-runtime.mjs')
const mcpScript = resolve('scripts/nd-extension-mcp.mjs')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function enabledCounterCatalog() {
  const root = await mkdtemp(join(tmpdir(), 'nd-ext-proxy-'))
  roots.push(root)
  const catalog = join(root, 'agent-extensions.json')
  const state = join(root, 'agent-extension-state.json')
  const demos = cloneBuiltinExtensionDemos()
  const counter = demos.find((item) => item.id === 'demo-counter-mcp')!
  counter.enabled = true
  await writeFile(catalog, `${JSON.stringify({ version: 1, extensions: demos }, null, 2)}\n`, 'utf8')
  return { root, catalog, state }
}

async function runProxy(catalog: string, state: string, args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [proxyScript, ...args], {
    env: { ...process.env, ND_EXTENSION_CATALOG: catalog, ND_EXTENSION_STATE: state },
    timeout: 15_000,
  })
  return JSON.parse(stdout) as unknown
}

describe('ND extension portable runtime', () => {
  it('lists the built-in Counter MCP contract', async () => {
    const { catalog, state } = await enabledCounterCatalog()
    const tools = await runProxy(catalog, state, ['list', 'demo-counter-mcp']) as Array<{ name: string }>
    expect(tools.map((tool) => tool.name)).toEqual(['counter_get', 'counter_add', 'counter_reset'])
  })

  it('executes reset +3 +4 get through the same persisted counter state', async () => {
    const { catalog, state } = await enabledCounterCatalog()
    await runProxy(catalog, state, ['call', 'demo-counter-mcp', 'counter_reset', '{}'])
    await runProxy(catalog, state, ['call', 'demo-counter-mcp', 'counter_add', '{"amount":3}'])
    await runProxy(catalog, state, ['call', 'demo-counter-mcp', 'counter_add', '{"amount":4}'])
    const result = await runProxy(catalog, state, ['call', 'demo-counter-mcp', 'counter_get', '{}']) as { content: Array<{ text: string }> }
    expect(result.content[0]?.text).toBe('7')
  })

  it('refuses tool execution after an extension is disabled in the catalog', async () => {
    const { catalog, state } = await enabledCounterCatalog()
    const snapshot = JSON.parse(await (await import('node:fs/promises')).readFile(catalog, 'utf8')) as { extensions: Array<{ id: string; enabled: boolean }> }
    const counter = snapshot.extensions.find((item) => item.id === 'demo-counter-mcp')!
    counter.enabled = false
    await writeFile(catalog, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await expect(runProxy(catalog, state, ['call', 'demo-counter-mcp', 'counter_get', '{}'])).rejects.toThrow(/disabled/i)
  })

  it('keeps the Harness MCP tool catalog stable while extensions change underneath it', async () => {
    const { catalog, state } = await enabledCounterCatalog()
    const child = spawn(process.execPath, [mcpScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ND_EXTENSION_NODE: process.execPath,
        ND_EXTENSION_PROXY: proxyScript,
        ND_EXTENSION_CATALOG: catalog,
        ND_EXTENSION_STATE: state,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
    child.stdin.end()
    await new Promise<void>((resolveExit, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('MCP gateway did not exit')) }, 10_000)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolveExit()
        else reject(new Error(stderr || `gateway exited ${String(code)}`))
      })
    })
    const replies = stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } })
    const names = replies.find((reply) => reply.id === 2)?.result?.tools?.map((tool) => tool.name)
    expect(names).toEqual(['nd_extension_list', 'nd_extension_call'])
  })
})
