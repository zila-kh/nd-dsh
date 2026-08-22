import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODEX_ENGINE_ID } from '../src/shared/coding-engines.js'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'

class FakeHarness {
  private counter = 0
  prompts: string[] = []
  async createSession(): Promise<string> { this.counter += 1; return `session-${this.counter}` }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    this.prompts.push(prompt)
    return { sessionId: options?.sessionId ?? 'session' }
  }
  async close(): Promise<void> {}
  consumeCanceledSession(): boolean { return false }
}

class FakeWorkspace {
  state(): { root: string } { return { root: '/workspace' } }
  async setRoot(path: string): Promise<{ root: string; name: string }> { return { root: path, name: path.split('/').at(-1) ?? path } }
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-engine-route-'))
  const store = new OrganizationStore(join(dir, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Engine Co', mission: 'Ship software' })
  const company = state.companies[0]!
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'App', objective: 'Ship v1', workspacePath: '/workspace' })
  const project = state.projects[0]!
  await store.applyPlan(project.id, {
    goal: { title: 'Launch', description: 'Launch safely' },
    milestones: [{ title: 'Build', description: 'Build it', tasks: [{ title: 'Implement feature', description: 'Implement and test feature' }] }],
  })
  const task = (await store.state()).tasks[0]!
  const harness = new FakeHarness()
  return { store, project, task, harness }
}

describe('organization coding-engine routing', () => {
  it('routes a worker through the Codex delegate when ND assigns that employee to Codex', async () => {
    const { store, task, harness } = await fixture()
    const engines = {
      assignedEngine: async () => CODEX_ENGINE_ID,
      assertAvailable: () => ({ id: CODEX_ENGINE_ID }),
    }
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never)

    await orchestrator.runTask(task.id)

    expect(harness.prompts).toHaveLength(1)
    expect(harness.prompts[0]).toContain('Execution engine: Codex CLI')
    expect(harness.prompts[0]).toContain('subagent_codex')
    expect(harness.prompts[0]).toContain('Do not implement the requested code changes yourself')
    expect((await store.state()).tasks[0]?.status).toBe('in_progress')
  })

  it('rejects an unavailable assigned engine before creating an organization run', async () => {
    const { store, task, harness } = await fixture()
    const engines = {
      assignedEngine: async () => CODEX_ENGINE_ID,
      assertAvailable: () => { throw new Error('Codex engine is unavailable') },
    }
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never)

    await expect(orchestrator.runTask(task.id)).rejects.toThrow(/unavailable/i)

    expect(harness.prompts).toHaveLength(0)
    const state = await store.state()
    expect(state.tasks[0]?.status).toBe('ready')
    expect(state.runs).toHaveLength(0)
  })
})
