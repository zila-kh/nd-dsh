import type { ModelProvider, SessionModels } from '../../../shared/contracts.js'

export type ModelCatalogState = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface ModelSelectionDisplay {
  label: string
  title: string
  stale: boolean
}

/**
 * Resolve honest, provider-neutral copy for the composer model selector.
 *
 * Before a Harness session exists, the first enabled provider/model is the
 * same default that ProviderStore compiles for the runtime. Once a session
 * exists, only its catalog response is authoritative; loading and failure
 * states must never masquerade as a vendor route.
 */
export function resolveModelSelectionDisplay(
  models: SessionModels | null,
  activeSessionId: string | null,
  providers: readonly ModelProvider[],
  catalogState: ModelCatalogState,
): ModelSelectionDisplay {
  const groups = models?.groups ?? []
  const current = models?.current

  if (current) {
    const group = groups.find((item) => item.id === current.provider)
    const model = group?.models.find((item) => item.id === current.model)
    const stale = groups.length > 0 && (!group || !model)
    const route = `${group?.name ?? current.provider}/${current.model}`
    return {
      label: `${stale ? '⚠ ' : ''}${route}`,
      title: stale ? `Removed from model catalog — pick another · ${route}` : route,
      stale,
    }
  }

  if (activeSessionId) {
    if (catalogState === 'loading') {
      return { label: 'Loading models…', title: 'Loading this session’s model catalog.', stale: false }
    }
    return { label: 'Model unavailable', title: 'This session’s model catalog is unavailable.', stale: false }
  }

  for (const provider of providers) {
    if (!provider.enabled) continue
    const model = provider.models.find((item) => item.id.trim())
    if (!model) continue
    const route = `${provider.name.trim() || provider.id}/${model.id.trim()}`
    return { label: route, title: `Default for the next ND Harness session · ${route}`, stale: false }
  }

  return {
    label: 'No model configured',
    title: 'Configure an enabled provider and model in Settings.',
    stale: false,
  }
}
