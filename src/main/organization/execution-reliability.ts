export const MAX_EXECUTION_ATTEMPTS = 3
export const DEFAULT_STALL_TIMEOUT_MS = 10 * 60 * 1_000

/**
 * Retry only failures that can plausibly succeed on a fresh engine/provider
 * route. Authentication, permission, policy and deterministic workspace errors
 * fail closed instead of consuming the retry budget in a loop.
 */
export function isRetryableExecutionFailure(message: string): boolean {
  const text = message.toLowerCase()
  if (/auth|unauthori[sz]ed|forbidden|permission|policy|approval|invalid api key|missing api key|configuration|config error/.test(text)) return false
  if (/merge conflict|integration conflict|uncommitted human|workspace.*dirty|not a git|worktree path already exists|verification failed|test command failed/.test(text)) return false
  return /\b5\d\d\b|gateway-unreachable|unreachable|connection|econn|socket|network|timeout|timed out|rate limit|temporar|overload|empty stream|aborted stream|runtime exited|app-server exited|provider/.test(text)
}

export function stallTimeoutMs(environment = process.env.ND_DSH_STALL_TIMEOUT_MS): number {
  const parsed = environment ? Number(environment) : Number.NaN
  if (!Number.isFinite(parsed)) return DEFAULT_STALL_TIMEOUT_MS
  return Math.max(60_000, Math.min(parsed, 60 * 60 * 1_000))
}

export function retryBackoffMs(attempt: number): number {
  return Math.min(5_000, Math.max(750, attempt * 1_000))
}
