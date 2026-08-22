import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'

describe('organization recovery', () => {
  it('restores the last known-good backup when the primary snapshot is corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-org-recovery-'))
    const path = join(dir, 'organization.json')
    const store = new OrganizationStore(path)
    let state = await store.mutate({ type: 'company.create', name: 'Recovery Co', mission: 'Keep company state durable' })
    const company = state.companies[0]!
    await store.mutate({ type: 'memory.add', companyId: company.id, title: 'Durable fact', content: 'This must survive corruption.' })

    await writeFile(path, '{ definitely-not-json', 'utf8')
    const recovered = new OrganizationStore(path)
    state = await recovered.state()

    expect(state.companies[0]?.name).toBe('Recovery Co')
    expect(state.memory.some((item) => item.title === 'Durable fact')).toBe(true)
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1)
    expect(JSON.parse(await readFile(`${path}.bak`, 'utf8')).version).toBe(1)
  })

  it('marks stale running work failed and retryable after an app restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-org-interrupted-'))
    const path = join(dir, 'organization.json')
    const store = new OrganizationStore(path)
    let state = await store.mutate({ type: 'company.create', name: 'Restart Co', mission: 'Recover interrupted coding work' })
    const company = state.companies[0]!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'App', objective: 'Ship safely' })
    const project = state.projects[0]!
    await store.applyPlan(project.id, { goal: { title: 'Ship', description: 'Ship safely' }, milestones: [{ title: 'Build', description: 'Build', tasks: [{ title: 'Implement', description: 'Implement feature' }] }] })
    state = await store.state()
    const task = state.tasks[0]!
    const builder = state.agents.find((item) => item.id === task.assignedAgentId)!
    const run = await store.beginRun('task-execution', company.id, project.id, 'stale-session', task.id, task.goalId)
    await store.markExecution(task.id, run.sessionId)

    const restarted = new OrganizationStore(path)
    expect(await restarted.reconcileInterruptedRuns()).toBe(1)
    state = await restarted.state()

    expect(state.runs.find((item) => item.id === run.id)?.status).toBe('failed')
    expect(state.runs.find((item) => item.id === run.id)?.error).toMatch(/interrupted/i)
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe('blocked')
    expect(state.tasks.find((item) => item.id === task.id)?.reviewSummary).toMatch(/execution interrupted/i)
    expect(state.agents.find((item) => item.id === builder.id)?.status).toBe('idle')
    expect(await restarted.activeRun(project.id)).toBeUndefined()
    expect(state.activity.some((item) => item.type === 'run.interrupted')).toBe(true)
  })
})
