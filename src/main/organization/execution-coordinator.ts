import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { CoreClient } from '../core/core-client.js'

export interface RuntimePoolClaim {
  key: string
  limit: number
}

export interface RuntimePermitInput {
  companyId?: string
  projectId?: string
  taskId?: string
  agentId?: string
  kind: 'execution' | 'review'
  pools: RuntimePoolClaim[]
}

export interface RuntimePermit {
  id: string
  sessionId?: string
  input: RuntimePermitInput
}

/**
 * A structured answer to "would an acquire with these pools succeed right now?".
 * Callers that dispatch work one task at a time (the Autopilot fill) need to
 * decide before starting a run; without this they can only attempt the run and
 * guess from the failure text, which turns real errors into fake capacity.
 */
export interface RuntimeAvailability {
  granted: boolean
  reason?: string
  /** The pool that refused, so a caller can tell a per-task limit from a project-wide one. */
  blockedPool?: string
}

/**
 * A permit acquire that was refused because a pool is full. A caller that
 * dispatched speculatively treats this as "not now" — the run never started, so
 * there is no failure to report — rather than matching on the message.
 */
export class RuntimeCapacityError extends Error {
  readonly code = 'runtime-capacity'
}

export interface CapacityReleaseEvent {
  kind: RuntimePermitInput['kind']
  projectId?: string
}

interface CoreAcquireResult {
  granted: boolean
  reason?: string
  permit?: { id: string }
}

interface LocalPermit {
  id: string
  pools: RuntimePoolClaim[]
}

export class ExecutionCoordinator {
  private readonly permits = new Map<string, RuntimePermit>()
  private readonly sessionPermits = new Map<string, string>()
  private readonly localPermits = new Map<string, LocalPermit>()
  private readonly permitContext = new AsyncLocalStorage<RuntimePermit>()
  private readonly heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private readonly disposeCoreExit: (() => void) | undefined
  private readonly releaseListeners = new Set<(event: CapacityReleaseEvent) => void>()
  private coreChain: Promise<unknown> = Promise.resolve()
  private blockedReason: string | undefined
  private closing = false

  constructor(private readonly core?: Pick<CoreClient, 'request' | 'onEvent'>) {
    if (core) {
      this.disposeCoreExit = core.onEvent('core.exit', () => {
        this.invalidateForCoreRestart('ND Core restarted while organization work was active. Durable runs must be reconciled before new dispatch.')
      })
      this.heartbeatTimer = setInterval(() => {
        void this.heartbeat().catch((error) => {
          console.warn('ND Core permit heartbeat failed:', error instanceof Error ? error.message : String(error))
        })
      }, 30_000)
      this.heartbeatTimer.unref()
    }
  }

  async acquire(input: RuntimePermitInput): Promise<RuntimePermit> {
    if (this.blockedReason) throw new Error(this.blockedReason)
    validatePools(input.pools)
    const id = randomUUID()
    if (this.core) {
      const result = await this.coreRequest<CoreAcquireResult>('scheduler.acquire', {
        permitId: id,
        companyId: input.companyId,
        projectId: input.projectId,
        taskId: input.taskId,
        agentId: input.agentId,
        kind: input.kind,
        pools: input.pools,
        ttlMs: 120_000,
      }, 5_000)
      if (!result.granted || !result.permit) {
        throw new RuntimeCapacityError(result.reason ?? 'ND Core runtime capacity is unavailable.')
      }
    } else {
      this.acquireLocal(id, input.pools)
    }
    const permit: RuntimePermit = { id, input }
    this.permits.set(id, permit)
    return permit
  }

  /**
   * Read-only capacity probe for callers that dispatch one unit of work at a
   * time. It is not a reservation: the acquire that follows is still the only
   * authority, and a grant here can be lost to a competing dispatch.
   */
  async availability(claims: RuntimePoolClaim[]): Promise<RuntimeAvailability> {
    validatePools(claims)
    if (this.blockedReason) return { granted: false, reason: this.blockedReason }
    if (this.core) {
      let pools: Record<string, number>
      try {
        const snapshot = await this.coreRequest<{ pools?: Record<string, number> }>('scheduler.snapshot', {}, 5_000)
        pools = snapshot?.pools ?? {}
      } catch (error) {
        // Failing closed is the point: an unreachable scheduler cannot prove
        // there is room, and dispatching anyway would exceed the caps.
        return { granted: false, reason: `ND Core runtime capacity is unavailable: ${error instanceof Error ? error.message : String(error)}` }
      }
      return availabilityFrom(claims, (key) => pools[key] ?? 0)
    }
    return availabilityFrom(claims, (key) => [...this.localPermits.values()]
      .filter((permit) => permit.pools.some((pool) => pool.key === key))
      .length)
  }

  /**
   * Notifies after a permit is released so a dispatch round that ended on a full
   * pool can resume without waiting for an unrelated lifecycle event. Releases
   * during shutdown are not announced: closing the app must not start work.
   */
  onCapacityReleased(listener: (event: CapacityReleaseEvent) => void): () => void {
    this.releaseListeners.add(listener)
    return () => this.releaseListeners.delete(listener)
  }

  runWithPermit<T>(permit: RuntimePermit, operation: () => Promise<T>): Promise<T> {
    if (!this.permits.has(permit.id)) return Promise.reject(new Error('Runtime permit is no longer active.'))
    return this.permitContext.run(permit, operation)
  }

