import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'
import type { OrganizationSnapshot } from '../src/shared/organization.js'

const execFileAsync = promisify(execFile)

/** A committed Git workspace, so task runs can use isolated worktrees. */
async function gitWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await execFileAsync('git', ['init'], { cwd: root })
  await writeFile(join(root, 'README.md'), '# workspace\n')
  await execFileAsync('git', ['add', 'README.md'], { cwd: root })
  await execFileAsync('git', ['-c', 'user.name=ND Test', '-c', 'user.email=test@local', 'commit', '-m', 'base'], { cwd: root })
  return root
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(plan = true): Promise<{
  store: OrganizationStore
  statePath: string
  workspace: string
  companyId: string
  projectId: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-project-removal-'))
  dirs.push(dir)
  const workspace = join(dir, 'product')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'index.html'), '<!doctype html><title>kept</title>', 'utf8')
  const statePath = join(dir, 'organization.json')
  const store = new OrganizationStore(statePath)
  const created = await store.mutate({ type: 'company.create', name: 'Removal Co', mission: 'Keep the control plane tidy' })
  const companyId = created.companies[0]!.id
  const withProject = await store.mutate({ type: 'project.create', companyId, name: 'Removable App', objective: 'Ship v1', workspacePath: workspace })
  const projectId = withProject.projects[0]!.id
  if (plan) {
    await store.applyPlan(projectId, {
      goal: { title: 'Launch', description: 'Ship the first version' },
      milestones: [{
        title: 'M1',
        description: 'Foundation',
        tasks: [
          { title: 'Scaffold the app', description: 'Create the entry point', acceptanceCriteria: ['Builds'] },
          { title: 'Add a test', description: 'Cover the entry point', dependsOn: ['Scaffold the app'] },
        ],
      }],
      memory: [{ title: 'Delivery note', content: 'Keep the build green.' }],
    })
  }
  return { store, statePath, workspace, companyId, projectId }
}

