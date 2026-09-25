import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrganizationSnapshot } from '../src/shared/organization.js'
import { OrganizationControlPlane, taskDispatchAvailability } from '../src/main/organization/control-plane.js'
import { ExecutionCoordinator } from '../src/main/organization/execution-coordinator.js'
import { ComputeLedger } from '../src/main/compute/compute-ledger.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function organization(): OrganizationSnapshot {
  const now = Date.now()
  return {
    version: 1,
    activeCompanyId: 'company-1',
    activeProjectId: 'project-1',
    companies: [{ id: 'company-1', name: 'Acme', mission: 'Ship verified software', autonomyLevel: 4, status: 'active', createdAt: now, updatedAt: now }],
    projects: [{ id: 'project-1', companyId: 'company-1', name: 'App', objective: 'Build it', status: 'active', repoUrls: [], teamIds: [], progress: 0, createdAt: now, updatedAt: now }],
    roles: [], teams: [], agents: [], skills: [], workflows: [], goals: [], milestones: [], tasks: [], memory: [], policies: [], activity: [], runs: [], coordination: [],
  }
}

async function fixture(computeLedger?: ComputeLedger) {
  const root = await mkdtemp(join(tmpdir(), 'nd-control-'))
  temporary.push(root)
  const value = organization()
  const store = {
    state: async () => structuredClone(value),
    taskContext: async (taskId: string) => ({
      company: value.companies[0]!,
      project: value.projects[0]!,
      task: {
        id: taskId,
        companyId: 'company-1',
        projectId: 'project-1',
        title: 'Fixture task',
        description: 'Synthetic control-plane fixture task',
        status: 'review',
        priority: 'medium',
        acceptanceCriteria: [],
        dependsOn: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      role: undefined,
      agent: undefined,
      skills: [],
      memory: [],
      policies: [],
    }),
  }
  return { root, value, control: new OrganizationControlPlane(join(root, 'control.json'), store as never, computeLedger) }
}

describe('organization control plane', () => {
  it('distinguishes a scoped human gate from ordinary runnable work', async () => {
    const { control } = await fixture()
    await control.mutate({
      type: 'human-action.add', companyId: 'company-1', projectId: 'project-1', kind: 'gate',
      title: 'Production choice', question: 'Choose the production data strategy.', scopes: ['task.execute'],
    })

    const blocked = await control.shouldRun('project-1', 'task.execute')
    expect(blocked.route).toBe('human_action_required')
    expect(blocked.humanActionIds).toHaveLength(1)

    const state = await control.state()
    await control.mutate({ type: 'human-action.resolve', id: state.humanActions[0]!.id, resolution: 'Use the safe migration path.' })
    expect((await control.shouldRun('project-1', 'task.execute')).route).toBe('ready')
  })

  it('accounts dispatched turns against a daily compute budget', async () => {
    const { control, value } = await fixture()
    await control.mutate({ type: 'budget.set', companyId: 'company-1', projectId: 'project-1', dailyTurnLimit: 1 })
    const now = Date.now()
    value.runs.push({
      id: 'run-1', companyId: 'company-1', projectId: 'project-1', kind: 'pm-plan', status: 'running', sessionId: 'session-1', startedAt: now,
    })
    await control.noteDispatch({ runId: 'run-1', sessionId: 'session-1', projectId: 'project-1', kind: 'pm-plan' })

    const decision = await control.shouldRun('project-1', 'workflow.continue')
    expect(decision.route).toBe('wait')
    expect(decision.reason).toContain('1/1')
  })

  it('does not charge historical recovered runs to a newly-created budget window', async () => {
    const { control, value } = await fixture()
    const old = Date.now() - (2 * 24 * 60 * 60 * 1_000)
    value.runs.push({
      id: 'historical-run', companyId: 'company-1', projectId: 'project-1', kind: 'pm-plan', status: 'completed',
      sessionId: 'old-session', startedAt: old, completedAt: old + 5_000,
    })

    await control.mutate({ type: 'budget.set', companyId: 'company-1', projectId: 'project-1', dailyTurnLimit: 1 })
    const state = await control.state()

    expect(state.turns.some((turn) => turn.runId === 'historical-run')).toBe(true)
    expect(state.budgets[0]?.spentTurns).toBe(0)
    expect((await control.shouldRun('project-1', 'workflow.continue')).route).toBe('ready')
  })


  it('enforces daily and monthly cash limits from settled compute usage only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-control-compute-'))
    temporary.push(root)
    const compute = new ComputeLedger(join(root, 'compute.jsonl'))
    await compute.upsertAccount({
      id: 'payg-main',
      provider: 'openai',
      label: 'PAYG main',
      billingKind: 'payg',
      allowPaidOverage: false,
      meters: [{ kind: 'cash_usd', period: 'month', limitUsd: 10, spentUsd: 0 }],
      refreshedAt: Date.now(),
      status: 'healthy',
    })
    const { control } = await fixture(compute)
    await control.mutate({
      type: 'budget.set',
      companyId: 'company-1',
      projectId: 'project-1',
      dailyCostUsd: 1,
      monthlyCostUsd: 2,
    })

    await compute.recordUsage({
      id: 'cash-1',
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-1',
      billingClass: 'payg',
      actualCashUsd: 1,
      source: 'provider',
      observedAt: Date.now(),
    })
    await compute.recordUsage({
      id: 'included-1',
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-1',
      billingClass: 'included',
      providerValueUsd: 25,
      source: 'provider',
      observedAt: Date.now(),
    })

    const decision = await control.shouldRun('project-1', 'workflow.continue')
    expect(decision.route).toBe('wait')
    expect(decision.reason).toMatch(/daily cash budget exhausted/i)

    const management = await control.management('project-1')
    expect(management.budgets[0]?.spentCostUsd).toBeCloseTo(1)
    expect(management.budgets[0]?.spentMonthlyCostUsd).toBeCloseTo(1)
    expect(management.budgets[0]?.cashAccountingKnown).toBe(true)
    expect(management.compute?.actualCashUsd).toBeCloseTo(1)
  })

  it('fails closed when a cash cap exists but compute accounting is unavailable', async () => {
    const { control } = await fixture()
    await control.mutate({
      type: 'budget.set',
      companyId: 'company-1',
      projectId: 'project-1',
      dailyCostUsd: 1,
    })

    const decision = await control.shouldRun('project-1', 'workflow.continue')
    expect(decision.route).toBe('wait')
    expect(decision.reason).toMatch(/requires compute accounting/i)
  })

  it('keeps signals separate from tasks and projects them into the manager view', async () => {
    const { control } = await fixture()
    await control.mutate({
      type: 'signal.add', companyId: 'company-1', projectId: 'project-1', source: 'customer',
      title: 'Checkout confusing', summary: 'Several users could not find the final confirm button.', confidence: 0.9,
    })
    await control.mutate({
      type: 'human-action.add', companyId: 'company-1', projectId: 'project-1', kind: 'action',
      title: 'Review pricing', question: 'Decide whether annual pricing belongs in the beta.',
    })

    const management = await control.management('project-1')
    expect(management.metrics.newSignals).toBe(1)
    expect(management.metrics.openHumanActions).toBe(1)
    expect(management.needsYou[0]?.title).toBe('Review pricing')

    const state = await control.state()
    await control.mutate({ type: 'signal.triage', id: state.signals[0]!.id, disposition: 'evidence' })
    expect((await control.management('project-1')).metrics.newSignals).toBe(0)
  })

  it('serializes declared overlapping advisory work scopes but leaves independent scopes runnable', async () => {
    const { control, value } = await fixture()
    const now = Date.now()
    value.tasks.push(
      {
        id: 'active-task', companyId: 'company-1', projectId: 'project-1',
        title: 'Shared API', description: 'Modify shared API', status: 'in_progress', priority: 'medium',
        acceptanceCriteria: [], dependsOn: [], workScopes: ['src/shared/**'], createdAt: now, updatedAt: now,
      },
      {
        id: 'overlap-task', companyId: 'company-1', projectId: 'project-1',
        title: 'Shared API child', description: 'Modify nested API', status: 'ready', priority: 'medium',
        acceptanceCriteria: [], dependsOn: [], workScopes: ['src/shared/api/**'], createdAt: now, updatedAt: now,
      },
      {
        id: 'independent-task', companyId: 'company-1', projectId: 'project-1',
        title: 'Docs', description: 'Update docs', status: 'ready', priority: 'medium',
        acceptanceCriteria: [], dependsOn: [], workScopes: ['docs/**'], createdAt: now, updatedAt: now,
      },
    )
    value.runs.push({
      id: 'run-active', companyId: 'company-1', projectId: 'project-1', taskId: 'active-task',
      kind: 'task-execution', status: 'running', sessionId: 'active-session', startedAt: now,
    })

    const overlap = await control.shouldRun('project-1', 'task.execute', 'overlap-task')
    expect(overlap.route).toBe('wait')
    expect(overlap.reason).toMatch(/work scope overlaps/i)

    const independent = await control.shouldRun('project-1', 'task.execute', 'independent-task')
    expect(independent.route).toBe('ready')
  })


  it('derives independent execution, role, team, and review runtime pools from the configured budget', async () => {
    const { control, value } = await fixture()
    const roleId = 'role-engineer'
    const teamId = 'team-engineering'
    const agentId = 'agent-builder'
    const now = Date.now()
    value.roles.push({
      id: roleId,
      companyId: 'company-1',
      name: 'Software Engineer',
      responsibility: 'Build product slices',
      systemPrompt: 'Build verified software.',
      skillIds: [],
    })
    value.teams.push({
      id: teamId,
      companyId: 'company-1',
      name: 'Engineering',
      purpose: 'Ship implementation work',
      roleIds: [roleId],
      skillIds: [],
    })
    value.agents.push({
      id: agentId,
      companyId: 'company-1',
      name: 'Builder',
      roleId,
      teamId,
      status: 'idle',
      skillIds: [],
    })
    value.tasks.push({
      id: 'task-capacity',
      companyId: 'company-1',
      projectId: 'project-1',
      title: 'Capacity task',
      description: 'Exercise native pool claims',
      acceptanceCriteria: [],
      priority: 'medium',
      status: 'ready',
      dependsOn: [],
      assignedAgentId: agentId,
      createdAt: now,
      updatedAt: now,
    })

    await control.mutate({
      type: 'budget.set',
      companyId: 'company-1',
      projectId: 'project-1',
      maxParallelWorkers: 6,
      maxReviewWorkers: 2,
      roleWorkerLimits: { [roleId]: 3 },
      teamWorkerLimits: { [teamId]: 4 },
    })

    await expect(control.runtimeClaims('project-1', 'task.execute', 'task-capacity')).resolves.toEqual([
      { key: 'project:project-1:execution', limit: 6 },
      { key: 'project:project-1:role:role-engineer', limit: 3 },
      { key: 'project:project-1:team:team-engineering', limit: 4 },
    ])
    await expect(control.runtimeClaims('project-1', 'task.review', 'task-capacity')).resolves.toEqual([
      { key: 'project:project-1:review', limit: 2 },
    ])
  })

  it('answers automatic dispatch from the control plane gates and the coordinator pools together', async () => {
    const { control, value } = await fixture()
    const now = Date.now()
    value.tasks.push({
      id: 'task-dispatch',
      companyId: 'company-1',
      projectId: 'project-1',
      title: 'Dispatch task',
      description: 'Automatic dispatch probe',
      acceptanceCriteria: [],
      priority: 'medium',
      status: 'ready',
      dependsOn: [],
      createdAt: now,
      updatedAt: now,
    })
    await control.mutate({
      type: 'budget.set',
      companyId: 'company-1',
      projectId: 'project-1',
      maxParallelWorkers: 1,
      maxReviewWorkers: 1,
    })
    const coordinator = new ExecutionCoordinator()
    const execute = () => taskDispatchAvailability(control, coordinator, 'project-1', 'task-dispatch', 'task.execute')

    await expect(execute()).resolves.toEqual({ granted: true })

    const execution = await coordinator.acquire({
      companyId: 'company-1',
      projectId: 'project-1',
      kind: 'execution',
      pools: [{ key: 'project:project-1:execution', limit: 1 }],
    })
    await expect(execute()).resolves.toMatchObject({ granted: false, blockedPool: 'project:project-1:execution' })

    // Review capacity is independent: a full execution pool does not refuse review.
    await expect(taskDispatchAvailability(control, coordinator, 'project-1', 'task-dispatch', 'task.review')).resolves.toEqual({ granted: true })
    const review = await coordinator.acquire({
      companyId: 'company-1',
      projectId: 'project-1',
      kind: 'review',
      pools: [{ key: 'project:project-1:review', limit: 1 }],
    })
    await expect(taskDispatchAvailability(control, coordinator, 'project-1', 'task-dispatch', 'task.review'))
      .resolves.toMatchObject({ granted: false, blockedPool: 'project:project-1:review' })

    // Freeing a permit re-grants: the answer is live, not a cached verdict.
    await coordinator.release(execution)
    await expect(execute()).resolves.toEqual({ granted: true })

    // A human gate refuses before capacity is consulted, and names no pool.
    await control.mutate({
      type: 'human-action.add', companyId: 'company-1', projectId: 'project-1', kind: 'gate',
      title: 'Production choice', question: 'Choose the production data strategy.', scopes: ['task.execute'],
    })
    const gated = await execute()
    expect(gated.granted).toBe(false)
    expect(gated.blockedPool).toBeUndefined()

    await coordinator.release(review)
    await coordinator.close()
  })

})
