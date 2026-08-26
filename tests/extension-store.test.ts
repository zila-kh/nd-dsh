import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionStore } from '../src/main/extensions/extension-store.js'
import type { AgentExtensionManifest } from '../src/shared/extensions.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<{ root: string; file: string; value: ExtensionStore }> {
  const root = await mkdtemp(join(tmpdir(), 'nd-ext-'))
  roots.push(root)
  const file = join(root, 'agent-extensions.json')
  return { root, file, value: new ExtensionStore(file) }
}

function customPlugin(id = 'custom-counter-plugin'): AgentExtensionManifest {
  return {
    id,
    name: 'Custom Counter Plugin',
    description: 'test extension',
    surface: 'plugin',
    version: '1.0.0',
    enabled: true,
    instructions: 'Keep counter state in ND.',
    runtime: {
      kind: 'mcp-stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { GITHUB_TOKEN: 'GITHUB_TOKEN' },
    },
    engineRoutes: [{ engineId: 'codex-cli', adapter: 'nd-proxy' }],
    providerRoutes: [{ providerId: 'deepseek-official', enabled: true }],
  }
}

describe('ExtensionStore', () => {
  it('seeds every built-in demo on an empty profile', async () => {
    const { value } = await store()
    const items = await value.list()
    expect(items.filter((item) => item.builtInDemo)).toHaveLength(7)
    expect(items.every((item) => item.enabled === false)).toBe(true)
  })

  it('publishes stable runtime references without storing secret values', async () => {
    const { file } = await store()
    expect(process.env.ND_EXTENSION_CATALOG).toBe(file)
    expect(process.env.ND_EXTENSION_PROXY).toMatch(/nd-extension-runtime\.mjs$/)
    expect(process.env.ND_DSH_EXTENSION_MCP_ENTRY).toMatch(/nd-extension-mcp\.mjs$/)
  })

  it('persists custom manifests, MCP runtime, and routes across store instances', async () => {
    const { file, value } = await store()
    await value.save(customPlugin())
    const reopened = new ExtensionStore(file)
    const item = (await reopened.list()).find((entry) => entry.id === 'custom-counter-plugin')
    expect(item?.instructions).toBe('Keep counter state in ND.')
    expect(item?.runtime).toEqual({
      kind: 'mcp-stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { GITHUB_TOKEN: 'GITHUB_TOKEN' },
    })
    expect(item?.engineRoutes).toEqual([{ engineId: 'codex-cli', adapter: 'nd-proxy' }])
    expect(item?.providerRoutes).toEqual([{ providerId: 'deepseek-official', enabled: true }])
  })

  it('stores only environment-variable references for executable transports', async () => {
    const { value } = await store()
    process.env.TEST_SECRET_VALUE = 'do-not-persist-this-value'
    const plugin = customPlugin('custom-env-plugin')
    plugin.runtime = {
      kind: 'mcp-stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { CHILD_TOKEN: 'TEST_SECRET_VALUE' },
    }
    const saved = (await value.save(plugin)).find((item) => item.id === plugin.id)
    expect(saved?.runtime?.env).toEqual({ CHILD_TOKEN: 'TEST_SECRET_VALUE' })
    expect(JSON.stringify(saved)).not.toContain('do-not-persist-this-value')
  })

  it('rejects invalid executable runtime environment references', async () => {
    const { value } = await store()
    const plugin = customPlugin('custom-bad-env')
    plugin.runtime = {
      kind: 'mcp-stdio',
      command: 'node',
      args: [],
      env: { TOKEN: 'literal secret value' },
    }
    await expect(value.save(plugin)).rejects.toThrow(/environment-variable names/i)
  })

  it('rejects executable MCP transports on non-tool surfaces', async () => {
    const { value } = await store()
    const memory: AgentExtensionManifest = {
      ...customPlugin('custom-memory-runtime'),
      surface: 'memory',
    }
    await expect(value.save(memory)).rejects.toThrow(/only for MCP and plugin/i)
  })

  it('lets users change demo routing but preserves product-owned demo identity', async () => {
    const { value } = await store()
    const demo = (await value.list()).find((item) => item.id === 'demo-counter-mcp')!
    await value.save({
      ...demo,
      name: 'Attempted rename',
      description: 'Attempted replacement',
      enabled: true,
      engineRoutes: [{ engineId: 'codex-cli', adapter: 'nd-proxy' }],
    })
    const saved = (await value.list()).find((item) => item.id === demo.id)!
    expect(saved.name).toBe('Counter MCP Demo')
    expect(saved.enabled).toBe(true)
    expect(saved.engineRoutes).toEqual([{ engineId: 'codex-cli', adapter: 'nd-proxy' }])
  })

  it('reset restores demos without deleting custom extensions', async () => {
    const { value } = await store()
    await value.save(customPlugin())
    const demo = (await value.list()).find((item) => item.id === 'demo-counter-hook')!
    await value.save({ ...demo, enabled: true })
    const reset = await value.resetDemos()
    expect(reset.find((item) => item.id === 'demo-counter-hook')?.enabled).toBe(false)
    expect(reset.find((item) => item.id === 'custom-counter-plugin')).toBeDefined()
  })

  it('does not delete built-in demos', async () => {
    const { value } = await store()
    await expect(value.remove('demo-counter-plugin')).rejects.toThrow(/cannot be deleted/i)
  })
})