describe('organization project removal', () => {
  it('forgets the project and the ND records it owns, and leaves the folder alone', async () => {
    const { store, workspace, projectId, companyId } = await fixture()
    const before = await store.state()
    expect(before.tasks.length).toBe(2)
    const taskId = before.tasks[0]!.id
    await store.beginRun('task-execution', companyId, projectId, 'session-1', taskId)
    const run = await store.activeRun(projectId)
    await store.completeRun(run!.id, 'done')

    const after = await store.mutate({ type: 'project.remove', id: projectId })

    expect(after.projects.find((item) => item.id === projectId)).toBeUndefined()
    expect(after.tasks.filter((item) => item.projectId === projectId)).toHaveLength(0)
    expect(after.goals.filter((item) => item.projectId === projectId)).toHaveLength(0)
    expect(after.milestones.filter((item) => item.projectId === projectId)).toHaveLength(0)
    expect(after.runs.filter((item) => item.projectId === projectId)).toHaveLength(0)
    expect(after.memory.filter((item) => item.projectId === projectId)).toHaveLength(0)
    // The company itself survives: only the project is forgotten.
    expect(after.companies.find((item) => item.id === companyId)).toBeDefined()
    expect(after.agents.length).toBeGreaterThan(0)
    expect(after.policies.length).toBeGreaterThan(0)
    // Audit trail records what happened without re-attaching it to the project.
    expect(after.activity.some((item) => item.type === 'project.removed' && item.companyId === companyId)).toBe(true)
    // Nothing on disk is touched: the source tree is still there.
    await expect(readFile(join(workspace, 'index.html'), 'utf8')).resolves.toContain('kept')
  })

  it('drops project-scoped skills and workflows but keeps company-wide ones', async () => {
    const { store, projectId, companyId } = await fixture(false)
    await store.mutate({ type: 'skill.create', scope: 'project', name: 'Project skill', description: 'Scoped', instructions: 'Use it', companyId, projectId })
    await store.mutate({ type: 'skill.create', scope: 'company', name: 'Company skill', description: 'Company wide', instructions: 'Always', companyId })
    await store.mutate({ type: 'workflow.create', companyId, projectId, name: 'Project workflow', steps: [{ id: 'step-1', name: 'Only step', kind: 'execute' }] })

    const after = await store.mutate({ type: 'project.remove', id: projectId })

    expect(after.skills.some((item) => item.name === 'Project skill')).toBe(false)
    expect(after.skills.some((item) => item.name === 'Company skill')).toBe(true)
    expect(after.workflows.filter((item) => item.projectId === projectId)).toHaveLength(0)
    expect(after.workflows.some((item) => item.companyId === companyId && !item.projectId)).toBe(true)
  })

  it('refuses to remove a project while one of its runs is active', async () => {
    const { store, projectId, companyId } = await fixture(false)
    const state = await store.state()
    const task = await store.mutate({
      type: 'task.create',
      companyId,
      projectId,
      title: 'Long job',
      description: 'Runs while removal is attempted',
    })
    const taskId = task.tasks[0]!.id
    await store.beginRun('task-execution', companyId, projectId, 'session-live', taskId)

    await expect(store.mutate({ type: 'project.remove', id: projectId })).rejects.toThrow(/Cancel the running task-execution/)
    const after = await store.state()
    expect(after.projects.find((item) => item.id === projectId)).toBeDefined()
    expect(after.tasks.length).toBe(state.tasks.length + 1)
  })

  it('releases an employee whose active task belonged to the removed project', async () => {
    const { store, statePath, projectId } = await fixture()
    const snapshot = JSON.parse(await readFile(statePath, 'utf8')) as OrganizationSnapshot
    const taskId = snapshot.tasks[0]!.id
    const agent = snapshot.agents[0]!
    agent.status = 'working'
    agent.currentTaskId = taskId
    await writeFile(statePath, JSON.stringify(snapshot), 'utf8')

    const reloaded = new OrganizationStore(statePath)
    const after = await reloaded.mutate({ type: 'project.remove', id: projectId })

    const released = after.agents.find((item) => item.id === agent.id)!
    expect(released.status).toBe('idle')
    expect(released.currentTaskId).toBeUndefined()
  })

  it('moves the active marker to another project and clears it when none remain', async () => {
    const { store, companyId, projectId } = await fixture(false)
    const created = await store.mutate({ type: 'project.create', companyId, name: 'Survivor', objective: 'Stay' })
    const survivorId = created.projects.find((item) => item.name === 'Survivor')!.id
    await store.mutate({ type: 'project.activate', id: projectId })

    const afterFirst = await store.mutate({ type: 'project.remove', id: projectId })
    expect(afterFirst.activeProjectId).toBe(survivorId)

    const afterSecond = await store.mutate({ type: 'project.remove', id: survivorId })
    expect(afterSecond.activeProjectId).toBeUndefined()
    expect(afterSecond.projects).toHaveLength(0)
  })

  it('keeps the removal after a reload', async () => {
    const { store, statePath, projectId } = await fixture()
    await store.mutate({ type: 'project.remove', id: projectId })

    const reloaded = new OrganizationStore(statePath)
    const state = await reloaded.state()
    expect(state.projects).toHaveLength(0)
    expect(state.tasks).toHaveLength(0)
  })
})

