import { describe, expect, it } from 'vitest'
import { applyMention, detectMentionTrigger } from '../src/shared/mentions.js'

describe('detectMentionTrigger', () => {
  it('detects a leading slash skill token at the caret', () => {
    expect(detectMentionTrigger('/chat', 5)).toEqual({ kind: 'skill', query: 'chat', start: 0, end: 5 })
  })

  it('detects a bare slash', () => {
    expect(detectMentionTrigger('/', 1)).toEqual({ kind: 'skill', query: '', start: 0, end: 1 })
  })

  it('does not trigger a slash that is not the leading token', () => {
    expect(detectMentionTrigger('use /chat', 9)).toBeNull()
    expect(detectMentionTrigger('x/chat', 6)).toBeNull()
  })

  it('closes the skill trigger once the token contains a path separator', () => {
    expect(detectMentionTrigger('/src/main', 10)).toBeNull()
  })

  it('detects an at-file token after whitespace', () => {
    expect(detectMentionTrigger('read @src/ma', 12)).toEqual({ kind: 'file', query: 'src/ma', start: 5, end: 12 })
    expect(detectMentionTrigger('@ipc', 4)).toEqual({ kind: 'file', query: 'ipc', start: 0, end: 4 })
  })

  it('does not trigger an at inside a word', () => {
    expect(detectMentionTrigger('user@example', 12)).toBeNull()
  })

  it('returns null when the caret is outside the token', () => {
    expect(detectMentionTrigger('/chat rest', 10)).toBeNull()
    expect(detectMentionTrigger('hello', 0)).toBeNull()
  })
})

describe('applyMention', () => {
  it('replaces the skill token and keeps trailing text without double spaces', () => {
    const trigger = detectMentionTrigger('/cha do work', 4)
    expect(applyMention('/cha do work', trigger!, '/chatgpt-web')).toEqual({
      value: '/chatgpt-web do work',
      caret: 12,
    })
  })

  it('replaces a file token mid-message and adds a separating space', () => {
    const trigger = detectMentionTrigger('open @ipc please', 9)
    expect(applyMention('open @ipc please', trigger!, '@/src/main/ipc.ts')).toEqual({
      value: 'open @/src/main/ipc.ts please',
      caret: 22,
    })
  })

  it('appends no trailing space at the end of the composer', () => {
    const trigger = detectMentionTrigger('/cha', 4)
    expect(applyMention('/cha', trigger!, '/chatgpt-web')).toEqual({
      value: '/chatgpt-web',
      caret: 12,
    })
  })
})
