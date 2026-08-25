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

export interface ProviderCompletionOutcome extends ProviderPingOutcome {
  /** First line of any provider-reported failure detail, truncated for UI use. */
  detail?: string
}

/**
 * Real generation probe. The /models reachability check cannot see the
 * completion path: gateways like OpenRouter answer catalog GETs for everyone
 * while every actual chat/completions call fails upstream. This sends a tiny
 * non-streaming completion with the stored credential so the reported state
 * reflects what sessions will experience.
 */
export function providerCompletionUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
}

export function classifyCompletionStatus(status: number, bodyHasError: boolean): ProviderPingState {
  if (status === 401 || status === 403) return 'auth'
  if (status >= 200 && status < 300) return bodyHasError ? 'unreachable' : 'ok'
  return 'unreachable'
}

export async function probeProviderCompletion(
  target: ProviderPingTarget & { model: string },
  options: ProviderPingOptions = {},
): Promise<ProviderCompletionOutcome> {
  if (!target.baseUrl.trim() || !target.model.trim()) return { state: 'unreachable' }
  const url = providerCompletionUrl(target.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  const started = now()
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(target.apiKey?.trim() ? { Authorization: `Bearer ${target.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: target.model.trim(),
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 16,
        stream: false,
      }),
    })
    const text = await response.text()
    let parsed: { choices?: unknown; error?: { message?: unknown } } = {}
    try { parsed = JSON.parse(text) as typeof parsed } catch { /* HTML or empty bodies stay unparsed */ }
    const detail = typeof parsed.error?.message === 'string' && parsed.error.message.trim()
      ? parsed.error.message.trim().slice(0, 200)
      : undefined
    return {
      state: classifyCompletionStatus(response.status, parsed.error !== undefined),
      latencyMs: now() - started,
      status: response.status,
      probedUrl: url,
      ...(detail ? { detail } : {}),
    }
  } catch {
    return { state: 'unreachable', probedUrl: url }
  } finally {
    clearTimeout(timer)
  }
}
