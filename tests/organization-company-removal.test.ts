import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'
import type { OrganizationSnapshot } from '../src/shared/organization.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  store: OrganizationStore
  statePath: string
  companyId: string
  projectId: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-company-removal-'))
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
  return { store, statePath, companyId, projectId }
}

describe('organization company removal', () => {
  it('forgets the company and every ND record it owns', async () => {
    const { store, companyId, projectId } = await fixture()
    const before = await store.state()
    expect(before.tasks.length).toBe(2)
    expect(before.agents.length).toBeGreaterThan(0)
    expect(before.roles.length).toBeGreaterThan(0)
    expect(before.teams.length).toBeGreaterThan(0)
    expect(before.policies.length).toBeGreaterThan(0)

    const after = await store.mutate({ type: 'company.remove', id: companyId })

    expect(after.companies.find((item) => item.id === companyId)).toBeUndefined()
    expect(after.projects.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.tasks.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.goals.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.milestones.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.runs.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.memory.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.agents.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.roles.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.teams.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.policies.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.coordination.filter((item) => item.companyId === companyId)).toHaveLength(0)
    // Builtin skills survive; company-scoped ones are gone.
    expect(after.skills.every((item) => item.scope === 'builtin')).toBe(true)
  })

  it('refuses to remove a company while one of its runs is active', async () => {
    const { store, companyId, projectId } = await fixture()
    const task = await store.mutate({
      type: 'task.create',
      companyId,
      projectId,
      title: 'Long job',
      description: 'Runs while removal is attempted',
    })
    const taskId = task.tasks[0]!.id
    await store.beginRun('task-execution', companyId, projectId, 'session-live', taskId)

    await expect(store.mutate({ type: 'company.remove', id: companyId })).rejects.toThrow(/Cancel the running task-execution/)
    const after = await store.state()
    expect(after.companies.find((item) => item.id === companyId)).toBeDefined()
  })

  it('moves the active marker to another company and clears it when none remain', async () => {
    const { store, companyId } = await fixture()
    const second = await store.mutate({ type: 'company.create', name: 'Survivor Co', mission: 'Stay' })
    const survivorId = second.companies.find((item) => item.name === 'Survivor Co')!.id
    await store.mutate({ type: 'company.activate', id: companyId })

    const afterFirst = await store.mutate({ type: 'company.remove', id: companyId })
    expect(afterFirst.activeCompanyId).toBe(survivorId)

    const afterSecond = await store.mutate({ type: 'company.remove', id: survivorId })
    expect(afterSecond.activeCompanyId).toBeUndefined()
    expect(afterSecond.activeProjectId).toBeUndefined()
    expect(afterSecond.companies).toHaveLength(0)
  })

  it('keeps the removal after a reload', async () => {
    const { store, statePath, companyId } = await fixture()
    await store.mutate({ type: 'company.remove', id: companyId })

    const reloaded = new OrganizationStore(statePath)
    const state = await reloaded.state()
    expect(state.companies).toHaveLength(0)
    expect(state.projects).toHaveLength(0)
    expect(state.tasks).toHaveLength(0)
    expect(state.agents).toHaveLength(0)
  })

  it('drops company-scoped skills and workflows but keeps builtins', async () => {
    const { store, companyId, projectId } = await fixture()
    await store.mutate({ type: 'skill.create', scope: 'company', name: 'Company skill', description: 'Scoped', instructions: 'Use it', companyId })
    await store.mutate({ type: 'skill.create', scope: 'project', name: 'Project skill', description: 'Scoped', instructions: 'Use it', companyId, projectId })
    await store.mutate({ type: 'workflow.create', companyId, name: 'Company workflow', steps: [{ id: 'step-1', name: 'Only step', kind: 'execute' }] })

    const after = await store.mutate({ type: 'company.remove', id: companyId })

    expect(after.skills.some((item) => item.name === 'Company skill')).toBe(false)
    expect(after.skills.some((item) => item.name === 'Project skill')).toBe(false)
    expect(after.workflows.filter((item) => item.companyId === companyId)).toHaveLength(0)
    expect(after.skills.some((item) => item.scope === 'builtin')).toBe(true)
  })

  it('releases agents whose active task belonged to the removed company', async () => {
    const { store, statePath, companyId } = await fixture()
    const snapshot = JSON.parse(await readFile(statePath, 'utf8')) as OrganizationSnapshot
    const taskId = snapshot.tasks[0]!.id
    const agent = snapshot.agents[0]!
    agent.status = 'working'
    agent.currentTaskId = taskId
    await writeFile(statePath, JSON.stringify(snapshot), 'utf8')

    const reloaded = new OrganizationStore(statePath)
    const after = await reloaded.mutate({ type: 'company.remove', id: companyId })

    expect(after.agents.filter((item) => item.companyId === companyId)).toHaveLength(0)
  })
})
