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

  it('folds raw runtime user and assistant events where content is on data directly', () => {
    const entries = foldHistory([
      {
        type: 'user/message',
        seq: 1,
        data: {
          id: 'user-msg-1',
          role: 'user',
          content: [{ type: 'text', text: 'Build habit tracker' }],
          source: { kind: 'user' },
        },
      },
      {
        type: 'assistant/message',
        seq: 2,
        data: {
          id: 'asst-msg-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Working on habit tracker...' }],
        },
      },
    ])
    expect(entries).toEqual([
      { kind: 'user', id: expect.any(String), text: 'Build habit tracker' },
      { kind: 'assistant', id: expect.any(String), text: 'Working on habit tracker...' },
    ])
  })

  it('keeps Harness-injected context out of the user messages', () => {
    const entries = foldHistory([
      { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, message: { content: 'hi' } } },
      {
        type: 'user/message',
        seq: 2,
        data: {
          source: { kind: 'agent-instructions' },
          message: { content: '<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>' },
        },
      },
      { type: 'user/message', seq: 3, data: { source: { kind: 'plugin' }, message: { content: 'Current runtime context.' } } },
      { type: 'user/message', seq: 4, data: { source: { kind: 'skill-catalog' }, message: { content: '<available_skills />' } } },
      { type: 'assistant/message', seq: 5, data: { message: { content: 'Hello!' } } },
    ])

    expect(entries.filter((entry) => entry.kind === 'user')).toEqual([
      { kind: 'user', id: expect.any(String), text: 'hi' },
    ])
    expect(entries.filter((entry) => entry.kind === 'context').map((entry) => entry.source)).toEqual([
      'agent-instructions', 'plugin', 'skill-catalog',
    ])
    // The injected blocks keep their own text; only their attribution changes.
    expect(entries.find((entry) => entry.kind === 'context' && entry.source === 'plugin'))
      .toMatchObject({ text: 'Current runtime context.' })
    expect(entries.at(-1)).toMatchObject({ kind: 'assistant', text: 'Hello!' })
  })

  it('drops the product workspace block from the visible user message', () => {
    const entries = foldHistory([
      {
        type: 'user/message',
        seq: 1,
        data: {
          source: { kind: 'user' },
          message: { content: 'Fix the login bug\n\n[ND-DSH WORKSPACE CONTEXT]\n{"workspaceName":"nd-dsh"}\n[/ND-DSH WORKSPACE CONTEXT]' },
        },
      },
    ])
    expect(entries).toEqual([{ kind: 'user', id: expect.any(String), text: 'Fix the login bug' }])
  })

  it('keeps an untagged user message from a session recorded before source tags', () => {
    const entries = foldHistory([message('user/message', 1, 'hi')])
    expect(entries).toEqual([{ kind: 'user', id: expect.any(String), text: 'hi' }])
  })
})
