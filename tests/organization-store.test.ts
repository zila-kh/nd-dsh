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

  it('materializes PM plans into dependency-aware work and tracks review progress', async () => {
    const store = await storeFixture()
    let state = await store.mutate({ type: 'company.create', name: 'Acme', mission: 'Ship software' })
    const company = state.companies[0]!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Product', objective: 'Launch v1' })
    const project = state.projects[0]!
    await store.applyPlan(project.id, {
      goal: { title: 'Launch', description: 'Launch v1 safely' },
      milestones: [{ title: 'Build', description: 'Build it', tasks: [
        { title: 'Foundation', description: 'Create foundation', role: 'Software Engineer' },
        { title: 'Finish', description: 'Complete feature', dependsOn: ['Foundation'], role: 'Software Engineer' },
      ] }],
    })
    state = await store.state()
    const first = state.tasks.find((item) => item.title === 'Foundation')!
    const second = state.tasks.find((item) => item.title === 'Finish')!
    expect(first.status).toBe('ready')
    expect(second.status).toBe('backlog')
    expect(second.dependsOn).toEqual([first.id])

    await store.markExecution(first.id, 'worker-session')
    await store.markForReview(first.id, 'Implemented and tested')
    await store.markReviewStarted(first.id, 'review-session')
    await store.completeReview(first.id, true, 'Verified', [{ title: 'Lesson', content: 'Keep the contract stable', tags: ['review'] }])
    state = await store.state()
    expect(state.tasks.find((item) => item.id === first.id)?.status).toBe('completed')
    expect(state.tasks.find((item) => item.id === second.id)?.status).toBe('ready')
    expect(state.memory.some((item) => item.title === 'Lesson')).toBe(true)
    expect(state.projects[0]?.progress).toBe(50)
    expect(state.goals[0]?.progress).toBe(50)
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
})
