import { describe, expect, it } from 'vitest'
import {
  chatGptSyncBranchName,
  compileChatGptGitPrompt,
  sanitizeRemoteForPrompt,
} from '../src/main/engines/chatgpt-web/chatgpt-web-engine.js'

describe('ChatGPT Web Git sync helpers', () => {
  it('derives a stable safe branch from the ND chat id', () => {
    expect(chatGptSyncBranchName('chatgpt-web-ABC-123_def')).toBe('nd/chat-abc123def')
    expect(chatGptSyncBranchName('chatgpt-web-ABC-123_def')).toBe(chatGptSyncBranchName('chatgpt-web-ABC-123_def'))
  })

  it('removes URL credentials and metadata before repository data enters a web prompt', () => {
    expect(sanitizeRemoteForPrompt('https://user:secret@github.com/acme/demo.git')).toBe('https://github.com/acme/demo.git')
    expect(sanitizeRemoteForPrompt('https://user:secret@github.com/acme/demo.git?token=oops#private')).toBe('https://github.com/acme/demo.git')
    expect(sanitizeRemoteForPrompt('ssh://user:secret@github.com/acme/demo.git?token=oops#private')).toBe('ssh://github.com/acme/demo.git')
    expect(sanitizeRemoteForPrompt('git@github.com:acme/demo.git')).toBe('git@github.com:acme/demo.git')
  })

  it('tells ChatGPT the exact safe branch and refuses to imply unavailable writes', () => {
    const prompt = compileChatGptGitPrompt('Make the header smaller.', {
      remote: 'origin',
      remoteUrl: 'https://github.com/acme/demo.git',
      branch: 'nd/chat-a1b2c3',
      head: '1234567890abcdef',
      dirty: false,
    })

    expect(prompt).toContain('Branch: nd/chat-a1b2c3')
    expect(prompt).toContain('Expected local HEAD: 1234567890abcdef')
    expect(prompt).toContain('Never push this task directly to main or master.')
    expect(prompt).toContain('do not claim code was pushed')
    expect(prompt).toContain('Make the header smaller.')
  })
})
