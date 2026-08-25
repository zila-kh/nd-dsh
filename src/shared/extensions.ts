import type { CodingEngineDescriptor, ModelProvider } from './contracts.js'

export type AgentExtensionSurface = 'memory' | 'subagent' | 'plugin' | 'mcp' | 'skill' | 'command' | 'hook'

export type ExtensionAdapter =
  | 'auto'
  | 'native'
  | 'cordis'
  | 'mcp'
  | 'hook-bridge'
  | 'skill-bridge'
  | 'prompt-injection'
  | 'nd-proxy'
  | 'disabled'

export interface ExtensionEngineRoute {
  engineId: string
  adapter: ExtensionAdapter
}

export interface ExtensionProviderRoute {
  providerId: string
  enabled: boolean
}

export interface AgentExtensionManifest {
  id: string
  name: string
  description: string
  surface: AgentExtensionSurface
  version: string
  enabled: boolean
  builtInDemo?: boolean
  demoPrompt?: string
  engineRoutes: ExtensionEngineRoute[]
  /** Empty means every enabled model provider may receive prompt/context delivery. */
  providerRoutes: ExtensionProviderRoute[]
}

export interface ResolvedExtensionRoute {
  extensionId: string
  engineId: string
  providerId?: string
  adapter: Exclude<ExtensionAdapter, 'auto'>
  supported: boolean
  reason: string
}

export const AGENT_EXTENSION_SURFACES: readonly AgentExtensionSurface[] = [
  'memory',
  'subagent',
  'plugin',
  'mcp',
  'skill',
  'command',
  'hook',
]

export const EXTENSION_ADAPTERS: readonly ExtensionAdapter[] = [
  'auto',
  'native',
  'cordis',
  'mcp',
  'hook-bridge',
  'skill-bridge',
  'prompt-injection',
  'nd-proxy',
  'disabled',
]

/**
 * Pre-built examples make every extension surface testable without external
 * accounts. The Counter demos intentionally share one tiny domain so users can
 * understand the routing difference rather than learn seven unrelated samples.
 */
export const BUILTIN_EXTENSION_DEMOS: readonly AgentExtensionManifest[] = [
  {
    id: 'demo-counter-memory',
    name: 'Counter Memory Demo',
    description: 'Remembers the latest counter value and injects it into later agent turns.',
    surface: 'memory', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Remember that demo counter is 7, then in a new task tell me the saved value.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-subagent',
    name: 'Counter Subagent Demo',
    description: 'Delegates a tiny counter implementation/review task through the selected coding engine.',
    surface: 'subagent', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Ask a subagent to implement a counter with increment, decrement, reset, and tests.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-plugin',
    name: 'Counter Plugin Demo',
    description: 'Reference plugin bundle used to demonstrate one ND extension routed across multiple engines.',
    surface: 'plugin', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Use the Counter Plugin Demo and explain which adapter route ND selected.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-mcp',
    name: 'Counter MCP Demo',
    description: 'Sample MCP-style counter tools: counter_get, counter_add, and counter_reset.',
    surface: 'mcp', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Use counter_add to add 3, add 4, then counter_get. The result should be 7.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-skill',
    name: 'Counter Skill Demo',
    description: 'A reusable skill that builds a polished counter app with validation and accessibility.',
    surface: 'skill', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Use the counter skill to create a small accessible React counter app.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-command',
    name: 'Counter Command Demo',
    description: 'Demonstrates a portable /counter command translated by ND for each engine.',
    surface: 'command', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: '/counter create --framework react --tests',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-hook',
    name: 'Counter Hook Demo',
    description: 'Runs a safe demo lifecycle check before and after counter tasks.',
    surface: 'hook', version: '1.0.0', enabled: true, builtInDemo: true,
    demoPrompt: 'Run the counter demo and show the pre-run and post-run hook results.',
    engineRoutes: [], providerRoutes: [],
  },
]

export function cloneBuiltinExtensionDemos(): AgentExtensionManifest[] {
  return BUILTIN_EXTENSION_DEMOS.map((item) => ({
    ...item,
    engineRoutes: item.engineRoutes.map((route) => ({ ...route })),
    providerRoutes: item.providerRoutes.map((route) => ({ ...route })),
  }))
}

export function providerAllowed(extension: AgentExtensionManifest, provider?: Pick<ModelProvider, 'id' | 'enabled'>): boolean {
  if (!provider) return true
  if (!provider.enabled) return false
  if (extension.providerRoutes.length === 0) return true
  return extension.providerRoutes.find((route) => route.providerId === provider.id)?.enabled ?? false
}

export function resolveExtensionRoute(
  extension: AgentExtensionManifest,
  engine: Pick<CodingEngineDescriptor, 'id' | 'available' | 'capabilities'>,
  provider?: Pick<ModelProvider, 'id' | 'enabled'>,
): ResolvedExtensionRoute {
  if (!extension.enabled) return result(extension, engine.id, provider?.id, 'disabled', false, 'Extension is disabled.')
  if (!engine.available) return result(extension, engine.id, provider?.id, 'disabled', false, 'Coding engine is unavailable.')
  if (!providerAllowed(extension, provider)) return result(extension, engine.id, provider?.id, 'disabled', false, 'Model provider is outside this extension route.')

  const configured = extension.engineRoutes.find((route) => route.engineId === engine.id)?.adapter ?? 'auto'
  if (configured !== 'auto') {
    if (configured === 'disabled') return result(extension, engine.id, provider?.id, 'disabled', false, 'Disabled for this coding engine.')
    return result(extension, engine.id, provider?.id, configured, true, 'Explicit engine route.')
  }

  switch (extension.surface) {
    case 'mcp':
      return engine.capabilities.mcp
        ? result(extension, engine.id, provider?.id, 'mcp', true, 'Engine exposes MCP natively.')
        : result(extension, engine.id, provider?.id, 'nd-proxy', true, 'ND proxy normalizes MCP for this engine.')
    case 'skill':
      return engine.capabilities.skills
        ? result(extension, engine.id, provider?.id, 'native', true, 'Engine exposes skills natively.')
        : result(extension, engine.id, provider?.id, 'skill-bridge', true, 'ND translates the skill into engine context.')
    case 'hook':
      return result(extension, engine.id, provider?.id, engine.id.includes('harness') ? 'cordis' : 'hook-bridge', true, 'ND normalizes lifecycle hooks.')
    case 'command':
      return result(extension, engine.id, provider?.id, engine.id.includes('harness') ? 'native' : 'prompt-injection', true, 'ND translates portable commands per engine.')
    case 'subagent':
      return result(extension, engine.id, provider?.id, 'native', true, 'Delegation is routed through the selected coding engine.')
    case 'memory':
      return result(extension, engine.id, provider?.id, 'prompt-injection', true, 'ND injects durable memory at the engine boundary.')
    case 'plugin':
      return engine.capabilities.mcp
        ? result(extension, engine.id, provider?.id, 'mcp', true, 'Plugin uses the engine MCP surface.')
        : result(extension, engine.id, provider?.id, 'nd-proxy', true, 'ND proxies the plugin capability set.')
  }
}

function result(
  extension: AgentExtensionManifest,
  engineId: string,
  providerId: string | undefined,
  adapter: Exclude<ExtensionAdapter, 'auto'>,
  supported: boolean,
  reason: string,
): ResolvedExtensionRoute {
  return { extensionId: extension.id, engineId, ...(providerId ? { providerId } : {}), adapter, supported, reason }
}
