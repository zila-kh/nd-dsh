import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nd-org-workspace-provenance-'))
  temporary.push(dir)
  const store = new OrganizationStore(join(dir, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Taxi Co', mission: 'Ship mobility software' })
  const company = state.companies[0]!
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Taxi App', objective: 'Ship MVP', workspacePath: dir })
  const project = state.projects[0]!
  state = await store.mutate({ type: 'role.create', companyId: company.id, name: 'Backend Engineer', responsibility: 'Build backend', systemPrompt: 'Implement safely' })
  const role = state.roles[0]!
  state = await store.mutate({ type: 'team.create', companyId: company.id, name: 'Backend', purpose: 'Own backend', roleIds: [role.id] })
  const team = state.teams[0]!
  state = await store.mutate({ type: 'agent.create', companyId: company.id, name: 'Worker A', roleId: role.id, teamId: team.id })
  const agent = state.agents[0]!
  state = await store.mutate({
    type: 'task.create',
    companyId: company.id,
    projectId: project.id,
    title: 'Ride matching',
    description: 'Implement matching',
    assignedAgentId: agent.id,
  })
  return { store, company, project, task: state.tasks[0]!, agent, team }
}

describe('organization workspace provenance', () => {
  it('persists engine/workspace/baseline/checkpoint/permit identity for a writable task run', async () => {
    const { store, company, project, task } = await fixture()
    const run = await store.beginRun(
      'task-execution',
      company.id,
      project.id,
      'zcode-session-1',
      task.id,
      undefined,
      {
        parallelTask: true,
        engineId: 'zcode-cli',
        workspaceKind: 'git-worktree',
        workspaceRoot: '/tmp/task-worktree',
        workspaceBranch: 'nd-dsh/task-ride-matching',
        baselineCommit: 'abc123',
        runtimePermitId: 'permit-1',
      },
    )
    await store.markExecution(task.id, run.sessionId)
    await store.updateRunProvenance(run.id, { checkpointCommit: 'def456' })

    const state = await store.state()
    const saved = state.runs.find((item) => item.id === run.id)
    expect(saved).toMatchObject({
      engineId: 'zcode-cli',
      workspaceKind: 'git-worktree',
      workspaceRoot: '/tmp/task-worktree',
      workspaceBranch: 'nd-dsh/task-ride-matching',
      baselineCommit: 'abc123',
      checkpointCommit: 'def456',
      runtimePermitId: 'permit-1',
    })
    expect(state.coordination.some((item) => item.taskId === task.id && item.kind === 'progress')).toBe(true)
  })

  it('records review handoff and keeps integration conflict distinct from generic execution failure', async () => {
    const { store, task } = await fixture()
    await store.markExecution(task.id, 'session-1')
    await store.markForReview(task.id, 'implementation ready')
    await store.markIntegrationConflict(task.id, 'merge conflict in src/core.ts')

    let state = await store.state()
    let saved = state.tasks.find((item) => item.id === task.id)
    expect(saved?.status).toBe('blocked')
    expect(saved?.integrationState).toBe('conflict')
    expect(saved?.integrationSummary).toContain('merge conflict')
    expect(state.coordination.some((item) => item.taskId === task.id && item.kind === 'review-request')).toBe(true)
    expect(state.coordination.some((item) => item.taskId === task.id && item.kind === 'blocker')).toBe(true)

    await store.queueRework(task.id, 'rebase against current base')
    state = await store.state()
    saved = state.tasks.find((item) => item.id === task.id)
    expect(saved?.status).toBe('ready')
    expect(saved?.integrationState).toBe('pending')
    expect(saved?.integrationSummary).toBeUndefined()

    await store.markIntegrated(task.id, 'feedbeef')
    saved = (await store.state()).tasks.find((item) => item.id === task.id)
    expect(saved?.integrationState).toBe('integrated')
    expect(saved?.integratedHead).toBe('feedbeef')
  })
})
