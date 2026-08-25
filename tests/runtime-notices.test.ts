import { describe, expect, it } from 'vitest'
import { describeAgentError } from '../src/renderer/src/lib/runtime-notices.js'

describe('runtime failure notices', () => {
  it('keeps an unknown message verbatim', () => {
    const text = 'Something entirely unexpected happened'
    expect(describeAgentError(text, null)).toBe(text)
  })

  it('names the failing route and explains bare upstream envelopes', () => {
    const described = describeAgentError('Provider returned error', { provider: 'openrouter', model: 'stealth/ox-alpha' })
    expect(described.startsWith('Provider returned error')).toBe(true)
    expect(described).toContain('Failing route: openrouter / stealth/ox-alpha')
    expect(described).toContain('model provider’s servers')
    expect(described).toContain('not from ND tools')
  })

  it('classifies credential rejections with a settings pointer', () => {
    const described = describeAgentError('Invalid API key for openrouter', null)
    expect(described).toContain('rejected authentication')
    expect(described).toContain('Model settings')
  })

  it('classifies quota exhaustion as an account limit', () => {
    const described = describeAgentError('Request failed: insufficient_quota', null)
    expect(described).toContain('quota or billing limit')
  })

  it('classifies context overflow without upstream wording', () => {
    const described = describeAgentError('This model’s maximum context length is 65536 tokens', null)
    expect(described).toContain('context window')
  })

  it('classifies transport failures as connectivity problems', () => {
    const described = describeAgentError('TypeError: fetch failed', { provider: 'omniroute', model: 'local' })
    expect(described).toContain('could not reach the model server')
    expect(described).toContain('Failing route: omniroute / local')
  })
})
