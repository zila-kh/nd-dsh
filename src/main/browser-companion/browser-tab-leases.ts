import { randomUUID } from 'node:crypto'
import type { BrowserCompanionLeaseScope, BrowserTabLease } from '../../shared/browser-companion.js'

function tabKey(connectionId: string, tabId: number): string {
  return `${connectionId}\u0000${tabId}`
}

export class BrowserTabLeaseStore {
  private readonly byId = new Map<string, BrowserTabLease>()
  private readonly writableByTab = new Map<string, string>()

  acquire(connectionId: string, tabId: number, ownerId: string, scope?: BrowserCompanionLeaseScope): BrowserTabLease {
    const cleanConnection = connectionId.trim()
    const cleanOwner = ownerId.trim()
    if (!cleanConnection || cleanConnection.length > 256) throw new Error('Browser connection id is invalid')
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Browser tab id is invalid')
    if (!cleanOwner || cleanOwner.length > 256) throw new Error('Browser lease owner is invalid')

    const key = tabKey(cleanConnection, tabId)
    const existingId = this.writableByTab.get(key)
    if (existingId) {
      const existing = this.byId.get(existingId)
      if (existing?.ownerId === cleanOwner) return structuredClone(existing)
      throw new Error('Browser tab is already leased by another execution lane')
    }

    const lease: BrowserTabLease = {
      id: randomUUID(),
      connectionId: cleanConnection,
      tabId,
      ownerId: cleanOwner,
      ...(scope ? { scope: sanitizeScope(scope) } : {}),
      acquiredAt: Date.now(),
    }
    this.byId.set(lease.id, lease)
    this.writableByTab.set(key, lease.id)
    return structuredClone(lease)
  }

  assert(leaseId: string, connectionId: string, tabId: number): BrowserTabLease {
    const lease = this.byId.get(leaseId)
    if (!lease) throw new Error('Browser tab lease is missing or expired')
    if (lease.connectionId !== connectionId || lease.tabId !== tabId) {
      throw new Error('Browser tab lease does not own the requested tab')
    }
    return structuredClone(lease)
  }

  release(leaseId: string): boolean {
    const lease = this.byId.get(leaseId)
    if (!lease) return false
    this.byId.delete(leaseId)
    this.writableByTab.delete(tabKey(lease.connectionId, lease.tabId))
    return true
  }

  releaseConnection(connectionId: string): number {
    let released = 0
    for (const lease of [...this.byId.values()]) {
      if (lease.connectionId !== connectionId) continue
      if (this.release(lease.id)) released += 1
    }
    return released
  }

  list(): BrowserTabLease[] {
    return [...this.byId.values()].map((lease) => structuredClone(lease))
  }
}

function sanitizeScope(scope: BrowserCompanionLeaseScope): BrowserCompanionLeaseScope {
  const result: BrowserCompanionLeaseScope = {}
  for (const key of ['companyId', 'projectId', 'taskId', 'runId', 'sessionId'] as const) {
    const value = scope[key]
    if (value === undefined) continue
    const clean = value.trim()
    if (!clean || clean.length > 256) throw new Error(`Browser lease ${key} is invalid`)
    result[key] = clean
  }
  return result
}
