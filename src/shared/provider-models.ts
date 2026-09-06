import type { ProviderModel } from './contracts.js'

/** Accept decimal token counts and compact labels such as 128K or 1M. */
export function parseModelTokenLimit(value: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(value.trim().replaceAll(',', ''))
  if (!match) return undefined
  const suffix = match[2]?.toLowerCase()
  const result = Number(match[1]) * (suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1)
  return Number.isSafeInteger(result) && result > 0 ? result : undefined
}

/** Preserve legacy catalog inheritance while filtering untrusted IPC/disk data. */
export function sanitizeProviderModel(value: unknown, defaultContext = '1M'): ProviderModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id.trim() : ''
  if (!id) return undefined
  const inputTypes: ProviderModel['inputTypes'] = Array.isArray(entry.inputTypes)
    && entry.inputTypes.length > 0
    && entry.inputTypes.every((type) => type === 'text' || type === 'image')
    ? entry.inputTypes.includes('image') ? ['text', 'image'] : ['text'] : undefined
  const maxOutputTokens = typeof entry.maxOutputTokens === 'number'
    && Number.isSafeInteger(entry.maxOutputTokens) && entry.maxOutputTokens > 0 ? entry.maxOutputTokens : undefined
  return {
    id,
    context: typeof entry.context === 'string' ? entry.context : defaultContext,
    ...(inputTypes === undefined ? {} : { inputTypes }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  }
}