describe('removal stops the project\'s live work', () => {
  class FakeHarness {
    async createSession(): Promise<string> { return 'harness-session' }
    async run(_prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { return { sessionId: options?.sessionId ?? 'harness-session' } }
    async close(): Promise<void> {}
    consumeCanceledSession(): boolean { return false }
    status(): { provider: string; model: string } { return { provider: 'provider-primary', model: 'model-primary' } }
    async gatewayRpc(): Promise<{ ok: boolean; value?: unknown }> { return { ok: true, value: {} } }
  }

  class FakeEngineRuns {
    private count = 0
    stopped: string[] = []
    async createSession(engineId: string): Promise<{ sessionId: string; engineId: string }> {
      this.count += 1
      return { engineId, sessionId: `worker-${this.count}` }
    }
    async run(_prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { return { sessionId: options?.sessionId ?? 'worker' } }
    async stopSession(sessionId: string): Promise<void> { this.stopped.push(sessionId) }
  }

  async function workspaceFixture(): Promise<{
    store: OrganizationStore
    companyId: string
    projectA: string
    projectB: string
    taskA: string
    taskB: string
    engineRuns: FakeEngineRuns
    orchestrator: OrganizationOrchestrator
  }> {
    const root = await mkdtemp(join(tmpdir(), 'nd-removal-workspace-'))
    dirs.push(root)
    const alphaRoot = await gitWorkspace('nd-removal-alpha-')
    const bravoRoot = await gitWorkspace('nd-removal-bravo-')
    dirs.push(alphaRoot, bravoRoot)
    const store = new OrganizationStore(join(root, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Stop Co', mission: 'Stop what you forget' })
    const companyId = state.companies[0]!.id
    const withA = await store.mutate({ type: 'project.create', companyId, name: 'Alpha', objective: 'First', workspacePath: alphaRoot })
    const projectA = withA.projects.find((item) => item.name === 'Alpha')!.id
    const withB = await store.mutate({ type: 'project.create', companyId, name: 'Bravo', objective: 'Second', workspacePath: bravoRoot })
    const projectB = withB.projects.find((item) => item.name === 'Bravo')!.id
    const created = await store.mutate({ type: 'task.create', companyId, projectId: projectA, title: 'Alpha work', description: 'Work in Alpha' })
    const taskA = created.tasks.find((item) => item.title === 'Alpha work')!.id
    const createdB = await store.mutate({ type: 'task.create', companyId, projectId: projectB, title: 'Bravo work', description: 'Work in Bravo' })
    const taskB = createdB.tasks.find((item) => item.title === 'Bravo work')!.id
    const engineRuns = new FakeEngineRuns()
    const orchestrator = new OrganizationOrchestrator(
      store,
      new FakeHarness() as never,
      { state: () => ({ root: join(root, 'alpha') }), setRoot: async (path: string) => ({ root: path, name: path }) } as never,
      { assignedEngine: async () => 'nd-harness', assertAvailable: (id: string) => ({ id, name: id }) } as never,
      engineRuns as never,
    )
    return { store, companyId, projectA, projectB, taskA, taskB, engineRuns, orchestrator }
  }

  it('cancels the project\'s runs and releases its employees, leaving other projects running', async () => {
    const { store, projectA, projectB, taskA, taskB, engineRuns, orchestrator } = await workspaceFixture()
    const runA = await orchestrator.runTask(taskA)
    const runB = await orchestrator.runTask(taskB)

    const stopped = await orchestrator.stopProjectWork(projectA)
    expect(stopped).toBe(1)
    expect(engineRuns.stopped).toEqual([runA.sessionId])

    const state = await store.state()
    expect(state.runs.find((item) => item.id === runA.runId)?.status).toBe('failed')
    expect(state.runs.find((item) => item.id === runA.runId)?.error).toMatch(/Canceled by user/)
    expect(state.tasks.find((item) => item.id === taskA)?.status).toBe('blocked')
    expect(state.runs.find((item) => item.id === runB.runId)?.status).toBe('running')
    expect(state.tasks.find((item) => item.id === taskB)?.status).toBe('in_progress')

    // With nothing running for Alpha any more, forgetting it is allowed.
    const after = await store.mutate({ type: 'project.remove', id: projectA })
    expect(after.projects.map((item) => item.name)).toEqual(['Bravo'])
    expect(after.tasks.some((item) => item.projectId === projectA)).toBe(false)
    expect(after.runs.some((item) => item.projectId === projectA)).toBe(false)
    // Bravo keeps its live run untouched.
    expect(after.runs.find((item) => item.id === runB.runId)?.status).toBe('running')
    expect(after.projects.find((item) => item.id === projectB)).toBeDefined()
  })

  it('reports nothing to stop when the project has no live work', async () => {
    const { projectB, orchestrator } = await workspaceFixture()
    expect(await orchestrator.stopProjectWork(projectB)).toBe(0)
  })
})
