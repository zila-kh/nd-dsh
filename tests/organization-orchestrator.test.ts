import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'

class FakeHarness {
  private counter = 0
  prompts: Array<{ prompt: string; sessionId?: string }> = []
  async createSession(): Promise<string> { this.counter += 1; return `session-${this.counter}` }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { this.prompts.push({ prompt, ...(options?.sessionId ? { sessionId: options.sessionId } : {}) }); return { sessionId: options?.sessionId ?? 'session' } }
  async close(): Promise<void> {}
}
class FakeWorkspace {
  private root = '/workspace'
  state(): { root: string } { return { root: this.root } }
  async setRoot(path: string): Promise<{ root: string; name: string }> { this.root = path; return { root: path, name: path.split('/').at(-1) ?? path } }
}

async function fixture(autonomyLevel: 0 | 1 | 2 | 3 | 4 = 3) {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-orchestrator-'))
  const store = new OrganizationStore(join(dir, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Autonomous Co', mission: 'Ship excellent software' })
  const company = state.companies[0]!
  await store.mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel } })
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'App', objective: 'Ship v1', workspacePath: '/workspace' })
  const project = state.projects[0]!
  const harness = new FakeHarness()
  const workspace = new FakeWorkspace()
  const orchestrator = new OrganizationOrchestrator(store, harness as never, workspace as never)
  return { store, company, project, harness, orchestrator }
}

function assistant(sessionId: string, text: string) {
  return { kind: 'session-event', sessionId, event: { type: 'assistant/message', seq: 1, time: Date.now(), data: { message: { content: [{ type: 'text', text }] } } } } as const
}
function stopped(sessionId: string) { return { kind: 'session-status', sessionId, running: false } as const }
function plan(tasks: Array<{ title: string; description: string; dependsOn?: string[]; role?: string }>): string {
  return `<nd-dsh-plan>${JSON.stringify({ goal: { title: 'Launch v1', description: 'Ship it' }, milestones: [{ title: 'Build', description: 'Implement', tasks: tasks.map((task) => ({ ...task, acceptanceCriteria: ['Tests pass'] })) }] })}</nd-dsh-plan>`
}
function review(verdict: 'pass' | 'fail', summary: string, issues: string[] = []): string {
  return `<nd-dsh-review>${JSON.stringify({ verdict, summary, issues, memory: [{ title: `Review ${verdict}`, content: summary, tags: ['review'] }] })}</nd-dsh-review>`
}

async function finishWorker(orchestrator: OrganizationOrchestrator, sessionId: string, summary = 'Implemented and validated.'): Promise<void> {
  await orchestrator.handleHarnessEvent(assistant(sessionId, summary))
  await orchestrator.handleHarnessEvent(stopped(sessionId))
}
async function finishReview(orchestrator: OrganizationOrchestrator, sessionId: string, verdict: 'pass' | 'fail', summary: string, issues: string[] = []): Promise<void> {
  await orchestrator.handleHarnessEvent(assistant(sessionId, review(verdict, summary, issues)))
  await orchestrator.handleHarnessEvent(stopped(sessionId))
}

