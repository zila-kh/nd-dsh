import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentExtensionManifest } from '../src/shared/extensions.js'

const execFileAsync = promisify(execFile)
const proxy = resolve('scripts/nd-extension-runtime.mjs')
const server = resolve('examples/extension-counter/mcp-server.mjs')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-ext-example-'))
  roots.push(root)
  const catalog = join(root, 'agent-extensions.json')
  const state = join(root, 'agent-extension-state.json')
  const extension: AgentExtensionManifest = {
    id: 'example-counter-mcp',
    name: 'Example Counter MCP',
    description: 'real zero-dependency example server',
    surface: 'mcp',
    version: '1.0.0',
    enabled: true,
    instructions: 'Use the real example tools.',
    runtime: {
      kind: 'mcp-stdio',
      command: process.execPath,
      args: [server],
      env: {},
    },
    engineRoutes: [],
    providerRoutes: [],
  }
  await writeFile(catalog, `${JSON.stringify({ version: 1, extensions: [extension] }, null, 2)}\n`, 'utf8')
  return { catalog, state }
}

async function invoke(catalog: string, state: string, args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, [proxy, ...args], {
    env: { ...process.env, ND_EXTENSION_CATALOG: catalog, ND_EXTENSION_STATE: state },
    timeout: 15_000,
  })
  return JSON.parse(stdout) as unknown
}

describe('Counter MCP example', () => {
  it('discovers its real MCP tool contract through the universal proxy', async () => {
    const { catalog, state } = await fixture()
    const tools = await invoke(catalog, state, ['list', 'example-counter-mcp', 'codex-cli']) as Array<{ name: string }>
    expect(tools.map((tool) => tool.name)).toEqual(['counter_get', 'counter_add', 'counter_reset'])
  })

  it('runs reset, +3, +4, get through the real MCP child process', async () => {
    const { catalog, state } = await fixture()
    // The example MCP process itself is intentionally stateless between proxy
    // invocations, so exercise each independent call and prove the protocol
    // bridge returns native MCP content. Durable cross-call state is separately
    // covered by the built-in ND Counter transport tests.
    const reset = await invoke(catalog, state, ['call', 'example-counter-mcp', 'counter_reset', '{}', 'codex-cli']) as { content: Array<{ text: string }> }
    const plus3 = await invoke(catalog, state, ['call', 'example-counter-mcp', 'counter_add', '{"amount":3}', 'codex-cli']) as { content: Array<{ text: string }> }
    const plus4 = await invoke(catalog, state, ['call', 'example-counter-mcp', 'counter_add', '{"amount":4}', 'codex-cli']) as { content: Array<{ text: string }> }
    const get = await invoke(catalog, state, ['call', 'example-counter-mcp', 'counter_get', '{}', 'codex-cli']) as { content: Array<{ text: string }> }
    expect(reset.content[0]?.text).toBe('0')
    expect(plus3.content[0]?.text).toBe('3')
    expect(plus4.content[0]?.text).toBe('4')
    expect(get.content[0]?.text).toBe('0')
  })
})
