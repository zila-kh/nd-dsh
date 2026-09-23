import { describe, expect, it } from 'vitest'
import { UnifiedBrowserTabLeaseStore } from '../src/main/browser-platform/browser-tab-leases.js'

describe('UnifiedBrowserTabLeaseStore', () => {
  it('allows one trusted writer per target/tab and binds scope', () => {
    const store = new UnifiedBrowserTabLeaseStore()
    const lease = store.acquire({
      ownerId: 'session-a',
      targetId: 'builtin',
      profileId: 'builtin:default',
      tabId: 'tab-a',
      scope: { sessionId: 'session-a', companyId: 'company-a', projectId: 'project-a', taskId: 'task-a', runId: 'run-a' },
    })
    expect(store.assert(lease.id, 'builtin', 'tab-a', 'session-a').scope?.companyId).toBe('company-a')
    expect(() => store.acquire({
      ownerId: 'session-b',
      targetId: 'builtin',
      profileId: 'builtin:default',
      tabId: 'tab-a',
      scope: { sessionId: 'session-b', companyId: 'company-b', projectId: 'project-b' },
    })).toThrow(/already leased/)
    expect(() => store.releaseOwned(lease.id, 'session-b')).toThrow(/different execution lane/)
    expect(store.releaseOwned(lease.id, 'session-a')).toBe(true)
  })

  it('isolates same native-looking tab id across targets', () => {
    const store = new UnifiedBrowserTabLeaseStore()
    store.acquire({ ownerId: 'a', targetId: 'builtin', profileId: 'builtin:default', tabId: '12' })
    store.acquire({ ownerId: 'b', targetId: 'companion:chrome-a', profileId: 'companion-profile:chrome-a', tabId: '12' })
    expect(store.list()).toHaveLength(2)
    expect(store.releaseTarget('companion:chrome-a')).toBe(1)
    expect(store.list()[0]?.targetId).toBe('builtin')
  })

  it('releases every tab owned by a stopped session', () => {
    const store = new UnifiedBrowserTabLeaseStore()
    store.acquire({ ownerId: 'session-a', targetId: 'builtin', profileId: 'builtin:default', tabId: 'one' })
    store.acquire({ ownerId: 'session-a', targetId: 'builtin', profileId: 'builtin:default', tabId: 'two' })
    store.acquire({ ownerId: 'session-b', targetId: 'builtin', profileId: 'builtin:default', tabId: 'three' })
    expect(store.releaseOwner('session-a')).toBe(2)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.ownerId).toBe('session-b')
  })
})
