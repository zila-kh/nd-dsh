import { describe, expect, it } from 'vitest'
import { BrowserAccessTokenStore } from '../src/main/browser-platform/browser-access-tokens.js'

describe('BrowserAccessTokenStore', () => {
  it('issues opaque stable tokens per session and revokes them', () => {
    const store = new BrowserAccessTokenStore()
    const first = store.issue('session-a')
    const again = store.issue('session-a')
    const other = store.issue('session-b')
    expect(first).toBe(again)
    expect(other).not.toBe(first)
    expect(first).not.toContain('session-a')
    expect(store.session(first)).toBe('session-a')
    expect(store.revokeSession('session-a')).toBe(true)
    expect(store.session(first)).toBeUndefined()
  })
})
