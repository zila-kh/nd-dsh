import type { ModelProvider, SessionModels } from './contracts.js'

const DEEPSEEK_RUNTIME_ROUTE = 'deepseek-official'

/**
 * DeepSeek's native Harness adapter owns its upstream catalog. ND settings own
 * which DeepSeek model is active, so the renderer must not expose the native
 * adapter's built-in alternatives as selectable ND routes.
 */
export function restrictDeepSeekCatalog(
  catalog: SessionModels,
  providers: readonly ModelProvider[],
): SessionModels {
  const configuredProvider = providers.find((provider) => (
    provider.enabled
    && (provider.id === 'deepseek' || provider.id === DEEPSEEK_RUNTIME_ROUTE)
  ))
  const configuredModel = configuredProvider?.models.find((model) => model.id.trim())?.id.trim()
  const activeModel = configuredModel || (
    catalog.current.provider === DEEPSEEK_RUNTIME_ROUTE ? catalog.current.model.trim() : ''
  )

  if (!activeModel) return catalog

  return {
    ...catalog,
    groups: catalog.groups.map((group) => {
      if (group.id !== DEEPSEEK_RUNTIME_ROUTE) return group
      const activeEntry = group.models.find((model) => model.id === activeModel)
      return {
        ...group,
        models: [activeEntry ?? { id: activeModel, name: activeModel }],
      }
    }),
  }
}
