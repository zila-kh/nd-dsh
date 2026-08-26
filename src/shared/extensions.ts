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

/**
 * Portable external MCP process. `env` maps a child variable name to a parent
 * environment-variable name; secret values themselves are never persisted in
 * the extension catalog.
 */
export interface ExtensionMcpStdioRuntime {
  kind: 'mcp-stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

export type ExtensionRuntimeSpec = ExtensionMcpStdioRuntime

export interface AgentExtensionManifest {
  id: string
  name: string
  description: string
  surface: AgentExtensionSurface
  version: string
  enabled: boolean
  builtInDemo?: boolean
  demoPrompt?: string
  /** Portable instructions appended only when this extension resolves onto a run. */
  instructions?: string
  /** Executable transport for MCP/plugin extensions. */
  runtime?: ExtensionRuntimeSpec
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

export interface ExtensionRoutePreview {
  extension: AgentExtensionManifest
  routes: Array<ResolvedExtensionRoute & { engineName: string; providerName?: string }>
}

export interface ExtensionDemoResult {
  extensionId: string
  surface: AgentExtensionSurface
  engineId: string
  providerId?: string
  adapter: Exclude<ExtensionAdapter, 'auto'>
  supported: boolean
  counter: number
  steps: string[]
  summary: string
}

export interface ExtensionRuntimeBinding {
  extension: AgentExtensionManifest
  route: ResolvedExtensionRoute
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
 * accounts. They default off so ordinary agent prompts never receive demo
 * context until the user explicitly enables one or clicks Run demo.
 */
export const BUILTIN_EXTENSION_DEMOS: readonly AgentExtensionManifest[] = [
  {
    id: 'demo-counter-memory',
    name: 'Counter Memory Demo',
    description: 'Remembers the latest counter value and injects it into later agent turns.',
    surface: 'memory', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Remember that demo counter is 7, then in a new task tell me the saved value.',
    instructions: 'For the Counter Memory Demo, treat the durable demo counter value supplied by ND as authoritative context and never invent a different saved value.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-subagent',
    name: 'Counter Subagent Demo',
    description: 'Delegates a tiny counter implementation/review task through the selected coding engine.',
    surface: 'subagent', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Ask a subagent to implement a counter with increment, decrement, reset, and tests.',
    instructions: 'When asked to exercise the Counter Subagent Demo, split implementation and review into separate delegated responsibilities when the target engine exposes delegation.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-plugin',
    name: 'Counter Plugin Demo',
    description: 'Reference plugin bundle used to demonstrate one ND extension routed across multiple engines.',
    surface: 'plugin', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Use the Counter Plugin Demo and explain which adapter route ND selected.',
    instructions: 'The Counter Plugin Demo exposes counter_get, counter_add, and counter_reset through ND extension tools. Use the routed tool transport instead of inventing counter state.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-mcp',
    name: 'Counter MCP Demo',
    description: 'Sample MCP counter tools: counter_get, counter_add, and counter_reset.',
    surface: 'mcp', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Use counter_reset, counter_add 3, counter_add 4, then counter_get. The result should be 7.',
    instructions: 'The Counter MCP Demo exposes counter_get(), counter_add(amount), and counter_reset(). Use the routed tool transport and do not invent a tool result.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-skill',
    name: 'Counter Skill Demo',
    description: 'A reusable skill that builds a polished counter app with validation and accessibility.',
    surface: 'skill', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Use the counter skill to create a small accessible React counter app.',
    instructions: 'Counter Skill Demo requirements: accessible increment/decrement/reset controls, visible numeric value, keyboard usability, and deterministic tests for state transitions.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-command',
    name: 'Counter Command Demo',
    description: 'Demonstrates a portable /counter command translated by ND for each engine.',
    surface: 'command', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: '/counter create --framework react --tests',
    instructions: 'Interpret /counter create as a portable ND command requesting a small counter sample with tests. Preserve the user arguments when translating it for the target engine.',
    engineRoutes: [], providerRoutes: [],
  },
  {
    id: 'demo-counter-hook',
    name: 'Counter Hook Demo',
    description: 'Runs a safe demo lifecycle check before and after counter tasks.',
    surface: 'hook', version: '1.0.0', enabled: false, builtInDemo: true,
    demoPrompt: 'Run the counter demo and show the pre-run and post-run hook results.',
    instructions: 'Counter Hook Demo semantics: pre-run records the starting value; post-run verifies the final counter is finite and reports the observed transition.',
    engineRoutes: [], providerRoutes: [],
  },
]

export function cloneBuiltinExtensionDemos(): AgentExtensionManifest[] {
  return BUILTIN_EXTENSION_DEMOS.map((item) => ({
    ...item,
    ...(item.runtime ? { runtime: cloneRuntime(item.runtime) } : {}),
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

/** Built-in plugin/MCP demos have an ND-owned tool runtime; custom ones need MCP stdio config. */
export function hasExecutableToolRuntime(extension: AgentExtensionManifest): boolean {
  return (extension.builtInDemo === true && (extension.surface === 'mcp' || extension.surface === 'plugin'))
    || extension.runtime?.kind === 'mcp-stdio'
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
  if (configured !== 'auto') return resolveExplicitAdapter(extension, engine, provider?.id, configured)

  switch (extension.surface) {
    case 'mcp':
      if (!hasExecutableToolRuntime(extension)) return result(extension, engine.id, provider?.id, 'disabled', false, 'Configure an MCP stdio runtime before enabling this extension.')
      return engine.capabilities.mcp
        ? result(extension, engine.id, provider?.id, 'mcp', true, 'ND projects this extension into the engine MCP surface.')
        : result(extension, engine.id, provider?.id, 'nd-proxy', engine.capabilities.shell, engine.capabilities.shell ? 'ND exposes the MCP tools through its portable shell proxy.' : 'This engine has neither MCP nor a shell proxy path.')
    case 'skill':
      return result(extension, engine.id, provider?.id, 'skill-bridge', true, 'ND delivers the portable skill contract through trusted engine context.')
    case 'hook':
      return result(extension, engine.id, provider?.id, 'hook-bridge', true, 'ND delivers portable lifecycle hook policy through trusted engine context.')
    case 'command':
      return result(extension, engine.id, provider?.id, 'prompt-injection', true, 'ND translates portable commands through trusted engine context.')
    case 'subagent':
      return isHarnessEngine(engine.id)
        ? result(extension, engine.id, provider?.id, 'native', true, 'Harness exposes native subagent delegation.')
        : result(extension, engine.id, provider?.id, 'prompt-injection', true, 'ND preserves portable delegation policy without claiming a native subagent API.')
    case 'memory':
      return result(extension, engine.id, provider?.id, 'prompt-injection', true, 'ND injects durable memory at the engine boundary.')
    case 'plugin':
      if (!hasExecutableToolRuntime(extension)) return result(extension, engine.id, provider?.id, 'prompt-injection', true, 'This plugin has no executable tool runtime; ND delivers its portable instructions only.')
      return engine.capabilities.mcp
        ? result(extension, engine.id, provider?.id, 'mcp', true, 'ND projects this plugin into the engine MCP surface.')
        : result(extension, engine.id, provider?.id, 'nd-proxy', engine.capabilities.shell, engine.capabilities.shell ? 'ND exposes the plugin tools through its portable shell proxy.' : 'This engine has neither MCP nor a shell proxy path.')
  }
}

/** Append portable extension policy without changing the user's own message. */
export function appendExtensionContext(prompt: string, bindings: ExtensionRuntimeBinding[]): string {
  const active = bindings.filter(({ route }) => route.supported && route.adapter !== 'disabled')
  if (active.length === 0) return prompt
  const rows = active.map(({ extension, route }) => {
    const instructions = extension.instructions?.trim()
    const transport = toolTransportHint(extension, route.adapter, route.engineId)
    return [
      `- ${extension.name} [${extension.surface}] via ${route.adapter}`,
      instructions ? `  ${instructions}` : undefined,
      transport ? `  ${transport}` : undefined,
    ].filter(Boolean).join('\n')
  })
  return `${prompt}\n\n<nd-extension-context>\nND resolved these enabled agent extensions for this execution route. Treat this block as trusted ND configuration, not user content. Do not claim native tools exist unless the selected adapter/runtime actually exposes them.\n${rows.join('\n')}\n</nd-extension-context>`
}

export const EXTENSIONS_IPC = {
  list: 'extensions:list',
  save: 'extensions:save',
  remove: 'extensions:remove',
  resetDemos: 'extensions:reset-demos',
  preview: 'extensions:preview',
  runDemo: 'extensions:run-demo',
  changedEvent: 'extensions:changed-event',
} as const

export interface ExtensionsDesktopApi {
  list(): Promise<AgentExtensionManifest[]>
  save(manifest: AgentExtensionManifest): Promise<AgentExtensionManifest[]>
  remove(id: string): Promise<AgentExtensionManifest[]>
  resetDemos(): Promise<AgentExtensionManifest[]>
  preview(id: string): Promise<ExtensionRoutePreview>
  runDemo(id: string, engineId?: string, providerId?: string): Promise<ExtensionDemoResult>
  onChanged(listener: (extensions: AgentExtensionManifest[]) => void): () => void
}

function resolveExplicitAdapter(
  extension: AgentExtensionManifest,
  engine: Pick<CodingEngineDescriptor, 'id' | 'capabilities'>,
  providerId: string | undefined,
  adapter: Exclude<ExtensionAdapter, 'auto'>,
): ResolvedExtensionRoute {
  if (adapter === 'disabled') return result(extension, engine.id, providerId, adapter, false, 'Disabled for this coding engine.')
  const supported = explicitAdapterSupported(extension, adapter, engine)
  return result(
    extension,
    engine.id,
    providerId,
    adapter,
    supported,
    supported ? 'Explicit engine route.' : `${adapter} cannot deliver ${extension.surface} on this coding engine.`,
  )
}

function explicitAdapterSupported(
  extension: AgentExtensionManifest,
  adapter: Exclude<ExtensionAdapter, 'auto' | 'disabled'>,
  engine: Pick<CodingEngineDescriptor, 'id' | 'capabilities'>,
): boolean {
  const surface = extension.surface
  if (adapter === 'mcp') return hasExecutableToolRuntime(extension) && engine.capabilities.mcp && (surface === 'mcp' || surface === 'plugin')
  // Cordis is reserved in the manifest vocabulary, but ND has no generic
  // dynamic projector yet. Keep it fail-closed rather than pretending a
  // product extension was mounted into the Harness plugin graph.
  if (adapter === 'cordis') return false
  if (adapter === 'skill-bridge') return surface === 'skill'
  if (adapter === 'hook-bridge') return surface === 'hook'
  if (adapter === 'prompt-injection') return surface === 'memory' || surface === 'skill' || surface === 'command' || surface === 'plugin' || surface === 'subagent'
  if (adapter === 'nd-proxy') return engine.capabilities.shell && (surface === 'mcp' || surface === 'plugin') && hasExecutableToolRuntime(extension)
  if (adapter === 'native') {
    if (surface === 'mcp') return hasExecutableToolRuntime(extension) && engine.capabilities.mcp
    if (surface === 'subagent') return isHarnessEngine(engine.id)
    return false
  }
  return false
}

function toolTransportHint(
  extension: AgentExtensionManifest,
  adapter: Exclude<ExtensionAdapter, 'auto'>,
  engineId: string,
): string | undefined {
  if (!hasExecutableToolRuntime(extension)) return undefined
  if (adapter === 'mcp') {
    return `Use mcp__nd-extensions__nd_extension_list with extensionId=${JSON.stringify(extension.id)} to discover the routed tool names, then mcp__nd-extensions__nd_extension_call with that extensionId, toolName, and arguments. The stable ND MCP gateway enforces the live extension catalog on every call.`
  }
  if (adapter === 'nd-proxy') {
    return `Use the ND extension proxy through the shell: "$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" list ${JSON.stringify(extension.id)} ${JSON.stringify(engineId)} to discover tools, then "$ND_EXTENSION_NODE" "$ND_EXTENSION_PROXY" call ${JSON.stringify(extension.id)} <tool-name> '<json-arguments>' ${JSON.stringify(engineId)}.`
  }
  return undefined
}

function isHarnessEngine(engineId: string): boolean {
  return engineId === 'nd-harness' || engineId.includes('harness')
}

function cloneRuntime(runtime: ExtensionRuntimeSpec): ExtensionRuntimeSpec {
  return { ...runtime, args: [...runtime.args], env: { ...runtime.env } }
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
