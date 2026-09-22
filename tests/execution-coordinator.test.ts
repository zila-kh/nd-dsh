import { describe, expect, it } from 'vitest'
import { ExecutionCoordinator, RuntimeCapacityError, type CapacityReleaseEvent } from '../src/main/organization/execution-coordinator.js'

describe('ExecutionCoordinator', () => {
  it('acquires all required pools atomically and exposes the active permit to engine spawns', async () => {
    const coordinator = new ExecutionCoordinator()
    const first = await coordinator.acquire({
      companyId: 'company-1',
      projectId: 'project-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      kind: 'execution',
      pools: [
        { key: 'project:project-1:execution', limit: 1 },
        { key: 'project:project-1:role:engineer', limit: 1 },
      ],
    })

    await coordinator.runWithPermit(first, async () => {
      expect(coordinator.currentPermitId()).toBe(first.id)
    })

    await expect(coordinator.acquire({
      companyId: 'company-1',
      projectId: 'project-1',
      taskId: 'task-2',
      agentId: 'agent-2',
      kind: 'execution',
      pools: [
        { key: 'project:project-1:team:engineering', limit: 1 },
        { key: 'project:project-1:execution', limit: 1 },
      ],
    })).rejects.toThrow(/runtime capacity reached/i)

    // The failed multi-pool acquire must not reserve its earlier team claim.
    const independent = await coordinator.acquire({
      kind: 'execution',
      pools: [{ key: 'project:project-1:team:engineering', limit: 1 }],
    })

    await coordinator.bindSession(first, 'session-1', 'run-1')
    expect(coordinator.snapshot()).toMatchObject({ activePermits: 2, sessions: 1, local: true })
    await coordinator.releaseSession('session-1')
    await coordinator.release(independent)
    expect(coordinator.snapshot()).toEqual({ activePermits: 0, sessions: 0, local: true })
    await coordinator.close()
  })

  it('invalidates permits on core exit and blocks dispatch until durable reconciliation resumes it', async () => {
    const listeners = new Map<string, Set<(frame: never) => void>>()
    const core = {
      request: async () => ({ granted: true, permit: { id: 'native-permit' } }),
      onEvent: (event: string, listener: (frame: never) => void) => {
        let set = listeners.get(event)
        if (!set) { set = new Set(); listeners.set(event, set) }
        set.add(listener)
        return () => set?.delete(listener)
      },
    }
    const coordinator = new ExecutionCoordinator(core as never)
    const permit = await coordinator.acquire({ kind: 'execution', pools: [{ key: 'project:p:execution', limit: 1 }] })
    expect(coordinator.snapshot().activePermits).toBe(1)

    for (const listener of listeners.get('core.exit') ?? []) listener({} as never)
    expect(coordinator.snapshot().activePermits).toBe(0)
    expect(coordinator.recoveryRequired()).toBe(true)
    await expect(coordinator.acquire({ kind: 'execution', pools: [{ key: 'project:p:execution', limit: 1 }] }))
      .rejects.toThrow(/must be reconciled/i)

    coordinator.resumeAfterReconciliation()
    expect(coordinator.recoveryRequired()).toBe(false)
    await coordinator.close()
    expect(permit.id).toBeTruthy()
  })

  it('keeps review and execution pools independent', async () => {
    const coordinator = new ExecutionCoordinator()
    const execution = await coordinator.acquire({
      kind: 'execution',
      pools: [{ key: 'project:p:execution', limit: 1 }],
    })
    const review = await coordinator.acquire({
      kind: 'review',
      pools: [{ key: 'project:p:review', limit: 1 }],
    })

    expect(coordinator.snapshot().activePermits).toBe(2)
    await coordinator.release(execution)
    await coordinator.release(review)
    await coordinator.close()
  })

  it('answers availability per pool without reserving, and names the pool that refuses', async () => {
    const coordinator = new ExecutionCoordinator()
    const pools = [
      { key: 'project:p:execution', limit: 2 },
      { key: 'project:p:role:engineer', limit: 1 },
    ]

    await expect(coordinator.availability(pools)).resolves.toEqual({ granted: true })

    const permit = await coordinator.acquire({ kind: 'execution', projectId: 'p', pools })
    await expect(coordinator.availability(pools)).resolves.toEqual({
      granted: false,
      reason: 'Runtime pool project:p:role:engineer is full (1/1).',
      blockedPool: 'project:p:role:engineer',
    })
    // The probe is not a reservation: it never consumed the project's second slot.
    await expect(coordinator.availability([{ key: 'project:p:execution', limit: 2 }])).resolves.toEqual({ granted: true })
    // A different role's pool is independent of the saturated one.
    await expect(coordinator.availability([{ key: 'project:p:role:reviewer', limit: 1 }])).resolves.toEqual({ granted: true })

    await coordinator.release(permit)
    await expect(coordinator.availability(pools)).resolves.toEqual({ granted: true })
    await coordinator.close()
  })

  it('refuses an over-capacity acquire with a typed error rather than a message to match', async () => {
    const coordinator = new ExecutionCoordinator()
    const pools = [{ key: 'project:p:execution', limit: 1 }]
    await coordinator.acquire({ kind: 'execution', projectId: 'p', pools })

    await expect(coordinator.acquire({ kind: 'execution', projectId: 'p', pools }))
      .rejects.toBeInstanceOf(RuntimeCapacityError)
    await coordinator.close()
  })

  it('announces capacity releases for resume, and stays silent while closing', async () => {
    const coordinator = new ExecutionCoordinator()
    const events: CapacityReleaseEvent[] = []
    const stop = coordinator.onCapacityReleased((event) => events.push(event))

    const execution = await coordinator.acquire({ kind: 'execution', projectId: 'p', pools: [{ key: 'project:p:execution', limit: 1 }] })
    await coordinator.release(execution)
    expect(events).toEqual([{ kind: 'execution', projectId: 'p' }])

    stop()
    const review = await coordinator.acquire({ kind: 'review', projectId: 'p', pools: [{ key: 'project:p:review', limit: 1 }] })
    await coordinator.release(review)
    expect(events).toHaveLength(1)

    // Closing the app releases its permits too; none of those may start work.
    const duringClose: CapacityReleaseEvent[] = []
    coordinator.onCapacityReleased((event) => duringClose.push(event))
    const last = await coordinator.acquire({ kind: 'execution', projectId: 'p', pools: [{ key: 'project:p:execution', limit: 1 }] })
    await coordinator.close()
    expect(duringClose).toEqual([])
    expect(last.id).toBeTruthy()
  })
})
