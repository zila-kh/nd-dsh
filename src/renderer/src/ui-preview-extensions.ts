import {
  cloneBuiltinExtensionDemos,
  resolveExtensionRoute,
  type AgentExtensionManifest,
  type ExtensionDemoResult,
  type ExtensionRoutePreview,
  type ExtensionsDesktopApi,
} from '../../shared/extensions'

let extensions = cloneBuiltinExtensionDemos()
const listeners = new Set<(items: AgentExtensionManifest[]) => void>()
const counters = new Map<string, number>()

function snapshot(): AgentExtensionManifest[] {
  return structuredClone(extensions)
}

function emit(): AgentExtensionManifest[] {
  const items = snapshot()
  for (const listener of listeners) listener(items)
  return items
}

async function save(manifest: AgentExtensionManifest): Promise<AgentExtensionManifest[]> {
  const index = extensions.findIndex((item) => item.id === manifest.id)
  if (index >= 0 && extensions[index]?.builtInDemo) {
    const existing = extensions[index]!
    extensions[index] = {
      ...existing,
      enabled: manifest.enabled,
      engineRoutes: manifest.engineRoutes.map((route) => ({ ...route })),
      providerRoutes: manifest.providerRoutes.map((route) => ({ ...route })),
    }
  } else if (index >= 0) {
    extensions[index] = structuredClone(manifest)
  } else {
    extensions.push(structuredClone(manifest))
  }
  return emit()
}

async function preview(id: string): Promise<ExtensionRoutePreview> {
  const extension = extensions.find((item) => item.id === id)
  if (!extension) throw new Error(`Unknown preview extension: ${id}`)
  const [engines, providers] = await Promise.all([window.ndDsh.engines.list(), window.ndDsh.providers.list()])
  const enabledProviders = providers.filter((provider) => provider.enabled)
  const routes: ExtensionRoutePreview['routes'] = []
  const enabledExtension = { ...extension, enabled: true }
  for (const engine of engines) {
    if (!engine.capabilities.modelProviderRouting || enabledProviders.length === 0) {
      routes.push({ ...resolveExtensionRoute(enabledExtension, engine), engineName: engine.name })
      continue
    }
    for (const provider of enabledProviders) {
      routes.push({ ...resolveExtensionRoute(enabledExtension, engine, provider), engineName: engine.name, providerName: provider.name })
    }
  }
  return { extension: structuredClone(extension), routes }
}

async function runDemo(id: string, engineId?: string, providerId?: string): Promise<ExtensionDemoResult> {
  const extension = extensions.find((item) => item.id === id)
  if (!extension?.builtInDemo) throw new Error('Preview demo is available only for built-in demos')
  const [engines, providers] = await Promise.all([window.ndDsh.engines.list(), window.ndDsh.providers.list()])
  const engine = engineId ? engines.find((item) => item.id === engineId) : engines.find((item) => item.available) ?? engines[0]
  if (!engine) throw new Error(engineId ? `Unknown coding engine: ${engineId}` : 'No coding engines registered')
  const provider = providerId ? providers.find((item) => item.id === providerId) : undefined
  if (providerId && !provider) throw new Error(`Unknown model provider: ${providerId}`)
  const route = resolveExtensionRoute({ ...extension, enabled: true }, engine, provider)
  const steps = [`preview route ${engine.id} -> ${route.adapter}`]
  let counter = counters.get(id) ?? 0
  if (route.supported) {
    if (extension.surface === 'mcp') {
      counter = 0
      steps.push('counter_reset() = 0')
      counter += 3
      steps.push('counter_add(3) = 3')
      counter += 4
      steps.push('counter_add(4) = 7', 'counter_get() = 7')
    } else if (extension.surface === 'hook') {
      steps.push(`pre-run hook observed ${counter}`)
      counter += 7
      steps.push(`post-run hook verified ${counter}`)
    } else {
      counter = 7
      steps.push(`${extension.surface} counter demo produced 7`)
    }
    counters.set(id, counter)
  }
  return {
    extensionId: id,
    surface: extension.surface,
    engineId: engine.id,
    ...(provider ? { providerId: provider.id } : {}),
    adapter: route.adapter,
    supported: route.supported,
    counter,
    steps,
    summary: route.supported ? `${extension.name} preview completed; counter=${counter}.` : route.reason,
  }
}

const api: ExtensionsDesktopApi = {
  list: async () => snapshot(),
  save,
  remove: async (id) => {
    const existing = extensions.find((item) => item.id === id)
    if (existing?.builtInDemo) throw new Error('Built-in preview demos cannot be deleted')
    extensions = extensions.filter((item) => item.id !== id)
    return emit()
  },
  resetDemos: async () => {
    extensions = [...cloneBuiltinExtensionDemos(), ...extensions.filter((item) => !item.builtInDemo)]
    return emit()
  },
  preview,
  runDemo,
  onChanged: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function installDevelopmentExtensionPreview(): void {
  window.ndDshExtensions = api
}
