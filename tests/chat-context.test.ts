import { describe, expect, it } from 'vitest'
import { formatContextTokens, readChatContextUsage } from '../src/shared/chat-context.js'

describe('chat context usage', () => {
  it('uses projected occupancy and a separately normalized estimated composition', () => {
    const usage = readChatContextUsage({
      contextPressure: { pressureTokens: 250000, projectedTokens: 253300, contextWindow: 1000000 },
      contextBreakdown: { messageTokens: 8000, toolsTokens: 1500, systemTokens: 500 },
      tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, outputTokens: 50 },
    })
    expect(usage).toMatchObject({ used: 253300, estimated: true, input: 1000, output: 50, cacheHitRate: 80 })
    expect(usage.percent).toBeCloseTo(25.33)
    expect(usage.parts.map((part) => part.percent)).toEqual([80, 15, 5])
  })

  it('does not invent usage, capacity, or cache rates from missing and invalid values', () => {
    for (const values of [undefined, null, {}, { contextPressure: { projectedTokens: -1, contextWindow: 0 } }]) {
      expect(readChatContextUsage(values)).toMatchObject({ used: undefined, capacity: undefined, percent: undefined, cacheHitRate: undefined, parts: [] })
    }
    expect(readChatContextUsage({ contextPressure: { pressureTokens: NaN, contextWindow: Infinity } }).used).toBeUndefined()
    expect(readChatContextUsage({ contextBreakdown: { messageTokens: 100, toolsTokens: -5, systemTokens: 10 } }).parts).toEqual([])
    expect(readChatContextUsage({ tokenUsage: { uncachedInputTokens: 100, outputTokens: 20 } }).cacheHitRate).toBeUndefined()
  })

  it('keeps zero usage valid and preserves over-capacity percentages', () => {
    expect(readChatContextUsage({ contextPressure: { pressureTokens: 0, contextWindow: 100 } })).toMatchObject({ used: 0, percent: 0, estimated: false })
    expect(readChatContextUsage({ contextPressure: { projectedTokens: 110, contextWindow: 100 } }).percent).toBeCloseTo(110)
    expect(readChatContextUsage({ tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } })).toMatchObject({ input: 0, output: 0, cacheHitRate: undefined })
  })

  it('reflects compaction and absent model capacity without retaining old totals', () => {
    const before = readChatContextUsage({ contextPressure: { pressureTokens: 900, projectedTokens: 1000, contextWindow: 2000 } })
    const after = readChatContextUsage({ contextPressure: { pressureTokens: 900, projectedTokens: 300 } })
    expect(before.used).toBe(1000)
    expect(after).toMatchObject({ used: 300, capacity: undefined, percent: undefined })
  })

  it('formats compact token totals', () => {
    expect([0, 999, 1200, 253300, 1000000].map(formatContextTokens)).toEqual(['0', '999', '1.2K', '253.3K', '1M'])
  })
})