  currentPermitId(): string | undefined {
    return this.permitContext.getStore()?.id
  }

  /**
   * The permit that owns the current async context, if any. Cost attribution
   * needs the whole permit (task and bound session), not just its id.
   */
  currentPermit(): RuntimePermit | undefined {
    return this.permitContext.getStore()
  }

  async bindSession(permit: RuntimePermit, sessionId: string, runId?: string): Promise<void> {
    if (!this.permits.has(permit.id)) throw new Error('Runtime permit is no longer active.')
    if (!sessionId.trim()) throw new Error('Runtime session id is required.')
    const previous = this.sessionPermits.get(sessionId)
    if (previous && previous !== permit.id) throw new Error('Runtime session already owns another permit.')
    if (this.core) {
      await this.coreRequest('scheduler.bind', {
        permitId: permit.id,
        sessionId,
        ...(runId ? { runId } : {}),
      }, 5_000)
    }
    permit.sessionId = sessionId
    this.sessionPermits.set(sessionId, permit.id)
  }

  async releaseSession(sessionId: string): Promise<void> {
    const permitId = this.sessionPermits.get(sessionId)
    if (!permitId) return
    this.sessionPermits.delete(sessionId)
    await this.releaseById(permitId)
  }

  async release(permit: RuntimePermit): Promise<void> {
    if (permit.sessionId) this.sessionPermits.delete(permit.sessionId)
    await this.releaseById(permit.id)
  }

  invalidateForCoreRestart(reason: string): void {
    this.blockedReason = reason
    this.permits.clear()
    this.sessionPermits.clear()
    this.localPermits.clear()
  }

  recoveryRequired(): boolean {
    return this.blockedReason !== undefined
  }

  resumeAfterReconciliation(): void {
    this.blockedReason = undefined
  }

  async close(): Promise<void> {
    this.closing = true
    this.disposeCoreExit?.()
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    const permits = [...this.permits.values()]
    await Promise.allSettled(permits.map((permit) => this.release(permit)))
  }

  snapshot(): { activePermits: number; sessions: number; local: boolean } {
    return {
      activePermits: this.permits.size,
      sessions: this.sessionPermits.size,
      local: !this.core,
    }
  }

  private coreRequest<T = unknown>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.core) return Promise.reject(new Error('ND Core is unavailable.'))
    const operation = this.coreChain
      .catch(() => undefined)
      .then(() => this.core!.request<T>(method, params, timeoutMs))
    this.coreChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private acquireLocal(id: string, pools: RuntimePoolClaim[]): void {
    for (const claim of pools) {
      const used = [...this.localPermits.values()]
        .filter((permit) => permit.pools.some((pool) => pool.key === claim.key))
        .length
      if (used >= claim.limit) {
        throw new RuntimeCapacityError('Runtime capacity reached for ' + claim.key + ' (' + used + '/' + claim.limit + ').')
      }
    }
    this.localPermits.set(id, { id, pools })
  }

  private async releaseById(permitId: string): Promise<void> {
    const permit = this.permits.get(permitId)
    if (!this.permits.delete(permitId)) return
    this.localPermits.delete(permitId)
    if (permit) this.announceRelease(permit)
    if (!this.core) return
    await this.coreRequest('scheduler.release', { permitId }, 5_000).catch((error) => {
      console.warn('ND Core permit release failed:', error instanceof Error ? error.message : String(error))
    })
  }

  private announceRelease(permit: RuntimePermit): void {
    if (this.closing) return
    for (const listener of [...this.releaseListeners]) {
      try {
        listener({ kind: permit.input.kind, ...(permit.input.projectId ? { projectId: permit.input.projectId } : {}) })
      } catch (error) {
        console.warn('Runtime capacity release listener failed:', error instanceof Error ? error.message : String(error))
      }
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.core || this.permits.size === 0) return
    await Promise.all([...this.permits.keys()].map(async (permitId) => {
      try {
        await this.coreRequest('scheduler.heartbeat', { permitId, ttlMs: 120_000 }, 5_000)
      } catch (error) {
        const permit = this.permits.get(permitId)
        if (permit?.sessionId) this.sessionPermits.delete(permit.sessionId)
        this.permits.delete(permitId)
        throw error
      }
    }))
  }
}

function availabilityFrom(claims: RuntimePoolClaim[], used: (key: string) => number): RuntimeAvailability {
  for (const claim of claims) {
    const count = used(claim.key)
    if (count >= claim.limit) {
      return { granted: false, reason: `Runtime pool ${claim.key} is full (${count}/${claim.limit}).`, blockedPool: claim.key }
    }
  }
  return { granted: true }
}

function validatePools(pools: RuntimePoolClaim[]): void {
  if (pools.length === 0 || pools.length > 16) throw new Error('Runtime permit must contain between 1 and 16 pools.')
  const keys = new Set<string>()
  for (const pool of pools) {
    if (!pool.key.trim() || pool.key.length > 512) throw new Error('Runtime pool key is invalid.')
    if (!Number.isInteger(pool.limit) || pool.limit < 1 || pool.limit > 1024) throw new Error('Runtime pool limit is invalid.')
    if (keys.has(pool.key)) throw new Error('Runtime permit contains a duplicate pool key.')
    keys.add(pool.key)
  }
}
