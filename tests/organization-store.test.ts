import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'

async function storeFixture(): Promise<OrganizationStore> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-org-'))
  return new OrganizationStore(join(dir, 'organization.json'))
}

describe('OrganizationStore', () => {
  it('seeds an isolated AI company with workforce, skills, workflow, and safe policies', async () => {
    const store = await storeFixture()
    const a = await store.mutate({ type: 'company.create', name: 'Company A', mission: 'Build A' })
    const companyA = a.companies[0]!
    expect(a.roles.filter((item) => item.companyId === companyA.id).map((item) => item.name)).toEqual(expect.arrayContaining(['Product Manager', 'Software Engineer', 'Reviewer', 'Researcher']))
    expect(a.teams.filter((item) => item.companyId === companyA.id)).toHaveLength(3)
    expect(a.agents.filter((item) => item.companyId === companyA.id)).toHaveLength(4)
    expect(a.skills.filter((item) => item.scope === 'builtin').length).toBeGreaterThanOrEqual(8)
    expect(a.workflows.find((item) => item.companyId === companyA.id)?.steps.map((item) => item.kind)).toEqual(['plan', 'execute', 'review'])
    expect(a.policies.find((item) => item.companyId === companyA.id && item.action === 'data.destructive')?.effect).toBe('deny')

    const b = await store.mutate({ type: 'company.create', name: 'Company B', mission: 'Build B' })
    const companyB = b.companies.find((item) => item.id !== companyA.id)!
    const withProject = await store.mutate({ type: 'project.create', companyId: companyB.id, name: 'B project', objective: 'Only B' })
    const projectB = withProject.projects.find((item) => item.companyId === companyB.id)!
    await expect(store.mutate({ type: 'skill.create', scope: 'project', companyId: companyA.id, projectId: projectB.id, name: 'Leak', description: 'bad', instructions: 'bad' })).rejects.toThrow(/company boundary/i)
  })

  it('materializes PM plans into dependency-aware assigned work and tracks milestones, review memory, and project progress', async () => {
    const store = await storeFixture()
    let state = await store.mutate({ type: 'company.create', name: 'Acme', mission: 'Ship software' })
    const company = state.companies[0]!
    const builder = state.agents.find((item) => item.companyId === company.id && item.name === 'Builder')!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Product', objective: 'Launch v1' })
    const project = state.projects[0]!
    await store.applyPlan(project.id, {
      goal: { title: 'Launch', description: 'Launch v1 safely' },
      milestones: [{ title: 'Build', description: 'Build it', tasks: [
        { title: 'Foundation', description: 'Create foundation' },
        { title: 'Finish', description: 'Complete feature', dependsOn: ['Foundation'] },
      ] }],
    })
    state = await store.state()
    const first = state.tasks.find((item) => item.title === 'Foundation')!
    const second = state.tasks.find((item) => item.title === 'Finish')!
    expect(first.status).toBe('ready')
    expect(second.status).toBe('backlog')
    expect(second.dependsOn).toEqual([first.id])
    expect(first.assignedAgentId).toBe(builder.id)
    expect(second.assignedAgentId).toBe(builder.id)
    expect(state.projects[0]?.teamIds).toContain(builder.teamId)
    expect(state.milestones[0]?.status).toBe('active')

    await store.markExecution(first.id, 'worker-session')
    await store.markForReview(first.id, 'Implemented and tested')
    await store.markReviewStarted(first.id, 'review-session')
    await store.completeReview(first.id, true, 'Verified', [{ title: 'Lesson', content: 'Keep the contract stable', tags: ['review'] }])
    state = await store.state()
    expect(state.tasks.find((item) => item.id === first.id)?.status).toBe('completed')
    expect(state.tasks.find((item) => item.id === second.id)?.status).toBe('ready')
    expect(state.memory.some((item) => item.title === 'Lesson')).toBe(true)
    expect(state.memory.some((item) => item.title === 'Review: Foundation')).toBe(true)
    expect(state.projects[0]?.progress).toBe(50)
    expect(state.projects[0]?.status).toBe('active')
    expect(state.goals[0]?.progress).toBe(50)
    expect(state.milestones[0]?.status).toBe('active')
  })

  it('uses project workflows as the active execution policy', async () => {
    const store = await storeFixture()
    let state = await store.mutate({ type: 'company.create', name: 'Workflow Co', mission: 'Ship with explicit workflows' })
    const company = state.companies[0]!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'No review project', objective: 'Ship internal prototype' })
    const project = state.projects[0]!
    await store.mutate({ type: 'workflow.create', companyId: company.id, projectId: project.id, name: 'Execute only', steps: [{ id: 'execute', name: 'Execute', kind: 'execute' }] })
    const workflow = await store.workflowForProject(project.id)
    expect(workflow?.name).toBe('Execute only')
    expect(workflow?.steps.map((item) => item.kind)).toEqual(['execute'])
  })

  it('persists policies and organization state atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-org-persist-'))
    const path = join(dir, 'organization.json')
    const store = new OrganizationStore(path)
    let state = await store.mutate({ type: 'company.create', name: 'Persisted', mission: 'Remember everything' })
    const company = state.companies[0]!
    await store.mutate({ type: 'policy.set', companyId: company.id, action: 'production.deploy', effect: 'deny', description: 'No autonomous production deploys' })
    await store.mutate({ type: 'memory.add', companyId: company.id, title: 'Rule', content: 'Always review releases', tags: ['release'] })
    const reloaded = new OrganizationStore(path)
    state = await reloaded.state()
    expect(state.policies.find((item) => item.action === 'production.deploy')?.effect).toBe('deny')
    expect(state.memory.find((item) => item.title === 'Rule')?.content).toContain('review releases')
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
  })

  it('stores project runtime fields and clears blank or invalid ones instead of persisting them', async () => {
    const store = await storeFixture()
    let state = await store.mutate({ type: 'company.create', name: 'Runtime Co', mission: 'Run the app under development' })
    const company = state.companies[0]!
    state = await store.mutate({
      type: 'project.create',
      companyId: company.id,
      name: 'Todo Beta',
      objective: 'Ship Todo',
      workspacePath: '/workspace/todo',
      startCommand: 'npm run dev',
      targetPort: 3000,
    })
    const project = state.projects[0]!
    expect(project.startCommand).toBe('npm run dev')
    expect(project.targetPort).toBe(3000)

    state = await store.mutate({
      type: 'project.update',
      id: project.id,
      patch: { startCommand: '   ', targetPort: 0, targetUrl: 'http://localhost:3000', healthCheckPath: '/healthz' },
    })
    const updated = state.projects.find((item) => item.id === project.id)!
    expect(updated.startCommand).toBeUndefined()
    expect(updated.targetPort).toBeUndefined()
    expect(updated.targetUrl).toBe('http://localhost:3000')
    expect(updated.healthCheckPath).toBe('/healthz')
  })

  it('rejects escaped or relative workspace paths before they can strand a project', async () => {
    const store = await storeFixture()
    const company = (await store.mutate({ type: 'company.create', name: 'Workspace Co', mission: 'Keep workspaces valid' })).companies[0]!

    await expect(store.mutate({
      type: 'project.create',
      companyId: company.id,
      name: 'Broken path',
      objective: 'Should not persist',
      workspacePath: 'C:Users\tbroken',
    })).rejects.toThrow(/control characters/i)

    await expect(store.mutate({
      type: 'project.create',
      companyId: company.id,
      name: 'Relative path',
      objective: 'Should not persist',
      workspacePath: 'examples/todo',
    })).rejects.toThrow(/must be absolute/i)
  })
})
