export type MentionTrigger =
  | { kind: 'skill'; query: string; start: number; end: number }
  | { kind: 'file'; query: string; start: number; end: number }

const isWhitespace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)

/**
 * Finds the active mention token under the caret. '/' only triggers as the
 * leading token of the composer (the runtime's skill-invocation contract);
 * '@' triggers at the start of any word.
 */
export function detectMentionTrigger(value: string, caret: number): MentionTrigger | null {
  if (caret <= 0 || caret > value.length) return null
  const end = caret
  let start = caret - 1
  while (start >= 0 && !isWhitespace(value[start])) start -= 1
  start += 1
  if (start >= end) return null
  const marker = value[start]
  if (marker !== '/' && marker !== '@') return null
  const query = value.slice(start + 1, end)
  if (marker === '/') {
    if (start !== 0) return null
    if (query.includes('/')) return null
  } else if (start !== 0 && !isWhitespace(value[start - 1])) {
    return null
  }
  return { kind: marker === '/' ? 'skill' : 'file', query, start, end }
}

/**
 * Replaces the active token with the accepted mention text, adding a trailing
 * space only when more text follows, and returns the new composer value plus
 * the caret position after the token.
 */
export function applyMention(value: string, trigger: MentionTrigger, token: string): { value: string; caret: number } {
  const rest = value.slice(trigger.end)
  const insert = token + (rest === '' || /^\s/.test(rest) ? '' : ' ')
  return {
    value: value.slice(0, trigger.start) + insert + rest,
    caret: trigger.start + insert.length,
  }
}
