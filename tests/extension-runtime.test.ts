import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CodingEngineDescriptor, ModelProvider } from '../src/shared/contracts.js'
import { ExtensionDemoService } from '../src/main/extensions/extension-demo-service.js'
import { ExtensionRouter } from '../src/main/extensions/extension-router.js'
import { ExtensionStore } from '../src/main/extensions/extension-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const harness: CodingEngineDescriptor = {
  id: 'nd-harness', name: 'ND Harness', integration: 'primary', available: true, description: 'test',
  capabilities: {
    workspace: true, filesystem: true, shell: true, browser: true, skills: true, mcp: true,
    modelProviderRouting: true, humanApprovals: true, streaming: true, persistentSessions: true,
  },
}

const codex: CodingEngineDescriptor = {
  ...harness,
  id: 'codex-cli',
  name: 'Codex CLI',
  capabilities: { ...harness.capabilities, skills: false, mcp: false, modelProviderRouting: false },
}

const providers: ModelProvider[] = [
  { id: 'deepseek-official', name: 'DeepSeek', enabled: true, baseUrl: '', apiFormat: 'openai', apiKey: '', models: [] },
  { id: 'openai', name: 'OpenAI', enabled: true, baseUrl: '', apiFormat: 'openai', apiKey: '', models: [] },
]

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-ext-runtime-'))
  roots.push(root)
  const store = new ExtensionStore(join(root, 'extensions.json'))
  const engines = { list: () => [harness, codex] }
  const providerStore = { list: () => providers }
  return {
    store,
    router: new ExtensionRouter(store, engines as never, providerStore as never),
    demos: new ExtensionDemoService(store, engines as never, providerStore as never),
  }
}

describe('ExtensionRouter runtime', () => {
  it('previews provider-neutral harness routes separately from engine-native Codex', async () => {
    const { router } = await fixture()
    const preview = await router.preview('demo-counter-plugin')
    expect(preview.routes.filter((route) => route.engineId === 'nd-harness')).toHaveLength(2)
    expect(preview.routes.filter((route) => route.engineId === 'codex-cli')).toHaveLength(1)
  })

  it('decorates real prompts after an extension is enabled', async () => {
    const { store, router } = await fixture()
    const extension = (await store.list()).find((item) => item.id === 'demo-counter-memory')!
    await store.save({ ...extension, enabled: true })
    const prompt = await router.decoratePrompt('Ship the task.', 'nd-harness', 'deepseek-official')
    expect(prompt).toContain('Ship the task.')
    expect(prompt).toContain('Counter Memory Demo')
    expect(prompt).toContain('<nd-extension-context>')
  })

  it('runs every built-in counter demo through the same route resolver', async () => {
    const { store, demos } = await fixture()
    const items = (await store.list()).filter((item) => item.builtInDemo)
    for (const item of items) {
      const result = await demos.run(item.id, 'nd-harness', 'deepseek-official')
      expect(result.supported).toBe(true)
      expect(result.steps.length).toBeGreaterThan(1)
      expect(Number.isFinite(result.counter)).toBe(true)
    }
  })

  it('shows ND proxy routing for the MCP demo on Codex CLI', async () => {
    const { demos } = await fixture()
    const result = await demos.run('demo-counter-mcp', 'codex-cli')
    expect(result.adapter).toBe('nd-proxy')
    expect(result.counter).toBe(7)
  })
})
