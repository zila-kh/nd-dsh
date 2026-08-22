/**
 * Real provider reachability probe. A ping is an actual HTTP GET against the
 * provider's `/models` endpoint using the stored credential, so the status
 * icon shown in the UI reflects a genuine round trip, not a static guess.
 */

export type ProviderPingState = 'ok' | 'auth' | 'unreachable'

export interface ProviderPingOutcome {
  state: ProviderPingState
  /** Round-trip milliseconds for the probe request. */
  latencyMs?: number
  /** HTTP status code the server answered with, when it answered. */
  status?: number
  /** The URL that was probed. */
  probedUrl?: string
}

export interface ProviderPingTarget {
  baseUrl: string
  apiKey?: string
}

export interface ProviderPingOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

/** `https://host[:v1]` + `/models`; OpenAI-compatible catalogs expose this. */
export function providerPingUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/models`
}

/**
 * Any HTTP answer proves the server is reachable. 401/403 additionally means
 * the credential was rejected — the route is up but the key is wrong.
 */
export function classifyPingStatus(status: number): ProviderPingState {
  if (status === 401 || status === 403) return 'auth'
  return 'ok'
}

export async function pingProvider(
  target: ProviderPingTarget,
  options: ProviderPingOptions = {},
): Promise<ProviderPingOutcome> {
  if (!target.baseUrl.trim()) return { state: 'unreachable' }
  const url = providerPingUrl(target.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 6_000)
  const started = now()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: target.apiKey?.trim() ? { Authorization: `Bearer ${target.apiKey.trim()}` } : {},
    })
    return {
      state: classifyPingStatus(response.status),
      latencyMs: now() - started,
      status: response.status,
      probedUrl: url,
    }
  } catch {
    // Timeout, DNS failure, TLS error, or refused connection: no server answer.
    return { state: 'unreachable', probedUrl: url }
  } finally {
    clearTimeout(timer)
  }
}
