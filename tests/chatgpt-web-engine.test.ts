import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ChatGptWebEngine,
  chatGptSyncBranchName,
  compileChatGptGitPrompt,
  sanitizeRemoteForPrompt,
} from '../src/main/engines/chatgpt-web/chatgpt-web-engine.js'

describe('ChatGPT Web Git sync helpers', () => {
  it('derives a stable safe branch from the ND chat id', () => {
    const branch = chatGptSyncBranchName('chatgpt-web-ABC-123_def')
    expect(branch).toBe('nd/chat-abc123def')
    expect(branch).toBe(chatGptSyncBranchName('chatgpt-web-ABC-123_def'))
    expect(branch).not.toBe('main')
    expect(branch).not.toBe('master')
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

  it('normalizes tampered persisted branch and conversation bindings before use', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nd-chatgpt-store-'))
    const storePath = join(directory, 'chatgpt-web-sessions.json')
    const sessionId = 'chatgpt-web-ABC-123_def'
    try {
      writeFileSync(storePath, JSON.stringify({
        version: 1,
        sessions: [{
          sessionId,
          conversationUrl: 'https://evil.example/c/not-chatgpt',
          cwd: '/workspace/demo',
          title: 'Tampered session',
          createdAt: 1,
          updatedAt: 2,
          running: true,
          sequence: 0,
          transcript: [],
          seenTurnKeys: [],
          sentPromptHashes: [],
          branch: 'main',
        }],
      }), 'utf8')

      const engine = new ChatGptWebEngine({
        browser: {} as never,
        git: {} as never,
        workspace: {} as never,
        storePath,
      })
      await engine.close()

      const persisted = JSON.parse(readFileSync(storePath, 'utf8')) as {
        sessions: Array<{ branch: string; conversationUrl?: string; running: boolean }>
      }
      expect(persisted.sessions[0]?.branch).toBe(chatGptSyncBranchName(sessionId))
      expect(persisted.sessions[0]?.branch).not.toBe('main')
      expect(persisted.sessions[0]?.conversationUrl).toBeUndefined()
      expect(persisted.sessions[0]?.running).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
