import type { ModelProvider, SessionModels } from './contracts.js'

const DEEPSEEK_RUNTIME_ROUTE = 'deepseek-official'

/**
 * DeepSeek's native Harness adapter owns its upstream catalog. ND settings own
 * which DeepSeek model is active, so the renderer must not expose the native
 * adapter's built-in alternatives as selectable ND routes.
 *
 * When DeepSeek (or any other provider) is disabled in ND settings, its route
 * and models are completely omitted from the session catalog so they are never
 * listed or shown in the chat dropdown.
 */
export function restrictDeepSeekCatalog(
  catalog: SessionModels,
  providers: readonly ModelProvider[],
): SessionModels {
  const deepseekProvider = providers.find((provider) => (
    provider.id === 'deepseek' || provider.id === DEEPSEEK_RUNTIME_ROUTE
  ))
  const deepseekEnabled = deepseekProvider?.enabled === true
  const configuredModel = deepseekEnabled
    ? deepseekProvider?.models.find((model) => model.id.trim())?.id.trim()
    : undefined

  const filteredGroups = catalog.groups
    .map((group) => {
      const isDs = group.id === DEEPSEEK_RUNTIME_ROUTE || group.id === 'deepseek'
      if (isDs) {
        if (!deepseekEnabled) return null
        const activeModel = configuredModel || (
          catalog.current.provider === DEEPSEEK_RUNTIME_ROUTE ? catalog.current.model.trim() : ''
        )
        const activeEntry = group.models.find((model) => model.id === activeModel)
        return {
          ...group,
          models: activeModel ? [activeEntry ?? { id: activeModel, name: activeModel }] : group.models,
        }
      }
      const provider = providers.find((p) => p.id === group.id)
      if (provider && !provider.enabled) return null
      return group
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)

  let nextCurrent = { ...catalog.current }
  const currentIsDs = nextCurrent.provider === DEEPSEEK_RUNTIME_ROUTE || nextCurrent.provider === 'deepseek'
  if (currentIsDs && !deepseekEnabled) {
    const firstGroup = filteredGroups[0]
    const firstModel = firstGroup?.models[0]
    if (firstGroup && firstModel) {
      nextCurrent = {
        provider: firstGroup.id,
        model: firstModel.id,
      }
    } else {
      nextCurrent = { provider: '', model: '' }
    }
  }

  return {
    ...catalog,
    current: nextCurrent,
    groups: filteredGroups,
    failures: catalog.failures?.filter((f) => {
      if ((f.id === DEEPSEEK_RUNTIME_ROUTE || f.id === 'deepseek') && !deepseekEnabled) return false
      return true
    }) ?? [],
  }
}

