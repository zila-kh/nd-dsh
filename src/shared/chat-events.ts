import type { ThreadEntry, TodoItem } from './chat-types.js'

const RESULT_MAX_CHARS = 2_000

export interface HistoryEventEnvelope {
  type: string
  seq: number
  data?: unknown
}

export function foldHistory(events: HistoryEventEnvelope[]): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  for (const envelope of events) {
    if (!envelope) continue
    foldEventInto(entries, envelope)
  }
  return entries
}

export function foldEvent(entries: ThreadEntry[], envelope: HistoryEventEnvelope): ThreadEntry[] {
  // The fold updates entry fields; React may replay an updater with the same
  // previous state, so none of those objects may be shared with that state.
  const next = entries.map((entry) => ({ ...entry }))
  foldEventInto(next, envelope)
  return next
}

function foldEventInto(entries: ThreadEntry[], envelope: HistoryEventEnvelope): void {
  const data = (envelope.data ?? {}) as Record<string, unknown>
  switch (envelope.type) {
    case 'user/message': {
      const text = messageText(data.message)
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'user' && last.text === text) return
      entries.push({ kind: 'user', id: crypto.randomUUID(), text, ...(data.skillMention ? { skillMention: data.skillMention as import('./skill-catalog.js').SkillSuggestion } : {}) })
      return
    }
    case 'assistant/chunk': {
      const text = messageText(data.chunk)
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'assistant' && last.streaming) {
        last.text = `${last.text}${text}`
      } else {
        entries.push({ kind: 'assistant', id: crypto.randomUUID(), text, streaming: true })
      }
      return
    }
    case 'assistant/message': {
      const text = messageText(data.message)
      if (text === undefined) return
      const last = entries.at(-1)
      if (last?.kind === 'assistant' && last.streaming) {
        last.text = text
        last.streaming = false
      } else {
        entries.push({ kind: 'assistant', id: crypto.randomUUID(), text })
      }
      return
    }
    case 'agent/reasoning': {
      const text = typeof data.text === 'string' ? data.text : ''
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'reasoning' && last.text.length < 4000) {
        last.text = `${last.text}\n${text}`
      } else {
        entries.push({ kind: 'reasoning', id: crypto.randomUUID(), text })
      }
      return
    }
    case 'tool/call': {
      const callId = typeof data.callId === 'string' ? data.callId : undefined
      const name = typeof data.name === 'string' ? data.name : 'tool'
      entries.push({ kind: 'tool', id: crypto.randomUUID(), ...(callId === undefined ? {} : { callId }), name, args: data.arguments, status: 'running' })
      return
    }
    case 'tool/result': {
      const runningIndex = entries.findIndex((entry) => entry.kind === 'tool' && entry.status === 'running')
      const text = messageText(data.message) ?? ''
      const summary = typeof data.error === 'string' ? `Error: ${data.error}` : text.slice(0, RESULT_MAX_CHARS)
      if (runningIndex === -1) {
        entries.push({ kind: 'tool', id: crypto.randomUUID(), name: 'tool', status: typeof data.error === 'string' ? 'error' : 'done', result: summary })
      } else {
        const entry = entries[runningIndex]
        if (entry?.kind === 'tool') {
          entry.status = typeof data.error === 'string' ? 'error' : 'done'
          entry.result = summary
        }
      }
      return
    }
    case 'todo/write': {
      const todos = Array.isArray(data.todos) ? data.todos as unknown as TodoItem[] : []
      const last = entries.at(-1)
      if (last?.kind === 'todo') last.items = todos
      else entries.push({ kind: 'todo', id: crypto.randomUUID(), items: todos })
      return
    }
    default:
      // turn/step markers, request headers, compaction records, and plugin
      // events stay out of the surface; the trajectory view owns those.
      return
  }
}

export function messageText(message: unknown): string | undefined {
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return undefined
  const record = message as Record<string, unknown>
  if (typeof record.content === 'string') return record.content
  if (typeof record.text === 'string') return record.text
  if (record.delta && typeof record.delta === 'object') return messageText(record.delta)
  if (!Array.isArray(record.content)) return undefined
  const parts: string[] = []
  for (const block of record.content) {
    if (block && typeof block === 'object' && ['text', 'text-delta', 'output_text'].includes(String((block as Record<string, unknown>).type))) {
      const text = (block as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

