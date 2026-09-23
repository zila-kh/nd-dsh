import { randomUUID } from 'node:crypto'
import type { BrowserExecutionScope, BrowserTabLease } from '../../shared/browser-platform.js'

function tabKey(targetId: string, tabId: string): string {
  return `${targetId}\u0000${tabId}`
}

export class UnifiedBrowserTabLeaseStore {
  private readonly byId = new Map<string, BrowserTabLease>()
  private readonly writableByTab = new Map<string, string>()

  acquire(input: {
    ownerId: string
    targetId: string
    profileId: string
    tabId: string
    scope?: BrowserExecutionScope
  }): BrowserTabLease {
    const ownerId = clean(input.ownerId, 'owner id')
    const targetId = clean(input.targetId, 'target id')
    const profileId = clean(input.profileId, 'profile id')
    const tabId = clean(input.tabId, 'tab id')
    const key = tabKey(targetId, tabId)

    const existingId = this.writableByTab.get(key)
    if (existingId) {
      const existing = this.byId.get(existingId)
      if (existing?.ownerId === ownerId && sameScope(existing.scope, input.scope)) return structuredClone(existing)
      throw new Error('Browser tab is already leased by another execution lane')
    }

    const lease: BrowserTabLease = {
      id: randomUUID(),
      ownerId,
      targetId,
      profileId,
      tabId,
      ...(input.scope ? { scope: sanitizeScope(input.scope) } : {}),
      acquiredAt: Date.now(),
    }
    this.byId.set(lease.id, lease)
    this.writableByTab.set(key, lease.id)
    return structuredClone(lease)
  }

  assert(leaseId: string, targetId: string, tabId: string, ownerId?: string): BrowserTabLease {
    const lease = this.byId.get(leaseId)
    if (!lease) throw new Error('Browser tab lease is missing or expired')
    if (lease.targetId !== targetId || lease.tabId !== tabId) {
      throw new Error('Browser tab lease does not own the requested tab')
    }
    if (ownerId !== undefined && lease.ownerId !== ownerId) {
      throw new Error('Browser tab lease belongs to a different execution lane')
    }
    return structuredClone(lease)
  }

  release(leaseId: string): boolean {
    const lease = this.byId.get(leaseId)
    if (!lease) return false
    this.byId.delete(leaseId)
    this.writableByTab.delete(tabKey(lease.targetId, lease.tabId))
    return true
  }

  releaseTab(targetId: string, tabId: string): boolean {
    const leaseId = this.writableByTab.get(tabKey(targetId, tabId))
    return leaseId ? this.release(leaseId) : false
  }

  releaseTarget(targetId: string): number {
    let released = 0
    for (const lease of [...this.byId.values()]) {
      if (lease.targetId !== targetId) continue
      if (this.release(lease.id)) released += 1
    }
    return released
  }

  releaseOwner(ownerId: string): number {
    let released = 0
    for (const lease of [...this.byId.values()]) {
      if (lease.ownerId !== ownerId) continue
      if (this.release(lease.id)) released += 1
    }
    return released
  }

  list(): BrowserTabLease[] {
    return [...this.byId.values()].map((lease) => structuredClone(lease))
  }
}

function clean(value: string, label: string): string {
  const result = value.trim()
  if (!result || result.length > 512) throw new Error(`Browser lease ${label} is invalid`)
  return result
}

function sanitizeScope(scope: BrowserExecutionScope): BrowserExecutionScope {
  const result: BrowserExecutionScope = {}
  for (const key of ['sessionId', 'companyId', 'projectId', 'taskId', 'runId'] as const) {
    const value = scope[key]
    if (value === undefined) continue
    result[key] = clean(value, key)
  }
  return result
}

function sameScope(left: BrowserExecutionScope | undefined, right: BrowserExecutionScope | undefined): boolean {
  const a = left ?? {}
  const b = right ?? {}
  return ['sessionId', 'companyId', 'projectId', 'taskId', 'runId'].every((key) =>
    a[key as keyof BrowserExecutionScope] === b[key as keyof BrowserExecutionScope])
}
