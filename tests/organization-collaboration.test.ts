import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'nd-org-collaboration-'))
  temporary.push(dir)
  const path = join(dir, 'organization.json')
  const store = new OrganizationStore(path)
  let state = await store.mutate({ type: 'company.create', name: 'Taxi Co', mission: 'Ship with a real local team' })
  const company = state.companies[0]!
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Taxi App', objective: 'Ship MVP', workspacePath: dir })
  return { path, store, company, project: state.projects[0]!, owner: (state.members ?? [])[0]! }
}

describe('local team collaboration', () => {
  it('seeds a local human member and persists project/task discussion across restart', async () => {
    const { path, store, company, project, owner } = await fixture()
    let state = await store.mutate({ type: 'member.create', companyId: company.id, displayName: 'Dara', title: 'Product Lead' })
    const dara = (state.members ?? []).find((item) => item.displayName === 'Dara')!
    state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Payments', description: 'Implement payment flow' })
    const task = state.tasks[0]!

    await store.mutate({
      type: 'collaboration.message.add',
      companyId: company.id,
      projectId: project.id,
      authorMemberId: owner.id,
      body: 'Project kickoff. @Dara please review payments.',
      mentionActorIds: [dara.id],
    })
    await store.mutate({
      type: 'collaboration.message.add',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      authorMemberId: dara.id,
      body: 'Use the existing payment callback contract.',
    })

    const reloaded = new OrganizationStore(path)
    state = await reloaded.state()
    expect((state.members ?? []).map((item) => item.displayName)).toEqual(expect.arrayContaining(['Owner', 'Dara']))
    expect(state.messages ?? []).toHaveLength(2)
    expect((state.messages ?? []).find((item) => item.taskId === task.id)?.body).toContain('payment callback')
    expect((state.messages ?? [])[0]?.mentionActorIds).toContain(dara.id)
    expect(JSON.parse(await readFile(path, 'utf8')).messages).toHaveLength(2)
  })

  it('records decisions with explicit supersession history', async () => {
    const { store, company, project, owner } = await fixture()
    let state = await store.mutate({
      type: 'decision.create',
      companyId: company.id,
      projectId: project.id,
      authorMemberId: owner.id,
      title: 'Database',
      summary: 'Use SQLite for local collaboration.',
      rationale: 'The local milestone must not require a server.',
    })
    const first = (state.decisions ?? [])[0]!
    state = await store.mutate({
      type: 'decision.supersede',
      id: first.id,
      authorMemberId: owner.id,
      title: 'Database',
      summary: 'Keep SQLite behind a repository abstraction.',
      rationale: 'This preserves a future sync/storage migration path.',
    })
    expect((state.decisions ?? []).find((item) => item.id === first.id)?.status).toBe('superseded')
    expect((state.decisions ?? []).find((item) => item.supersedesDecisionId === first.id)?.status).toBe('active')
  })

  it('never treats friendly chat as approval and binds explicit approval to the exact checkpoint', async () => {
    const { store, company, project, owner } = await fixture()
    let state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Callback', description: 'Fix callback' })
    const task = state.tasks[0]!
    const run = await store.beginRun('task-execution', company.id, project.id, 'session-1', task.id, undefined, {
      parallelTask: true,
      engineId: 'nd-native',
      workspaceKind: 'git-worktree',
      workspaceRoot: '/tmp/task',
      baselineCommit: 'base',
    })
    await store.updateRunProvenance(run.id, { checkpointCommit: 'checkpoint-a' })

    await store.mutate({
      type: 'collaboration.message.add',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      authorMemberId: owner.id,
      body: 'looks good 👍',
    })
    expect((await store.state()).approvalRequests ?? []).toHaveLength(0)

    state = await store.mutate({
      type: 'approval.request',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      requesterMemberId: owner.id,
      targetKind: 'task-review',
      targetId: task.id,
    })
    const request = (state.approvalRequests ?? [])[0]!
    expect(request.targetRevision).toBe('checkpoint-a')

    await store.updateRunProvenance(run.id, { checkpointCommit: 'checkpoint-b' })
    await expect(store.mutate({ type: 'approval.resolve', id: request.id, actorMemberId: owner.id, verdict: 'approve' }))
      .rejects.toThrow(/stale/i)
    expect(((await store.state()).approvalRequests ?? [])[0]?.status).toBe('pending')
  })

  it('fails closed when an integration approval is requested or resolved after merge-back', async () => {
    const { store, company, project, owner } = await fixture()
    let state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Merged task', description: 'Checkpoint then integrate' })
    const task = state.tasks[0]!
    const run = await store.beginRun('task-execution', company.id, project.id, 'session-integrated', task.id, undefined, {
      parallelTask: true,
      engineId: 'nd-native',
      workspaceKind: 'git-worktree',
      workspaceRoot: '/tmp/task-integrated',
      baselineCommit: 'base',
    })
    await store.updateRunProvenance(run.id, { checkpointCommit: 'checkpoint-integrated' })

    state = await store.mutate({
      type: 'approval.request',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      requesterMemberId: owner.id,
      targetKind: 'integration',
      targetId: task.id,
    })
    const pending = (state.approvalRequests ?? [])[0]!
    await store.markIntegrated(task.id, 'checkpoint-integrated')

    await expect(store.mutate({ type: 'approval.resolve', id: pending.id, actorMemberId: owner.id, verdict: 'request_changes' }))
      .rejects.toThrow(/already been integrated/i)

    await expect(store.mutate({
      type: 'approval.request',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      requesterMemberId: owner.id,
      targetKind: 'integration',
      targetId: task.id,
    })).rejects.toThrow(/already integrated/i)
  })

  it('records explicit human verdicts independently from agent review state', async () => {
    const { store, company, project, owner } = await fixture()
    let state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'UI', description: 'Polish team view' })
    const task = state.tasks[0]!
    const run = await store.beginRun('task-execution', company.id, project.id, 'session-2', task.id, undefined, {
      parallelTask: true,
      engineId: 'nd-native',
      workspaceKind: 'git-worktree',
      workspaceRoot: '/tmp/task-ui',
      baselineCommit: 'base',
    })
    await store.updateRunProvenance(run.id, { checkpointCommit: 'ui-123' })
    state = await store.mutate({
      type: 'approval.request',
      companyId: company.id,
      projectId: project.id,
      taskId: task.id,
      requesterMemberId: owner.id,
      targetKind: 'integration',
      targetId: task.id,
    })
    const request = (state.approvalRequests ?? [])[0]!
    state = await store.mutate({
      type: 'approval.resolve',
      id: request.id,
      actorMemberId: owner.id,
      verdict: 'request_changes',
      comment: 'Tighten the empty state before integration.',
    })
    expect((state.approvalRequests ?? [])[0]?.status).toBe('changes_requested')
    expect((state.approvalVerdicts ?? [])[0]).toMatchObject({ verdict: 'request_changes', actor: { kind: 'human', id: owner.id } })
    expect(state.tasks[0]?.status).toBe('ready')
  })
})
