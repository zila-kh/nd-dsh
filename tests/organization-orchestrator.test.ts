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

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-orchestrator-'))
  const store = new OrganizationStore(join(dir, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Autonomous Co', mission: 'Ship excellent software' })
  const company = state.companies[0]!
  await store.mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel: 3 } })
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

describe('OrganizationOrchestrator', () => {
  it('runs PM → worker → independent review automatically at autonomy level 3', async () => {
    const { store, project, harness, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, `<nd-dsh-plan>{"goal":{"title":"Launch v1","description":"Ship it"},"milestones":[{"title":"Build","description":"Implement","tasks":[{"title":"Implement feature","description":"Build and test it","role":"Software Engineer","acceptanceCriteria":["Tests pass"]}]}]}</nd-dsh-plan>`))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))
    let state = await store.state()
    const task = state.tasks[0]!
    expect(task.status).toBe('in_progress')
    expect(task.executionSessionId).toBe('session-2')

    await orchestrator.handleHarnessEvent(assistant('session-2', 'Implemented the feature and tests pass.'))
    await orchestrator.handleHarnessEvent(stopped('session-2'))
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('review')
    expect(state.tasks[0]?.reviewSessionId).toBe('session-3')

    await orchestrator.handleHarnessEvent(assistant('session-3', `<nd-dsh-review>{"verdict":"pass","summary":"Verified implementation and tests.","issues":[],"memory":[{"title":"Review result","content":"Feature passed independent review","tags":["review"]}]}</nd-dsh-review>`))
    await orchestrator.handleHarnessEvent(stopped('session-3'))
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('completed')
    expect(state.projects[0]?.progress).toBe(100)
    expect(state.memory.some((item) => item.title === 'Review result')).toBe(true)
    expect(harness.prompts).toHaveLength(3)
  })

  it('honors deny policy even for explicit execution', async () => {
    const { store, company, project, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Task', description: 'Do work' }] }] })
    await store.mutate({ type: 'policy.set', companyId: company.id, action: 'task.execute', effect: 'deny', description: 'Human disabled execution' })
    const task = (await store.state()).tasks[0]!
    await expect(orchestrator.runTask(task.id)).rejects.toThrow(/denied by company policy/i)
  })
})
