import { describe, expect, it } from 'vitest'
import type { CodingEngineDescriptor, ModelProvider } from '../src/shared/contracts.js'
import {
  AGENT_EXTENSION_SURFACES,
  appendExtensionContext,
  cloneBuiltinExtensionDemos,
  resolveExtensionRoute,
} from '../src/shared/extensions.js'

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

function enabledDemo(surface: (typeof AGENT_EXTENSION_SURFACES)[number]) {
  const extension = cloneBuiltinExtensionDemos().find((item) => item.surface === surface)!
  extension.enabled = true
  return extension
}

describe('universal extension router', () => {
  it('ships a disabled pre-built demo for every agent extension surface', () => {
    const demos = cloneBuiltinExtensionDemos()
    for (const surface of AGENT_EXTENSION_SURFACES) {
      const demo = demos.find((item) => item.surface === surface)
      expect(demo, `missing ${surface} demo`).toBeDefined()
      expect(demo?.builtInDemo).toBe(true)
      expect(demo?.enabled).toBe(false)
      expect(demo?.demoPrompt?.length).toBeGreaterThan(10)
      expect(demo?.instructions?.length).toBeGreaterThan(20)
    }
  })

  it('uses native MCP on harness and ND proxy on an engine without MCP', () => {
    const extension = enabledDemo('mcp')
    expect(resolveExtensionRoute(extension, harness).adapter).toBe('mcp')
    expect(resolveExtensionRoute(extension, codex).adapter).toBe('nd-proxy')
  })

  it('routes skills natively when possible and through a bridge otherwise', () => {
    const extension = enabledDemo('skill')
    expect(resolveExtensionRoute(extension, harness).adapter).toBe('native')
    expect(resolveExtensionRoute(extension, codex).adapter).toBe('skill-bridge')
  })

  it('routes non-harness subagent extensions through ND orchestration', () => {
    const extension = enabledDemo('subagent')
    expect(resolveExtensionRoute(extension, harness).adapter).toBe('native')
    expect(resolveExtensionRoute(extension, codex).adapter).toBe('nd-proxy')
  })

  it('respects explicit engine disable overrides', () => {
    const extension = enabledDemo('hook')
    extension.engineRoutes = [{ engineId: 'codex-cli', adapter: 'disabled' }]
    const route = resolveExtensionRoute(extension, codex)
    expect(route.supported).toBe(false)
    expect(route.adapter).toBe('disabled')
  })

  it('marks impossible explicit transport overrides unsupported instead of pretending they work', () => {
    const extension = enabledDemo('mcp')
    extension.engineRoutes = [{ engineId: 'codex-cli', adapter: 'mcp' }]
    const route = resolveExtensionRoute(extension, codex)
    expect(route.supported).toBe(false)
    expect(route.adapter).toBe('mcp')
    expect(route.reason).toMatch(/cannot deliver/i)
  })

  it('can scope prompt/context delivery to model providers separately from engine routing', () => {
    const extension = enabledDemo('memory')
    extension.providerRoutes = [{ providerId: deepseek.id, enabled: false }]
    const route = resolveExtensionRoute(extension, harness, deepseek)
    expect(route.supported).toBe(false)
    expect(route.reason).toMatch(/provider/i)
  })

  it('appends trusted runtime context only for supported enabled bindings', () => {
    const enabled = enabledDemo('command')
    const disabled = enabledDemo('hook')
    disabled.enabled = false
    const prompt = appendExtensionContext('Build the counter.', [
      { extension: enabled, route: resolveExtensionRoute(enabled, codex) },
      { extension: disabled, route: resolveExtensionRoute(disabled, codex) },
    ])
    expect(prompt).toContain('<nd-extension-context>')
    expect(prompt).toContain('Counter Command Demo')
    expect(prompt).not.toContain('Counter Hook Demo')
    expect(prompt).toContain('prompt-injection')
  })
})
