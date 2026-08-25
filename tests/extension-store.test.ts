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

  it('persists custom manifests and routes across store instances', async () => {
    const { file, value } = await store()
    await value.save(customPlugin())
    const reopened = new ExtensionStore(file)
    const item = (await reopened.list()).find((entry) => entry.id === 'custom-counter-plugin')
    expect(item?.instructions).toBe('Keep counter state in ND.')
    expect(item?.engineRoutes).toEqual([{ engineId: 'codex-cli', adapter: 'nd-proxy' }])
    expect(item?.providerRoutes).toEqual([{ providerId: 'deepseek-official', enabled: true }])
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
