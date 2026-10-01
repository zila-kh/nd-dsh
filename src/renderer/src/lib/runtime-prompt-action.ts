/** Show the exact correlated tool arguments with common credential forms redacted. */
export function runtimePromptAction(argumentsValue: unknown): string | undefined {
  if (argumentsValue === undefined) return undefined
  try {
    const serialized = JSON.stringify(argumentsValue, (key, value: unknown) => {
      if (/(?:secret|password|token|api[_-]?key|authorization|private[_-]?key)/i.test(key)) return '[redacted]'
      if (typeof value !== 'string') return value
      return value
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[redacted]@')
        .replace(/((?:--[\w-]*(?:api[_-]?key|token|secret|password)|[\w]*(?:API_KEY|TOKEN|SECRET|PASSWORD))\s*(?:=|:|\s)\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1[redacted]')
        .replace(/([?&](?:api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[redacted]')
    }, 2)
    if (!serialized) return undefined
    return serialized.length > 4_000 ? serialized.slice(0, 4_000) + '\n… (remaining arguments omitted)' : serialized
  } catch {
    return undefined
  }
}
