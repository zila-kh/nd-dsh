/**
 * ND's token-usage contract for cost measurement.
 *
 * The pinned Harness reports one DISJOINT set of buckets per model call:
 * `inputTokens` is uncached input only, and cache reads and cache writes are
 * billed input on top of it. Reasoning tokens are already included in output,
 * so nothing here adds them back in.
 *
 * Cache hit rate is the same quotient the context popover shows, computed from
 * the same three input buckets, so a persisted read and a live read of one
 * session never disagree.
 */

/** Billed input is these three buckets summed; the cache read is the discount. */
export interface UsageTokenTotals {
  /** Model calls folded into this total. */
  steps: number
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export const emptyUsageTotals = (): UsageTokenTotals => ({
  steps: 0,
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
})

/** Every input token the provider bills: misses, cache reads, and cache writes. */
export function billedInputTokens(totals: UsageTokenTotals): number {
  return totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
}

/** Cache read share of billed input, or undefined before any input was billed. */
export function cacheHitRate(totals: UsageTokenTotals): number | undefined {
  const input = billedInputTokens(totals)
  return input > 0 ? totals.cacheReadTokens / input * 100 : undefined
}

export function addUsageTotals(target: UsageTokenTotals, source: UsageTokenTotals): UsageTokenTotals {
  return {
    steps: target.steps + source.steps,
    uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
    outputTokens: target.outputTokens + source.outputTokens,
  }
}

/** One route's share of a session, so a fallback route's cost is separable. */
export interface UsageModelTotals {
  provider?: string
  model?: string
  totals: UsageTokenTotals
}

/** One session's folded accounting, as the ledger persists and replays it. */
export interface UsageSessionUsage {
  sessionId: string
  totals: UsageTokenTotals
  firstAt: number
  lastAt: number
  /** Per-route split within the session; a mid-session route change shows here. */
  models: UsageModelTotals[]
}

/**
 * Where a session's tokens belong in the product. Only the organization store
 * can answer this, and only for sessions it started: a plain chat session has
 * no run and stays visible under the session scope alone.
 */
export interface UsageAttribution {
  companyId?: string
  projectId?: string
  taskId?: string
}

export type UsageScope = 'session' | 'task' | 'project' | 'company'

export interface UsageBucket {
  /** The group id for this scope: a session, task, project, or company id. */
  key: string
  scope: UsageScope
  sessionIds: string[]
  totals: UsageTokenTotals
  firstAt: number
  lastAt: number
}

export interface UsageSummary {
  scope: UsageScope
  generatedAt: number
  buckets: UsageBucket[]
  /** Every counted session summed, so an `id` query totals just that group. */
  totals: UsageTokenTotals
  /** Sessions counted here after the `id` and `since` filters. */
  attributedSessions: number
  /** Sessions in the window with no organization ownership; they match no id. */
  unattributedSessions: number
}

export interface UsageSummaryInput {
  sessions: readonly UsageSessionUsage[]
  scope: UsageScope
  attribution?: ReadonlyMap<string, UsageAttribution>
  /**
   * Restrict the whole summary to one group id. Buckets, totals, and counted
   * sessions all cover just that group, so a per-project read needs no
   * unwrapping of `buckets[0]`.
   */
  id?: string
  /**
   * Ignore sessions whose activity ends before this epoch ms. Totals stay
   * whole-session: a session reaching into the window is counted in full, so
   * this is a windowed view rather than an exact windowed sum.
   */
  since?: number
}

function scopeKey(scope: UsageScope, source: UsageAttribution | undefined, sessionId: string): string | undefined {
  if (scope === 'session') return sessionId
  if (scope === 'task') return source?.taskId
  if (scope === 'project') return source?.projectId
  return source?.companyId
}

/**
 * Fold per-session accounting into the requested scope.
 *
 * Sessions the organization store does not own are counted in
 * `unattributedSessions` and never invent a group: a task bucket must not mix
 * in chat traffic from the same project's sessions.
 */
export function summarizeUsage(input: UsageSummaryInput): UsageSummary {
  const generatedAt = Date.now()
  const buckets = new Map<string, UsageBucket>()
  let totals = emptyUsageTotals()
  let attributedSessions = 0
  let unattributedSessions = 0
  for (const session of input.sessions) {
    if (input.since !== undefined && session.lastAt < input.since) continue
    const attribution = input.attribution?.get(session.sessionId)
    const key = scopeKey(input.scope, attribution, session.sessionId)
    if (key === undefined) {
      unattributedSessions += 1
      continue
    }
    if (input.id !== undefined && key !== input.id) continue
    attributedSessions += 1
    totals = addUsageTotals(totals, session.totals)
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, {
        key,
        scope: input.scope,
        sessionIds: [session.sessionId],
        totals: { ...session.totals },
        firstAt: session.firstAt,
        lastAt: session.lastAt,
      })
      continue
    }
    bucket.sessionIds.push(session.sessionId)
    bucket.totals = addUsageTotals(bucket.totals, session.totals)
    bucket.firstAt = Math.min(bucket.firstAt, session.firstAt)
    bucket.lastAt = Math.max(bucket.lastAt, session.lastAt)
  }
  const selected = [...buckets.values()].sort((left, right) => right.lastAt - left.lastAt)
  return { scope: input.scope, generatedAt, buckets: selected, totals, attributedSessions, unattributedSessions }
}

export const USAGE_IPC = {
  summary: 'usage:summary',
} as const

export interface UsageDesktopApi {
  /** Token accounting grouped by session, task, project, or company. */
  summary: (scope?: UsageScope, id?: string, since?: number) => Promise<UsageSummary>
}
