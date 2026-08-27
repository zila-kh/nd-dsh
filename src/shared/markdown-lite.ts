/**
 * Minimal, dependency-free markdown block parser tuned for LLM chat output:
 * fenced code blocks, headings, bullet/ordered lists, blockquotes, and
 * paragraphs. Inline formatting (bold/italic/inline code) is tokenized for
 * the renderer; never HTML, so output is safe React nodes.
 */

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }

export type MarkdownBlock =
  | { kind: 'code'; language: string; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'paragraph'; text: string }

const FENCE_OPEN = /^```(\w*)\s*$/
const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/

/** Tokenize one line's inline markdown: `code`, **bold**, *italic*. */
export function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  // Non-greedy runs; backtick code wins so ** inside code stays literal.
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) tokens.push({ kind: 'text', text: text.slice(cursor, start) })
    cursor = start + match[0].length
    if (match[1] !== undefined) tokens.push({ kind: 'code', text: match[1] })
    else if (match[2] !== undefined) tokens.push({ kind: 'bold', text: match[2] })
    else if (match[3] !== undefined) tokens.push({ kind: 'italic', text: match[3] })
  }
  if (cursor < text.length) tokens.push({ kind: 'text', text: text.slice(cursor) })
  return tokens.length > 0 ? tokens : [{ kind: 'text', text }]
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const fence = FENCE_OPEN.exec(line.trim())
    if (fence) {
      const language = fence[1] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '')
        i++
      }
      i++ // consume closing fence (or EOF for a streaming open block)
      blocks.push({ kind: 'code', language, text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line.trim())
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]!.trim() })
      i++
      continue
    }
    const bullet = BULLET.exec(line.trim())
    if (bullet) {
      const items: string[] = []
      while (i < lines.length) {
        const match = BULLET.exec((lines[i] ?? '').trim())
        if (!match) break
        items.push(match[1]!.trim())
        i++
      }
      blocks.push({ kind: 'bullet-list', items })
      continue
    }
    const ordered = ORDERED.exec(line.trim())
    if (ordered) {
      const items: string[] = []
      while (i < lines.length) {
        const match = ORDERED.exec((lines[i] ?? '').trim())
        if (!match) break
        items.push(match[1]!.trim())
        i++
      }
      blocks.push({ kind: 'ordered-list', items })
      continue
    }
    const quote = QUOTE.exec(line.trim())
    if (quote) {
      const body: string[] = []
      while (i < lines.length) {
        const match = QUOTE.exec((lines[i] ?? '').trim())
        if (!match) break
        body.push(match[1]!.trim())
        i++
      }
      blocks.push({ kind: 'quote', text: body.join(' ') })
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length) {
      const current = lines[i] ?? ''
      if (!current.trim()) break
      const trimmed = current.trim()
      if (FENCE_OPEN.test(trimmed) || HEADING.test(trimmed) || BULLET.test(trimmed) || ORDERED.test(trimmed) || QUOTE.test(trimmed)) break
      paragraph.push(trimmed)
      i++
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }
  return blocks
}
