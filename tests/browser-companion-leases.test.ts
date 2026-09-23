import { describe, expect, it } from 'vitest'
import { BrowserTabLeaseStore } from '../src/main/browser-companion/browser-tab-leases.js'

describe('BrowserTabLeaseStore', () => {
  it('allows one writer per connected tab', () => {
    const store = new BrowserTabLeaseStore()
    const lease = store.acquire('chrome-a', 12, 'task-a', { companyId: 'company-a', taskId: 'task-a' })
    expect(store.assert(lease.id, 'chrome-a', 12).ownerId).toBe('task-a')
    expect(() => store.acquire('chrome-a', 12, 'task-b')).toThrow(/already leased/)
    expect(store.release(lease.id)).toBe(true)
    expect(store.acquire('chrome-a', 12, 'task-b').ownerId).toBe('task-b')
  })

  it('releases a lease when its tab closes without touching other tabs', () => {
    const store = new BrowserTabLeaseStore()
    store.acquire('chrome-a', 1, 'task-a')
    store.acquire('chrome-a', 2, 'task-b')
    expect(store.releaseTab('chrome-a', 1)).toBe(true)
    expect(store.releaseTab('chrome-a', 1)).toBe(false)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.tabId).toBe(2)
  })

  it('releases every lease when a browser connection disappears', () => {
    const store = new BrowserTabLeaseStore()
    store.acquire('chrome-a', 1, 'task-a')
    store.acquire('chrome-a', 2, 'task-b')
    store.acquire('chrome-b', 3, 'task-c')
    expect(store.releaseConnection('chrome-a')).toBe(2)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.connectionId).toBe('chrome-b')
  })
})
