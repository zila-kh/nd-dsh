/** ND's display contract for the runtime's optional token-meter projections. */
export interface ChatContextUsage {
  used: number | undefined
  capacity: number | undefined
  percent: number | undefined
  estimated: boolean
  parts: Array<{ label: string; tokens: number; percent: number; color: string }>
  cacheHitRate: number | undefined
  input: number | undefined
  output: number | undefined
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function readChatContextUsage(values: unknown): ChatContextUsage {
  const projections = record(values)
  const pressure = record(projections.contextPressure)
  const breakdown = record(projections.contextBreakdown)
  const usage = record(projections.tokenUsage)
  const projected = count(pressure.projectedTokens)
  const used = projected ?? count(pressure.pressureTokens)
  const capacity = count(pressure.contextWindow) || undefined
  const definitions = [
    { key: 'messageTokens', label: 'Messages', color: '#429bfa' },
    { key: 'toolsTokens', label: 'Tool definitions', color: '#357dca' },
    { key: 'systemTokens', label: 'System prompt', color: '#315577' },
  ]
  const counts = definitions.map((part) => count(breakdown[part.key]))
  const total = counts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const parts = counts.every((value) => value !== undefined) && total > 0
    ? definitions.map((part, index) => ({ ...part, tokens: counts[index]!, percent: counts[index]! / total * 100 }))
    : []
  // Runtime usage buckets are disjoint: cache reads/writes are additional
  // input, while reasoning is already included in output. Never sum again.
  const uncached = count(usage.uncachedInputTokens)
  const reads = count(usage.cacheReadTokens)
  const writes = count(usage.cacheWriteTokens)
  const input = uncached !== undefined && reads !== undefined && writes !== undefined
    ? uncached + reads + writes : undefined
  return {
    used, capacity,
    percent: used !== undefined && capacity !== undefined ? used / capacity * 100 : undefined,
    estimated: projected !== undefined,
    parts,
    cacheHitRate: input !== undefined && input > 0 && reads !== undefined ? reads / input * 100 : undefined,
    input,
    output: count(usage.outputTokens),
  }
}

export function formatContextTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}
