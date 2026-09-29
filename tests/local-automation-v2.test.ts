import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrganizationControlSnapshot } from '../src/shared/organization-control.js'
import type { OrganizationMutation, OrganizationSnapshot } from '../src/shared/organization.js'
import { nextCronAt } from '../src/main/organization/cron.js'
import { runDueHeartbeats } from '../src/main/organization/heartbeat-runner.js'
import { runEventTriggers } from '../src/main/organization/event-trigger-runner.js'
import { OrganizationStrategyPlane } from '../src/main/organization/strategy-plane.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function organization(now = Date.now()): OrganizationSnapshot {
  return {
    version: 1,
    activeCompanyId: 'c1',
    activeProjectId: 'p1',
    companies: [{ id: 'c1', name: 'ND', mission: 'Local first', autonomyLevel: 3, status: 'active', createdAt: now, updatedAt: now }],
    projects: [{ id: 'p1', companyId: 'c1', name: 'App', objective: 'Ship', status: 'active', repoUrls: [], teamIds: [], progress: 0, createdAt: now, updatedAt: now }],
    roles: [],
    teams: [],
    agents: [{ id: 'a1', companyId: 'c1', name: 'Builder', roleId: 'r1', status: 'idle', skillIds: [] }],
    skills: [{ id: 'builtin:implementation', scope: 'builtin', name: 'Implementation', description: 'Build safely', instructions: 'Implement and verify.' }],
    workflows: [],
    goals: [],
    milestones: [],
    tasks: [],
    memory: [],
    policies: [],
    activity: [],
    runs: [],
    members: [],
    messages: [],
    decisions: [],
    approvalRequests: [],
    approvalVerdicts: [],
    coordination: [],
  }
}

function control(): OrganizationControlSnapshot {
  return { version: 1, turns: [], humanActions: [], signals: [], budgets: [], leases: [], evidence: [], feedback: [] }
}

async function strategyFixture(value = organization()) {
  const root = await mkdtemp(join(tmpdir(), 'nd-automation-'))
  temporary.push(root)
  const mutations: OrganizationMutation[] = []
  const store = {
    state: async () => structuredClone(value),
    mutate: async (mutation: OrganizationMutation) => { mutations.push(mutation); return structuredClone(value) },
  }
  return { value, mutations, strategy: new OrganizationStrategyPlane(join(root, 'strategy.json'), store as never) }
}