describe('OrganizationOrchestrator', () => {
  it('runs PM → worker → independent review automatically at autonomy level 3', async () => {
    const { store, project, harness, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, plan([{ title: 'Implement feature', description: 'Build and test it', role: 'Software Engineer' }])))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))
    let state = await store.state()
    const task = state.tasks[0]!
    expect(task.status).toBe('in_progress')
    expect(task.executionSessionId).toBe('session-2')

    await finishWorker(orchestrator, 'session-2', 'Implemented the feature and tests pass.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('review')
    expect(state.tasks[0]?.reviewSessionId).toBe('session-3')

    await finishReview(orchestrator, 'session-3', 'pass', 'Verified implementation and tests.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('completed')
    expect(state.projects[0]?.progress).toBe(100)
    expect(state.memory.some((item) => item.title === 'Review pass')).toBe(true)
    expect(state.memory.some((item) => item.title === 'Review: Implement feature')).toBe(true)
    expect(harness.prompts).toHaveLength(3)
  })

  it('connects the full autopilot OS loop including rework, memory, dependencies, and next-task progression', async () => {
    const { store, project, harness, orchestrator } = await fixture(4)
    const planRun = await orchestrator.runNext(project.id, false)
    expect(planRun?.kind).toBe('pm-plan')

    await orchestrator.handleHarnessEvent(assistant('session-1', plan([
      { title: 'Foundation', description: 'Build the foundation' },
      { title: 'Finish', description: 'Finish the feature', dependsOn: ['Foundation'] },
    ])))
    await orchestrator.handleHarnessEvent(stopped('session-1'))

    let state = await store.state()
    const foundation = state.tasks.find((item) => item.title === 'Foundation')!
    const finish = state.tasks.find((item) => item.title === 'Finish')!
    const builder = state.agents.find((item) => item.name === 'Builder')!
    expect(foundation.assignedAgentId).toBe(builder.id)
    expect(finish.assignedAgentId).toBe(builder.id)
    expect(state.projects[0]?.teamIds).toContain(builder.teamId)
    expect(foundation.status).toBe('in_progress')
    expect(finish.status).toBe('backlog')

    await finishWorker(orchestrator, 'session-2', 'Foundation implemented, but a reviewer should verify edge cases.')
    await finishReview(orchestrator, 'session-3', 'fail', 'Edge case is missing.', ['Handle the empty-state edge case'])

    state = await store.state()
    expect(state.tasks.find((item) => item.id === foundation.id)?.status).toBe('in_progress')
    expect(harness.prompts.at(-1)?.prompt).toContain('Previous independent review feedback')
    expect(harness.prompts.at(-1)?.prompt).toContain('Handle the empty-state edge case')
    expect(state.memory.some((item) => item.title === 'Review: Foundation' && item.tags.includes('failed'))).toBe(true)

    await finishWorker(orchestrator, 'session-4', 'Edge case fixed and validation passes.')
    await finishReview(orchestrator, 'session-5', 'pass', 'Foundation now satisfies all acceptance criteria.')

    state = await store.state()
    expect(state.tasks.find((item) => item.id === foundation.id)?.status).toBe('completed')
    expect(state.tasks.find((item) => item.id === finish.id)?.status).toBe('in_progress')
    expect(state.projects[0]?.progress).toBe(50)
    expect(state.milestones[0]?.status).toBe('active')

    await finishWorker(orchestrator, 'session-6', 'Final feature work complete and tests pass.')
    await finishReview(orchestrator, 'session-7', 'pass', 'Final task verified.')

    state = await store.state()
    expect(state.tasks.every((item) => item.status === 'completed')).toBe(true)
    expect(state.projects[0]?.status).toBe('completed')
    expect(state.projects[0]?.progress).toBe(100)
    expect(state.goals[0]?.status).toBe('completed')
    expect(state.milestones[0]?.status).toBe('completed')
    expect(state.runs.filter((item) => item.kind === 'task-execution')).toHaveLength(3)
    expect(state.runs.filter((item) => item.kind === 'task-review')).toHaveLength(3)
    expect(await store.activeRun(project.id)).toBeUndefined()
  })

  it('caps automatic rework after three execution attempts', async () => {
    const { store, project, orchestrator } = await fixture(4)
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Hard task', description: 'Do hard work' }] }] })
    const first = await orchestrator.runNext(project.id, false)
    expect(first?.sessionId).toBe('session-1')

    await finishWorker(orchestrator, 'session-1')
    await finishReview(orchestrator, 'session-2', 'fail', 'Still wrong', ['Issue 1'])
    await finishWorker(orchestrator, 'session-3')
    await finishReview(orchestrator, 'session-4', 'fail', 'Still wrong', ['Issue 2'])
    await finishWorker(orchestrator, 'session-5')
    await finishReview(orchestrator, 'session-6', 'fail', 'Still wrong', ['Issue 3'])

    const state = await store.state()
    expect(state.tasks[0]?.status).toBe('blocked')
    expect(await store.executionAttemptCount(state.tasks[0]!.id)).toBe(3)
    expect(await store.activeRun(project.id)).toBeUndefined()
  })

  it('honors deny policy even for explicit execution', async () => {
    const { store, company, project, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Task', description: 'Do work' }] }] })
    await store.mutate({ type: 'policy.set', companyId: company.id, action: 'task.execute', effect: 'deny', description: 'Human disabled execution' })
    const task = (await store.state()).tasks[0]!
    await expect(orchestrator.runTask(task.id)).rejects.toThrow(/denied by company policy/i)
  })
})
