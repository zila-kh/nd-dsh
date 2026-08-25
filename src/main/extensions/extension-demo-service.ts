import {
  resolveExtensionRoute,
  type AgentExtensionManifest,
  type ExtensionDemoResult,
} from '../../shared/extensions.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { ProviderStore } from '../providers.js'
import type { ExtensionStore } from './extension-store.js'

/**
 * Deterministic, account-free manual QA for every extension surface. These
 * demos test ND's routing/control-plane behavior without pretending an
 * external provider or third-party MCP server was contacted.
 */
export class ExtensionDemoService {
  private readonly counters = new Map<string, number>()

  constructor(
    private readonly store: ExtensionStore,
    private readonly engines: Pick<CodingEngineRegistry, 'list'>,
    private readonly providers: Pick<ProviderStore, 'list'>,
  ) {}

  async run(extensionId: string, engineId?: string, providerId?: string): Promise<ExtensionDemoResult> {
    const stored = await this.store.get(extensionId)
    if (!stored?.builtInDemo) throw new Error('Run demo is available only for the built-in extension demo pack')
    const engine = this.pickEngine(engineId)
    const provider = providerId ? this.providers.list().find((item) => item.id === providerId) : undefined
    if (providerId && !provider) throw new Error(`Unknown model provider: ${providerId}`)

    // Demo execution should prove the route even though demos default disabled
    // in normal runs, so resolve against an enabled copy without persisting it.
    const extension: AgentExtensionManifest = { ...stored, enabled: true }
    const route = resolveExtensionRoute(extension, engine, provider)
    const steps: string[] = [`route ${engine.id} -> ${route.adapter}`]
    if (provider) steps.push(`provider ${provider.id} ${route.supported ? 'allowed' : 'blocked'}`)

    let counter = this.counters.get(extension.id) ?? 0
    if (!route.supported) {
      return {
        extensionId,
        surface: extension.surface,
        engineId: engine.id,
        ...(provider ? { providerId: provider.id } : {}),
        adapter: route.adapter,
        supported: false,
        counter,
        steps,
        summary: route.reason,
      }
    }

    switch (extension.surface) {
      case 'memory':
        counter = 7
        this.counters.set(extension.id, counter)
        steps.push('write durable demo value = 7', 'read durable demo value = 7')
        break
      case 'subagent':
        counter = 7
        this.counters.set(extension.id, counter)
        steps.push('worker proposal: add 3', 'reviewer proposal: add 4', 'ND combines reviewed result = 7')
        break
      case 'plugin':
        counter += 7
        this.counters.set(extension.id, counter)
        steps.push('plugin counter.add(7)', `plugin counter.get() = ${counter}`)
        break
      case 'mcp':
        counter = 0
        steps.push('counter_reset() = 0')
        counter += 3
        steps.push('counter_add(3) = 3')
        counter += 4
        steps.push('counter_add(4) = 7', 'counter_get() = 7')
        this.counters.set(extension.id, counter)
        break
      case 'skill':
        counter = 7
        this.counters.set(extension.id, counter)
        steps.push('apply accessible counter skill', 'validate increment/decrement/reset contract', 'sample target value = 7')
        break
      case 'command':
        counter = 7
        this.counters.set(extension.id, counter)
        steps.push('parse /counter create --framework react --tests', 'translate command for selected engine', 'command sample target value = 7')
        break
      case 'hook': {
        const before = counter
        steps.push(`pre-run hook observed ${before}`)
        counter = before + 7
        this.counters.set(extension.id, counter)
        steps.push(`operation add(7) = ${counter}`, `post-run hook verified finite value ${counter}`)
        break
      }
    }

    return {
      extensionId,
      surface: extension.surface,
      engineId: engine.id,
      ...(provider ? { providerId: provider.id } : {}),
      adapter: route.adapter,
      supported: true,
      counter,
      steps,
      summary: `${extension.name} completed through ${route.adapter}; counter=${counter}.`,
    }
  }

  private pickEngine(engineId?: string) {
    const engines = this.engines.list()
    const engine = engineId ? engines.find((item) => item.id === engineId) : engines.find((item) => item.available) ?? engines[0]
    if (!engine) throw new Error('No coding engines are registered')
    if (engineId && !engine) throw new Error(`Unknown coding engine: ${engineId}`)
    return engine
  }
}