describe('local automation v2', () => {
  it('calculates timezone-aware 5-field cron occurrences', () => {
    const from = Date.parse('2026-09-29T23:00:00Z')
    const next = nextCronAt('0 8 * * *', 'Asia/Phnom_Penh', from)
    expect(new Date(next).toISOString()).toBe('2026-09-30T01:00:00.000Z')
  })

  it('supports one-time and routine schedules without changing the task contract', async () => {
    const { strategy } = await strategyFixture()
    const now = Date.now()
    let state = await strategy.mutate({
      type: 'schedule.add', companyId: 'c1', projectId: 'p1', title: 'One shot',
      mode: 'once', runAt: now + 60_000,
    })
    const once = state.schedules[0]!
    expect(once.mode).toBe('once')
    const claimed = await strategy.beginSchedule(once.id, now + 60_000)
    expect(claimed?.status).toBe('completed')

    state = await strategy.mutate({
      type: 'schedule.add', companyId: 'c1', projectId: 'p1', title: 'Builder routine',
      mode: 'routine', intervalMinutes: 30, agentId: 'a1', prompt: 'Inspect the project and continue safe ready work.',
      skillIds: ['builtin:implementation'],
    })
    expect(state.schedules[0]).toMatchObject({ mode: 'routine', agentId: 'a1', intervalMinutes: 30, skillIds: ['builtin:implementation'] })
  })

  it('heartbeat surfaces attention without calling a model', async () => {
    const value = organization()
    value.tasks.push({ id: 't1', companyId: 'c1', projectId: 'p1', title: 'Blocked', description: 'x', acceptanceCriteria: [], priority: 'high', status: 'blocked', dependsOn: [], createdAt: 1, updatedAt: 1 })
    const { strategy } = await strategyFixture(value)
    let strategyState = await strategy.mutate({ type: 'heartbeat.add', companyId: 'c1', projectId: 'p1', title: 'PM heartbeat', intervalMinutes: 30 })
    strategyState.heartbeats[0]!.nextRunAt = 0
    await strategy.mutate({ type: 'heartbeat.update', id: strategyState.heartbeats[0]!.id, patch: { nextRunAt: 1 } })
    let controlState = control()
    await runDueHeartbeats({
      strategy,
      store: { state: async () => structuredClone(value) },
      control: {
        state: async () => structuredClone(controlState),
        mutate: async (mutation) => {
          if (mutation.type === 'signal.add') controlState.signals.unshift({ id: 's1', companyId: mutation.companyId, projectId: mutation.projectId, source: mutation.source, title: mutation.title, summary: mutation.summary, status: 'new', confidence: mutation.confidence, createdAt: Date.now(), updatedAt: Date.now() })
          return structuredClone(controlState)
        },
      },
    })
    expect(controlState.signals[0]?.source).toMatch(/^heartbeat:/)
    expect(controlState.signals[0]?.summary).toContain('blocked task')
  })

  it('event triggers only consume events created after the trigger and are idempotent', async () => {
    const value = organization(100)
    value.activity.push({ id: 'old', companyId: 'c1', projectId: 'p1', type: 'task.blocked', message: 'Old blocker', createdAt: 99 })
    const { strategy, mutations } = await strategyFixture(value)
    let state = await strategy.mutate({
      type: 'trigger.add', companyId: 'c1', projectId: 'p1', title: 'Follow blocker',
      eventType: 'task.blocked', action: 'task', prompt: 'Investigate', agentId: 'a1',
    })
    const trigger = state.triggers[0]!
    value.activity.unshift({ id: 'new', companyId: 'c1', projectId: 'p1', type: 'task.blocked', message: 'New blocker', createdAt: trigger.createdAt + 1 })
    await runEventTriggers({
      strategy,
      store: {
        state: async () => structuredClone(value),
        mutate: async (mutation) => {
          mutations.push(mutation)
          if (mutation.type === 'task.create') {
            value.tasks.push({
              id: 'trigger-task', companyId: mutation.companyId, projectId: mutation.projectId,
              title: mutation.title, description: mutation.description, acceptanceCriteria: [], priority: mutation.priority ?? 'medium',
              status: 'ready', dependsOn: mutation.dependsOn ?? [],
              ...(mutation.assignedAgentId ? { assignedAgentId: mutation.assignedAgentId } : {}),
              ...(mutation.sourceTriggerId ? { sourceTriggerId: mutation.sourceTriggerId } : {}),
              ...(mutation.sourceActivityId ? { sourceActivityId: mutation.sourceActivityId } : {}),
              createdAt: Date.now(), updatedAt: Date.now(),
            })
          }
          return structuredClone(value)
        },
      },
      control: {
        state: async () => control(),
        mutate: async () => control(),
        shouldRun: async () => ({ route: 'ready', reason: 'allowed' } as never),
      },
      orchestrator: { runTask: async (taskId) => ({ runId: 'run-1', sessionId: 'session-1', projectId: 'p1', taskId, kind: 'task-execution' }) },
    })
    const created = mutations.filter((item) => item.type === 'task.create')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ sourceTriggerId: trigger.id, sourceActivityId: 'new', assignedAgentId: 'a1' })
    expect((await strategy.state()).triggerReceipts).toHaveLength(1)
    await runEventTriggers({
      strategy,
      store: {
        state: async () => structuredClone(value),
        mutate: async (mutation) => { mutations.push(mutation); return structuredClone(value) },
      },
      control: {
        state: async () => control(),
        mutate: async () => control(),
        shouldRun: async () => ({ route: 'ready', reason: 'allowed' } as never),
      },
      orchestrator: { runTask: async (taskId) => ({ runId: 'run-2', sessionId: 'session-2', projectId: 'p1', taskId, kind: 'task-execution' }) },
    })
    expect(mutations.filter((item) => item.type === 'task.create')).toHaveLength(1)
  })

  it('retries failed event deliveries after backoff and consumes them after success', async () => {
    const value = organization()
    const { strategy } = await strategyFixture(value)
    let state = await strategy.mutate({
      type: 'trigger.add', companyId: 'c1', projectId: 'p1', title: 'Retry blocker',
      eventType: 'task.blocked', action: 'task', prompt: 'Investigate',
    })
    const trigger = state.triggers[0]!
    value.activity.unshift({
      id: 'retry-event', companyId: 'c1', projectId: 'p1', type: 'task.blocked',
      message: 'Transient engine issue', createdAt: trigger.createdAt + 1,
    })
    expect(await strategy.pendingTriggerFirings(trigger.createdAt + 1)).toHaveLength(1)
    await strategy.recordTriggerFire(trigger.id, 'retry-event', 'failed', 'provider unavailable')
    expect(await strategy.pendingTriggerFirings(Date.now())).toHaveLength(0)
    expect(await strategy.pendingTriggerFirings(Date.now() + 60_001)).toHaveLength(1)
    await strategy.recordTriggerFire(trigger.id, 'retry-event', 'success', 'task dispatched')
    expect(await strategy.pendingTriggerFirings(Date.now() + 120_000)).toHaveLength(0)
    state = await strategy.state()
    expect(state.triggers[0]?.runCount).toBe(1)
    expect(state.triggerReceipts.find((item) => item.activityId === 'retry-event')?.outcome).toBe('success')
  })

  it('learned skills stay candidates until explicitly promoted', async () => {
    const { strategy, mutations } = await strategyFixture()
    let state = await strategy.mutate({
      type: 'skill-candidate.add', companyId: 'c1', projectId: 'p1', sourceAgentId: 'a1',
      name: 'Checkout regression triage', description: 'Repeatable checkout QA flow', instructions: 'Run the focused checkout suite and inspect browser/network evidence.', evidence: ['task-12 passed', 'task-15 passed'],
    })
    const candidate = state.skillCandidates[0]!
    expect(candidate.status).toBe('proposed')
    state = await strategy.mutate({ type: 'skill-candidate.promote', id: candidate.id })
    expect(state.skillCandidates[0]?.status).toBe('approved')
    expect(mutations.some((item) => item.type === 'skill.create')).toBe(true)
  })
})
