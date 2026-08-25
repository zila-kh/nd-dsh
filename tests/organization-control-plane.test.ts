import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrganizationSnapshot } from '../src/shared/organization.js'
import { OrganizationControlPlane } from '../src/main/organization/control-plane.js'

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
    roles: [], teams: [], agents: [], skills: [], workflows: [], goals: [], milestones: [], tasks: [], memory: [], policies: [], activity: [], runs: [],
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-control-'))
  temporary.push(root)
  const value = organization()
  const store = {
    state: async () => structuredClone(value),
    taskContext: async () => { throw new Error('not used in this fixture') },
  }
  return { root, value, control: new OrganizationControlPlane(join(root, 'control.json'), store as never) }
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
})
