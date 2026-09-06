import { describe, expect, it } from 'vitest'
import { foldEvent, foldHistory, type HistoryEventEnvelope } from '../src/shared/chat-events.js'
import type { ThreadEntry } from '../src/shared/chat-types.js'

function message(type: string, seq: number, text: string): HistoryEventEnvelope {
  return { type, seq, data: { [type === 'assistant/chunk' ? 'chunk' : 'message']: { content: text } } }
}

describe('chat event folding', () => {
  it('does not mutate streaming state when React replays an update', () => {
    const previous: ThreadEntry[] = [{ kind: 'assistant', id: 'reply', text: 'Hel', streaming: true }]
    Object.freeze(previous[0])
    const chunk = message('assistant/chunk', 1, 'lo!')
    expect(foldEvent(previous, chunk)).toEqual(foldEvent(previous, chunk))
    expect(previous[0]).toMatchObject({ text: 'Hel', streaming: true })

    const streamed = foldEvent(previous, chunk)
    Object.freeze(streamed[0])
    const final = message('assistant/message', 2, 'Hello!')
    const completed = foldEvent(streamed, final)
    expect(foldEvent(streamed, final)).toEqual(completed)
    expect(completed).toEqual([{ kind: 'assistant', id: 'reply', text: 'Hello!', streaming: false }])
  })

  it('keeps live and restored message order, including identical turns', () => {
    const events = [
      message('user/message', 1, 'hi'),
      message('assistant/message', 2, 'Hello!'),
      message('user/message', 3, 'hi'),
      message('assistant/message', 4, 'Hello!'),
    ]
    const live = events.reduce<ThreadEntry[]>((entries, event) => foldEvent(entries, event), [])
    const contents = (entries: ThreadEntry[]) => entries.map((entry) => ({ kind: entry.kind, text: 'text' in entry ? entry.text : '' }))
    expect(contents(live)).toEqual([
      { kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'Hello!' },
      { kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'Hello!' },
    ])
    expect(contents(foldHistory(events))).toEqual(contents(live))
  })

  it('folds text-delta chunk payloads emitted by streaming runtimes', () => {
    const entries = foldHistory([
      { type: 'assistant/chunk', seq: 1, data: { chunk: { type: 'text-delta', text: 'Hello' } } },
      { type: 'assistant/chunk', seq: 2, data: { chunk: { type: 'text-delta', text: ' world' } } },
      { type: 'assistant/message', seq: 3, data: { message: { content: 'Hello world' } } },
    ])
    expect(entries).toEqual([{ kind: 'assistant', id: expect.any(String), text: 'Hello world', streaming: false }])
  })
})
