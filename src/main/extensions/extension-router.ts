import type { CodingEngineDescriptor, ModelProvider } from '../../shared/contracts.js'
import {
  appendExtensionContext,
  resolveExtensionRoute,
  type ExtensionRoutePreview,
  type ExtensionRuntimeBinding,
} from '../../shared/extensions.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { ProviderStore } from '../providers.js'
import type { ExtensionStore } from './extension-store.js'

/**
 * Product-level compatibility router. Model routing and extension routing stay
 * independent: engine selection decides how a capability is delivered, while
 * provider scope decides whether prompt/context delivery may reach a model
 * route at all.
 */
export class ExtensionRouter {
  constructor(
    private readonly store: ExtensionStore,
    private readonly engines: Pick<CodingEngineRegistry, 'list'>,
    private readonly providers: Pick<ProviderStore, 'list'>,
  ) {}

  async preview(extensionId: string): Promise<ExtensionRoutePreview> {
    const extension = await this.store.get(extensionId)
    if (!extension) throw new Error(`Unknown extension: ${extensionId}`)
    // Compatibility preview answers "how would this route if enabled?"; the
    // extension's actual enabled flag is still returned to the UI separately.
    const previewExtension = { ...extension, enabled: true }
    const engines = this.engines.list()
    const providers = this.providers.list().filter((provider) => provider.enabled)
    const routes: ExtensionRoutePreview['routes'] = []
    for (const engine of engines) {
      // Engines without provider-neutral routing are still previewed once. For
      // ND Harness we show one row per enabled provider so provider scope is
      // visible and testable in the same matrix.
      if (!engine.capabilities.modelProviderRouting || providers.length === 0) {
        const route = resolveExtensionRoute(previewExtension, engine)
        routes.push({ ...route, engineName: engine.name })
        continue
      }
      for (const provider of providers) {
        const route = resolveExtensionRoute(previewExtension, engine, provider)
        routes.push({ ...route, engineName: engine.name, providerName: provider.name })
      }
    }
    return { extension, routes }
  }

  async bindings(engineId: string, providerId?: string): Promise<ExtensionRuntimeBinding[]> {
    const engine = this.requireEngine(engineId)
    const provider = this.findProvider(providerId)
    const extensions = await this.store.list()
    return extensions.map((extension) => ({
      extension,
      route: resolveExtensionRoute(extension, engine, provider),
    }))
  }

  async decoratePrompt(prompt: string, engineId: string, providerId?: string): Promise<string> {
    return appendExtensionContext(prompt, await this.bindings(engineId, providerId))
  }

  private requireEngine(engineId: string): CodingEngineDescriptor {
    const engine = this.engines.list().find((item) => item.id === engineId)
    if (!engine) throw new Error(`Unknown coding engine: ${engineId}`)
    return engine
  }

  private findProvider(providerId: string | undefined): ModelProvider | undefined {
    if (!providerId) return undefined
    return this.providers.list().find((item) => item.id === providerId)
      ?? { id: providerId, name: providerId, enabled: false, baseUrl: '', apiFormat: '', apiKey: '', models: [] }
  }
}
