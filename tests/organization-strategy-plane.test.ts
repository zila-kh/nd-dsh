import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrganizationControlSnapshot } from '../src/shared/organization-control.js'
import type { OrganizationSnapshot } from '../src/shared/organization.js'
import { OrganizationStrategyPlane } from '../src/main/organization/strategy-plane.js'

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
    projects: [{ id: 'project-1', companyId: 'company-1', name: 'App', objective: 'Build it', status: 'active', repoUrls: [], teamIds: [], progress: 50, createdAt: now, updatedAt: now }],
    roles: [], teams: [], agents: [], skills: [], workflows: [], goals: [], milestones: [], memory: [], policies: [], activity: [], runs: [],
    tasks: [
      { id: 'task-1', companyId: 'company-1', projectId: 'project-1', title: 'One', description: 'One', acceptanceCriteria: [], priority: 'high', status: 'completed', dependsOn: [], createdAt: now, updatedAt: now },
      { id: 'task-2', companyId: 'company-1', projectId: 'project-1', title: 'Two', description: 'Two', acceptanceCriteria: [], priority: 'high', status: 'ready', dependsOn: [], createdAt: now, updatedAt: now },
    ],
  }
}

function control(): OrganizationControlSnapshot {
  return {
    version: 1, turns: [], humanActions: [], signals: [], budgets: [], leases: [], feedback: [],
    evidence: [{
      id: 'evidence-1', companyId: 'company-1', projectId: 'project-1', taskId: 'task-1',
      fingerprint: 'abc', exact: true, source: 'git', changedFiles: ['src/a.ts'], status: 'verified', capturedAt: Date.now(),
    }],
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-strategy-'))
  temporary.push(root)
  const value = organization()
  const store = { state: async () => structuredClone(value) }
  return { root, value, strategy: new OrganizationStrategyPlane(join(root, 'strategy.json'), store as never) }
}

describe('organization strategy plane', () => {
  it('keeps a small set of strategic anchors separate from task execution', async () => {
    const { strategy } = await fixture()
    await strategy.mutate({
      type: 'anchor.add', companyId: 'company-1', projectId: 'project-1', title: 'Prove checkout',
      outcome: 'Customers can finish checkout on mobile.', successCriteria: ['Mobile E2E passes'], priority: 'critical',
    })
    const projection = await strategy.projection('project-1', control())
    expect(projection.activeAnchors).toHaveLength(1)
    expect(projection.activeAnchors[0]?.priority).toBe('critical')
  })

  it('supersedes old company knowledge instead of keeping contradictory active truth', async () => {
    const { strategy } = await fixture()
    let state = await strategy.mutate({
      type: 'knowledge.add', companyId: 'company-1', kind: 'decision', title: 'State management',
      content: 'Use local component state for small flows.', confidence: 'authoritative', source: 'human',
    })
    const previous = state.knowledge[0]!
    state = await strategy.mutate({
      type: 'knowledge.add', companyId: 'company-1', kind: 'decision', title: 'State management',
      content: 'Use the shared state layer for the checkout domain.', confidence: 'authoritative', source: 'human', supersedesId: previous.id,
    })
    expect(state.knowledge.find((item) => item.id === previous.id)?.status).toBe('superseded')
    expect(state.knowledge.filter((item) => item.status === 'active')).toHaveLength(1)
  })

  it('advances recurring cadence before a scheduled turn is dispatched', async () => {
    const { strategy } = await fixture()
    const now = Date.now()
    let state = await strategy.mutate({
      type: 'schedule.add', companyId: 'company-1', projectId: 'project-1', title: 'Continue work',
      intervalMinutes: 60, nextRunAt: now - 1, maxRuns: 2,
    })
    const schedule = state.schedules[0]!
    expect(await strategy.dueSchedules(now)).toHaveLength(1)
    const claimed = await strategy.beginSchedule(schedule.id, now)
    expect(claimed?.runCount).toBe(1)
    expect(claimed?.nextRunAt).toBeGreaterThan(now)
    expect(await strategy.dueSchedules(now)).toHaveLength(0)
    await strategy.finishSchedule(schedule.id, 'success', 'run dispatched')
    state = await strategy.state()
    expect(state.schedules[0]?.lastOutcome).toBe('success')
  })

  it('projects release readiness from task state and exact review evidence', async () => {
    const { strategy, value } = await fixture()
    let projection = await strategy.projection('project-1', control())
    expect(projection.release?.state).toBe('not_ready')
    value.tasks[1]!.status = 'completed'
    const current = control()
    current.evidence.unshift({
      id: 'evidence-2', companyId: 'company-1', projectId: 'project-1', taskId: 'task-2',
      fingerprint: 'def', exact: true, source: 'git', changedFiles: ['src/b.ts'], status: 'verified', capturedAt: Date.now(),
    })
    projection = await strategy.projection('project-1', current)
    expect(projection.release?.state).toBe('ready')
    expect(projection.release?.verifiedTasks).toBe(2)
  })
})
