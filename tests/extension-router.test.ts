import { describe, expect, it } from 'vitest'
import type { CodingEngineDescriptor, ModelProvider } from '../src/shared/contracts.js'
import { AGENT_EXTENSION_SURFACES, cloneBuiltinExtensionDemos, resolveExtensionRoute } from '../src/shared/extensions.js'

const harness: CodingEngineDescriptor = {
  id: 'nd-harness',
  name: 'ND Harness',
  integration: 'primary',
  available: true,
  description: 'test',
  capabilities: {
    workspace: true,
    filesystem: true,
    shell: true,
    browser: true,
    skills: true,
    mcp: true,
    modelProviderRouting: true,
    humanApprovals: true,
    streaming: true,
    persistentSessions: true,
  },
}

const codex: CodingEngineDescriptor = {
  ...harness,
  id: 'codex-cli',
  name: 'Codex CLI',
  integration: 'delegated',
  capabilities: { ...harness.capabilities, skills: false, mcp: false },
}

const deepseek: ModelProvider = {
  id: 'deepseek-official',
  name: 'DeepSeek',
  enabled: true,
  baseUrl: 'https://example.invalid',
  apiFormat: 'openai',
  apiKey: '',
  models: [],
}

describe('universal extension router', () => {
  it('ships a pre-built demo for every agent extension surface', () => {
    const demos = cloneBuiltinExtensionDemos()
    for (const surface of AGENT_EXTENSION_SURFACES) {
      const demo = demos.find((item) => item.surface === surface)
      expect(demo, `missing ${surface} demo`).toBeDefined()
      expect(demo?.builtInDemo).toBe(true)
      expect(demo?.demoPrompt?.length).toBeGreaterThan(10)
    }
  })

  it('uses native MCP on harness and ND proxy on an engine without MCP', () => {
    const extension = cloneBuiltinExtensionDemos().find((item) => item.surface === 'mcp')!
    expect(resolveExtensionRoute(extension, harness).adapter).toBe('mcp')
    expect(resolveExtensionRoute(extension, codex).adapter).toBe('nd-proxy')
  })

  it('routes skills natively when possible and through a bridge otherwise', () => {
    const extension = cloneBuiltinExtensionDemos().find((item) => item.surface === 'skill')!
    expect(resolveExtensionRoute(extension, harness).adapter).toBe('native')
    expect(resolveExtensionRoute(extension, codex).adapter).toBe('skill-bridge')
  })

  it('respects explicit engine overrides', () => {
    const extension = cloneBuiltinExtensionDemos().find((item) => item.surface === 'hook')!
    extension.engineRoutes = [{ engineId: 'codex-cli', adapter: 'disabled' }]
    const route = resolveExtensionRoute(extension, codex)
    expect(route.supported).toBe(false)
    expect(route.adapter).toBe('disabled')
  })

  it('can scope prompt/context delivery to model providers separately from engine routing', () => {
    const extension = cloneBuiltinExtensionDemos().find((item) => item.surface === 'memory')!
    extension.providerRoutes = [{ providerId: deepseek.id, enabled: false }]
    const route = resolveExtensionRoute(extension, harness, deepseek)
    expect(route.supported).toBe(false)
    expect(route.reason).toMatch(/provider/i)
  })
})
