/**
 * Copy for runtime failure notices.
 *
 * The gateway relays agent failures verbatim (`errorChain` over the thrown
 * value), and providers like OpenRouter answer upstream outages with a bare
 * "Provider returned error" envelope that carries no further detail on the
 * wire. The notice therefore keeps the original message first and adds what ND
 * knows locally: which configured route failed and what is worth checking.
 */

export interface AgentErrorRoute {
  provider: string
  model: string
}

const UPSTREAM_FAILURE = /provider.?returned.?error|overloaded|service.?unavailable|server.?error|internal.?error|\b50[0234]\b|\b524\b/i
const CREDENTIAL_FAILURE = /\b(?:api[- ]?key|credential)\b|\b401\b|\b403\b|unauthorized|forbidden|invalid api key/i
const QUOTA_FAILURE = /insufficient[_ ]?quota|quota exceeded|out of budget|billing|usage limit|credit/i
const CONTEXT_FAILURE = /context (?:window|length)|too large|too long|exceed/i
const NETWORK_FAILURE = /fetch failed|connection refused|ENOTFOUND|ETIMEDOUT|socket hang up|network/i

export function describeAgentError(message: string, route?: AgentErrorRoute | null): string {
  const base = message.trim()
  const routeLine = route?.provider && route?.model
    ? `\n\nFailing route: ${route.provider} / ${route.model}.`
    : ''
  const hint = hintFor(base)
  return hint ? `${base}${routeLine}\n\n${hint}` : base
}

function hintFor(message: string): string | undefined {
  if (UPSTREAM_FAILURE.test(message)) {
    return 'This came from the model provider’s servers after ND delivered the request — not from ND tools or your prompt. OpenRouter-style envelopes often carry no further detail. Retry, or switch routes in Model settings.'
  }
  if (CREDENTIAL_FAILURE.test(message)) {
    return 'The model provider rejected authentication. Check the stored credential in Model settings, then resend.'
  }
  if (QUOTA_FAILURE.test(message)) {
    return 'The account behind this route hit a quota or billing limit. Check the provider console, or switch routes in Model settings.'
  }
  if (CONTEXT_FAILURE.test(message)) {
    return 'The turn did not fit this model’s context window. Trim attached context or switch to a larger-context route.'
  }
  if (NETWORK_FAILURE.test(message)) {
    return 'ND could not reach the model server. Check network connectivity and the route’s Base URL, then retry.'
  }
  return undefined
}
