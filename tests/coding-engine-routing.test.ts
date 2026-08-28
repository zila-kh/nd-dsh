import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCodingEngineCatalog, CODEX_CLI_ENGINE_ID, CODEX_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../src/shared/coding-engines.js'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'

const CATALOG = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true })

function descriptor(id: string) {
  const found = CATALOG.find((engine) => engine.id === id)
  if (!found) throw new Error(`catalog is missing ${id}`)
  return found
}

class FakeHarness {
  private counter = 0
  prompts: string[] = []
  sessions: string[] = []
  async createSession(): Promise<string> { this.counter += 1; const id = `session-${this.counter}`; this.sessions.push(id); return id }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    this.prompts.push(prompt)
    return { sessionId: options?.sessionId ?? 'session' }
  }
  async close(): Promise<void> {}
  status(): { provider: string; model: string } { return { provider: 'test-provider', model: 'test-model' } }
  consumeCanceledSession(): boolean { return false }
}

/** Stand-in mirroring EngineSessionRouter semantics: harness ids delegate. */
class FakeEngineRuns {
  created: string[] = []
  runs: Array<{ prompt: string; sessionId?: string }> = []
  stopped: string[] = []
  private engineSessionCounter = 0

  constructor(private readonly harness: FakeHarness) {}

  async createSession(engineId: string): Promise<{ sessionId: string; engineId: string }> {
    this.created.push(engineId)
    if (engineId === ND_HARNESS_ENGINE_ID) {
      return { engineId, sessionId: await this.harness.createSession() }
    }
    this.engineSessionCounter += 1
    return { engineId, sessionId: `engine-session-${this.engineSessionCounter}` }
  }

  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    const sessionId = options?.sessionId
    if (sessionId?.startsWith('session-')) return this.harness.run(prompt, { sessionId })
    this.runs.push({ prompt, ...(sessionId !== undefined ? { sessionId } : {}) })
    return { sessionId: sessionId ?? 'engine-session' }
  }

  async stopSession(sessionId: string): Promise<void> {
    this.stopped.push(sessionId)
  }
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
      assertAvailable: () => descriptor(CODEX_ENGINE_ID),
    }
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never)

    await orchestrator.runTask(task.id)

    expect(harness.prompts).toHaveLength(1)
    expect(harness.prompts[0]).toContain('Execution engine: Codex CLI')
    expect(harness.prompts[0]).toContain('subagent_codex')
    expect(harness.prompts[0]).toContain('Do not implement the requested code changes yourself')
    expect((await store.state()).tasks[0]?.status).toBe('in_progress')
  })

  it('executes directly on the Codex CLI engine when an employee is assigned to it', async () => {
    const { store, task, harness } = await fixture()
    const engines = {
      assignedEngine: async () => CODEX_CLI_ENGINE_ID,
      assertAvailable: () => descriptor(CODEX_CLI_ENGINE_ID),
    }
    const engineRuns = new FakeEngineRuns(harness)
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never, engineRuns as never)

    const receiptResult = await orchestrator.runTask(task.id)

    expect(harness.prompts).toHaveLength(0)
    expect(harness.sessions).toHaveLength(0)
    expect(engineRuns.created).toEqual([CODEX_CLI_ENGINE_ID])
    expect(engineRuns.runs).toHaveLength(1)
    expect(engineRuns.runs[0]?.prompt).toContain('Execution engine: Codex CLI (direct')
    expect(engineRuns.runs[0]?.prompt).not.toContain('subagent_codex')
    expect(receiptResult.sessionId).toBe('engine-session-1')
    expect((await store.state()).tasks[0]?.status).toBe('in_progress')
  })

  it('cancels exactly the direct engine session owned by an organization run', async () => {
    const { store, task, harness } = await fixture()
    const engines = {
      assignedEngine: async () => CODEX_CLI_ENGINE_ID,
      assertAvailable: () => descriptor(CODEX_CLI_ENGINE_ID),
    }
    const engineRuns = new FakeEngineRuns(harness)
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never, engineRuns as never)
    const run = await orchestrator.runTask(task.id)

    await orchestrator.cancelRun(run.runId)

    expect(engineRuns.stopped).toEqual([run.sessionId])
    const state = await store.state()
    expect(state.runs.find((item) => item.id === run.runId)?.status).toBe('failed')
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe('blocked')
  })

  it('keeps unassigned employees on the ND Harness execution path through the router', async () => {
    const { store, task, harness } = await fixture()
    const engines = {
      assignedEngine: async () => ND_HARNESS_ENGINE_ID,
      assertAvailable: () => descriptor(ND_HARNESS_ENGINE_ID),
    }
    const engineRuns = new FakeEngineRuns(harness)
    const orchestrator = new OrganizationOrchestrator(store, harness as never, new FakeWorkspace() as never, engines as never, engineRuns as never)

    await orchestrator.runTask(task.id)

    expect(engineRuns.created).toEqual([ND_HARNESS_ENGINE_ID])
    expect(harness.prompts).toHaveLength(1)
    expect(harness.prompts[0]).toContain('Execution engine: ND Harness')
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