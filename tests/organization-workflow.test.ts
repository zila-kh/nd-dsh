import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'

class Harness {
  private counter = 0
  prompts: string[] = []
  async createSession(): Promise<string> { this.counter += 1; return `workflow-session-${this.counter}` }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { this.prompts.push(prompt); return { sessionId: options?.sessionId ?? 'session' } }
  async close(): Promise<void> {}
  consumeCanceledSession(): boolean { return false }
}
class Workspace {
  state(): { root: string } { return { root: '/workspace' } }
  async setRoot(path: string): Promise<{ root: string; name: string }> { return { root: path, name: 'workspace' } }
}

function assistant(sessionId: string, text: string) {
  return { kind: 'session-event', sessionId, event: { type: 'assistant/message', seq: 1, time: Date.now(), data: { message: { content: [{ type: 'text', text }] } } } } as const
}
function stopped(sessionId: string) { return { kind: 'session-status', sessionId, running: false } as const }

describe('organization workflow execution', () => {
  it('honors a project-scoped execute-only workflow instead of pretending workflows are metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-workflow-'))
    const store = new OrganizationStore(join(dir, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Workflow Co', mission: 'Ship prototypes' })
    const company = state.companies[0]!
    await store.mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel: 3 } })
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Prototype', objective: 'Ship an internal prototype', workspacePath: '/workspace' })
    const project = state.projects[0]!
    await store.mutate({ type: 'workflow.create', companyId: company.id, projectId: project.id, name: 'Execute only', steps: [{ id: 'execute', name: 'Execute', kind: 'execute' }] })
    await store.applyPlan(project.id, { goal: { title: 'Prototype', description: 'Build it' }, milestones: [{ title: 'Build', description: 'Build', tasks: [{ title: 'Implement', description: 'Implement prototype' }] }] })

    const harness = new Harness()
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new Workspace() as never)
    const run = await orchestrator.runNext(project.id, false)
    expect(run?.kind).toBe('task-execution')

    await orchestrator.handleHarnessEvent(assistant('workflow-session-1', 'Prototype implemented and validation passed.'))
    await orchestrator.handleHarnessEvent(stopped('workflow-session-1'))

    state = await store.state()
    expect(state.tasks[0]?.status).toBe('completed')
    expect(state.runs.filter((item) => item.kind === 'task-review')).toHaveLength(0)
    expect(state.memory.some((item) => item.title === 'Task result: Implement')).toBe(true)
    expect(state.projects[0]?.status).toBe('completed')
  })
})
