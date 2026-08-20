export const DEFAULT_BROWSER_URL = 'http://localhost:5173'

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i
const DOMAIN_WITH_PORT = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+:\d+(?:[/?#]|$)/i
const ALLOWED_EXPLICIT_PROTOCOL = /^(?:https?|about):/i
const EXPLICIT_PROTOCOL = /^([a-z][a-z\d+.-]*):/i

export function normalizeBrowserUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_BROWSER_URL

  let candidate: string
  if (LOOPBACK_HOST.test(trimmed)) {
    candidate = `http://${trimmed}`
  } else if (DOMAIN_WITH_PORT.test(trimmed)) {
    candidate = `https://${trimmed}`
  } else if (ALLOWED_EXPLICIT_PROTOCOL.test(trimmed)) {
    candidate = trimmed
  } else {
    const protocol = trimmed.match(EXPLICIT_PROTOCOL)?.[1]
    if (protocol) throw new Error(`Unsupported browser protocol: ${protocol.toLowerCase()}:`)
    candidate = `https://${trimmed}`
  }

  const parsed = new URL(candidate)
  if (!isAllowedBrowserUrl(parsed.toString())) throw new Error(`Unsupported browser protocol: ${parsed.protocol}`)
  return parsed.toString()
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.href === 'about:blank'
  } catch {
    return false
  }
}
