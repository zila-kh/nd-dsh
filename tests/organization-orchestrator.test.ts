import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'
import { TaskWorktreeManager } from '../src/main/organization/task-worktree.js'

class FakeHarness {
  private counter = 0
  private canceled = new Set<string>()
  prompts: Array<{ prompt: string; sessionId?: string }> = []
  renames: Array<{ sessionId: string; title: string }> = []
  titles = new Map<string, string>()
  renameError?: Error
  onStop?: () => Promise<void>
  async createSession(): Promise<string> { this.counter += 1; return `session-${this.counter}` }
  async renameSession(sessionId: string, title: string): Promise<void> {
    if (this.renameError) throw this.renameError
    this.renames.push({ sessionId, title })
    this.titles.set(sessionId, title)
  }
  async gatewayRpc(method: string): Promise<{ ok: true; value: unknown }> {
    if (method === 'session.cancel') {
      await this.onStop?.()
      return { ok: true, value: { sessionId: '' } }
    }
    if (method === 'session.list') {
      return {
        ok: true,
        value: {
          items: [...this.titles].map(([sessionId, title]) => ({ sessionId, projections: { values: { title } } })),
        },
      }
    }
    if (method !== 'session.create') throw new Error(`Unexpected gateway method: ${method}`)
    return { ok: true, value: { sessionId: await this.createSession() } }
  }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { this.prompts.push({ prompt, ...(options?.sessionId ? { sessionId: options.sessionId } : {}) }); return { sessionId: options?.sessionId ?? 'session' } }
  async close(): Promise<void> {}
  status(): { provider: string; model: string } { return { provider: 'test-provider', model: 'test-model' } }
  cancel(sessionId: string): void { this.canceled.add(sessionId) }
  consumeCanceledSession(sessionId: string): boolean { return this.canceled.delete(sessionId) }
}
class FakeWorkspace {
  private root = '/workspace'
  state(): { root: string } { return { root: this.root } }
  async setRoot(path: string): Promise<{ root: string; name: string }> { this.root = path; return { root: path, name: path.split('/').at(-1) ?? path } }
}

async function fixture(autonomyLevel: 0 | 1 | 2 | 3 | 4 = 3) {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-orchestrator-'))
  const store = new OrganizationStore(join(dir, 'organization.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Autonomous Co', mission: 'Ship excellent software' })
  const company = state.companies[0]!
  await store.mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel } })
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'App', objective: 'Ship v1', workspacePath: '/workspace' })
  const project = state.projects[0]!
  const harness = new FakeHarness()
  const workspace = new FakeWorkspace()
  const orchestrator = new OrganizationOrchestrator(store, harness as never, workspace as never)
  return { store, company, project, harness, workspace, orchestrator }
}

function assistant(sessionId: string, text: string) {
  return { kind: 'session-event', sessionId, event: { type: 'assistant/message', seq: 1, time: Date.now(), data: { message: { content: [{ type: 'text', text }] } } } } as const
}
function stopped(sessionId: string) { return { kind: 'session-status', sessionId, running: false } as const }
function plan(tasks: Array<{ title: string; description: string; dependsOn?: string[]; role?: string }>): string {
  return `<nd-dsh-plan>${JSON.stringify({ goal: { title: 'Launch v1', description: 'Ship it' }, milestones: [{ title: 'Build', description: 'Implement', tasks: tasks.map((task) => ({ ...task, acceptanceCriteria: ['Tests pass'] })) }] })}</nd-dsh-plan>`
}
function review(verdict: 'pass' | 'fail', summary: string, issues: string[] = []): string {
  return `<nd-dsh-review>${JSON.stringify({ verdict, summary, issues, memory: [{ title: `Review ${verdict}`, content: summary, tags: ['review'] }] })}</nd-dsh-review>`
}

async function finishWorker(orchestrator: OrganizationOrchestrator, sessionId: string, summary = 'Implemented and validated.'): Promise<void> {
  await orchestrator.handleHarnessEvent(assistant(sessionId, summary))
  await orchestrator.handleHarnessEvent(stopped(sessionId))
}
async function finishReview(orchestrator: OrganizationOrchestrator, sessionId: string, verdict: 'pass' | 'fail', summary: string, issues: string[] = []): Promise<void> {
  await orchestrator.handleHarnessEvent(assistant(sessionId, review(verdict, summary, issues)))
  await orchestrator.handleHarnessEvent(stopped(sessionId))
}

describe('OrganizationOrchestrator', () => {
  it('holds future work through automatic execution and run-next but finishes review after focus changes', async () => {
    const { store, project, harness, orchestrator } = await fixture(3)
    await store.applyPlan(project.id, { goal: { title: 'MVP', description: 'Ship a slice' }, milestones: [
      { title: 'Now', description: 'First slice', tasks: [{ title: 'Deliver now', description: 'Build' }] },
      { title: 'Later', description: 'Next slice', tasks: [{ title: 'Future critical', description: 'Build later', priority: 'critical' }] },
    ] })
    let state = await store.state()
    const now = state.tasks.find((task) => task.title === 'Deliver now')!
    const future = state.tasks.find((task) => task.title === 'Future critical')!
    await expect(orchestrator.runTask(future.id, false)).rejects.toThrow(/outside.*milestone/i)
    expect(harness.prompts).toHaveLength(0)
    const execution = await orchestrator.runNext(project.id, false)
    expect(execution?.taskId).toBe(now.id)
    await store.mutate({ type: 'project.update', id: project.id, patch: { deliveryMilestoneId: state.milestones[1]!.id } })
    await finishWorker(orchestrator, execution!.sessionId, 'First slice delivered')
    state = await store.state()
    const review = state.runs.find((run) => run.kind === 'task-review' && run.status === 'running')!
    expect(review.taskId).toBe(now.id)
    await finishReview(orchestrator, review.sessionId, 'pass', 'Verified first slice')
    state = await store.state()
    expect(state.tasks.find((task) => task.id === now.id)?.status).toBe('completed')
    expect(state.runs.find((run) => run.status === 'running')?.taskId).toBe(future.id)
  })

  it('shares cancellation cleanup when the stop event races the cancel RPC response', async () => {
    const { store, company, project, harness, workspace } = await fixture(2)
    let notifyRollback!: () => void
    let releaseRollback!: () => void
    const rollbackStarted = new Promise<void>(resolve => { notifyRollback = resolve })
    const rollbackGate = new Promise<void>(resolve => { releaseRollback = resolve })
    const worktrees = new TaskWorktreeManager()
    const worktree = { root: '/workspace/task', repoRoot: '/workspace', branch: 'task-test', taskId: 'test' }
    vi.spyOn(worktrees, 'ensure').mockResolvedValue(worktree)
    vi.spyOn(worktrees, 'baseline').mockResolvedValue('baseline-commit')
    const rollback = vi.spyOn(worktrees, 'rollback').mockImplementation(async () => {
      notifyRollback()
      await rollbackGate
    })
    const orchestrator = new OrganizationOrchestrator(store, harness as never, workspace as never, undefined, undefined, undefined, undefined, undefined, worktrees)
    const state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Cancelable isolated task', description: 'Build it.' })
    const execution = await orchestrator.runTask(state.tasks[0]!.id)
    let stopEvent!: Promise<void>
    harness.onStop = async () => {
      stopEvent = orchestrator.handleHarnessEvent(stopped(execution.sessionId))
      await rollbackStarted
    }
    const canceled = orchestrator.cancelRun(execution.runId)
    await rollbackStarted
    // Let the RPC response and a second terminal event arrive while rollback is busy.
    const lateError = orchestrator.handleHarnessEvent({ kind: 'agent-error', sessionId: execution.sessionId, message: 'Turn aborted' })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(rollback).toHaveBeenCalledTimes(1)
    releaseRollback()
    await Promise.all([canceled, stopEvent, lateError])
    const after = await store.state()
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(after.runs.find(run => run.id === execution.runId)?.status).toBe('failed')
    expect(after.tasks[0]?.status).toBe('blocked')
    expect(after.activity.filter(item => item.type === 'task.blocked' && item.message.includes('Cancelable isolated task'))).toHaveLength(1)
    expect(after.runs.some(run => run.kind === 'task-review')).toBe(false)
  })

  it('gives workers and reviewers the exact artifact contract used by the delivery gate', async () => {
    const { store, company, project, harness, orchestrator } = await fixture(2)
    const root = await mkdtemp(join(tmpdir(), 'nd-artifact-contract-'))
    await writeFile(join(root, 'README.md'), '# Non-Git research workspace\n')
    await store.mutate({ type: 'project.update', id: project.id, patch: { workspacePath: root, testCommand: 'node --test' } })
    let state = await store.mutate({
      type: 'task.create', companyId: company.id, projectId: project.id,
      title: 'Research accessibility', description: 'Document the findings.',
      evidenceKind: 'artifact', artifactPaths: ['docs/research/ux-a11y-i18n.md'],
      acceptanceCriteria: ['Document actionable accessibility findings'],
    })
    const task = state.tasks[0]!
    const execution = await orchestrator.runTask(task.id)
    expect(harness.prompts.at(-1)?.prompt).toContain('docs/research/ux-a11y-i18n.md')
    expect(harness.prompts.at(-1)?.prompt).toContain('exact paths')
    expect(harness.prompts.at(-1)?.prompt).toContain('artifact verification rather than the project test command')

    // Prose plus an artifact at a different path must still fail closed.
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs/ux-a11y-i18n.md'), '# Findings\nUse labelled controls.\n')
    await finishWorker(orchestrator, execution.sessionId, 'Research complete.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('blocked')
    expect(state.runs.find(run => run.id === execution.runId)?.error).toContain('docs')
    expect(state.runs.some(run => run.kind === 'task-review')).toBe(false)

    await mkdir(join(root, 'docs/research'), { recursive: true })
    await writeFile(join(root, 'docs/research/ux-a11y-i18n.md'), '# Findings\nUse labelled controls.\n')
    const retry = await orchestrator.runTask(task.id)
    await finishWorker(orchestrator, retry.sessionId, 'Required artifact produced.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('review')
    await orchestrator.reviewTask(task.id)
    expect(harness.prompts.at(-1)?.prompt).toContain('docs/research/ux-a11y-i18n.md')
    expect(harness.prompts.at(-1)?.prompt).toContain('Inspect the content against the acceptance criteria')
    await rm(root, { recursive: true, force: true })
  })

  it('tells code workers the configured machine command and exposes skipped verification', async () => {
    const { store, company, project, harness, orchestrator } = await fixture(2)
    let state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Code task', description: 'Build the feature.' })
    const task = state.tasks[0]!
    const first = await orchestrator.runTask(task.id)
    expect(harness.prompts.at(-1)?.prompt).toContain('machine verification as skipped')
    await finishWorker(orchestrator, first.sessionId)
    await store.mutate({ type: 'project.update', id: project.id, patch: { testCommand: 'node --test' } })
    state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Verified code task', description: 'Build another feature.' })
    await orchestrator.runTask(state.tasks.find(item => item.title === 'Verified code task')!.id)
    expect(harness.prompts.at(-1)?.prompt).toContain('Project machine-verification command: node --test')
  })

  it('runs PM → worker → independent review automatically at autonomy level 3', async () => {
    const { store, project, harness, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, plan([{ title: 'Implement feature', description: 'Build and test it', role: 'Software Engineer' }])))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))
    let state = await store.state()
    const task = state.tasks[0]!
    expect(task.status).toBe('in_progress')
    expect(task.executionSessionId).toBe('session-2')

    await finishWorker(orchestrator, 'session-2', 'Implemented the feature and tests pass.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('review')
    expect(state.tasks[0]?.reviewSessionId).toBe('session-3')

    await finishReview(orchestrator, 'session-3', 'pass', 'Verified implementation and tests.')
    state = await store.state()
    expect(state.tasks[0]?.status).toBe('completed')
    expect(state.projects[0]?.progress).toBe(100)
    expect(state.memory.some((item) => item.title === 'Review pass')).toBe(true)
    expect(state.memory.some((item) => item.title === 'Review: Implement feature')).toBe(true)
    expect(harness.prompts).toHaveLength(3)
    // Sessions carry the real work title, not the runtime's "You are…" first-prompt fallback.
    expect(harness.renames).toEqual([
      { sessionId: 'session-1', title: 'Plan · App' },
      { sessionId: 'session-2', title: 'Implement feature' },
      { sessionId: 'session-3', title: 'Review · Implement feature' },
    ])
  })

  it('keeps the run alive when a session rename fails', async () => {
    const { store, project, harness, orchestrator } = await fixture()
    harness.renameError = new Error('rename unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const planRun = await orchestrator.planProject(project.id)
      expect(planRun.sessionId).toBe('session-1')
      await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, plan([{ title: 'Implement feature', description: 'Build and test it' }])))
      await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))
      const state = await store.state()
      expect(state.tasks[0]?.status).toBe('in_progress')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('session rename failed'), 'rename unavailable')
    } finally {
      warn.mockRestore()
    }
  })

  it('backfills only sessions that still carry the first-prompt fallback title', async () => {
    const { store, company, project, harness, orchestrator } = await fixture()
    const created = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Fix the login flow', description: 'Restore the session', acceptanceCriteria: ['Tests pass'] })
    const task = created.tasks[0]!
    const planRun = await store.beginRun('pm-plan', company.id, project.id, 'session-plan')
    await store.completeRun(planRun.id, 'planned')
    const reviewRun = await store.beginRun('task-review', company.id, project.id, 'session-review', task.id)
    await store.completeRun(reviewRun.id, 'reviewed')
    const executionRun = await store.beginRun('task-execution', company.id, project.id, 'session-renamed', task.id)
    await store.completeRun(executionRun.id, 'done')
    harness.titles.set('session-plan', 'You are the AI Product Manager for Autonomo')
    harness.titles.set('session-review', 'You are an independent reviewer for Autonom')
    // A real or user-pinned title must never be overwritten by the backfill.
    harness.titles.set('session-renamed', 'My own title')

    await orchestrator.backfillSessionTitles()

    expect(harness.renames).toHaveLength(2)
    expect(harness.renames).toEqual(expect.arrayContaining([
      { sessionId: 'session-plan', title: 'Plan · App' },
      { sessionId: 'session-review', title: 'Review · Fix the login flow' },
    ]))
  })

  it('assembles a structured PM plan from streamed assistant chunks', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    const output = plan([{ title: 'Streamed feature', description: 'Build it' }])
    let seq = 1
    for (const chunk of [output.slice(0, 24), output.slice(24, 80), output.slice(80)]) {
      await orchestrator.handleHarnessEvent({
        kind: 'session-event',
        sessionId: planRun.sessionId,
        event: { type: 'assistant/chunk', seq: seq++, time: Date.now(), data: { chunk: { type: 'text-delta', text: chunk } } },
      })
    }
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))
    const state = await store.state()
    expect(state.tasks[0]?.title).toBe('Streamed feature')
    expect(state.tasks[0]?.status).toBe('in_progress')
  })

  it('connects the full autopilot OS loop including rework, memory, dependencies, and next-task progression', async () => {
    const { store, project, harness, orchestrator } = await fixture(4)
    const planRun = await orchestrator.runNext(project.id, false)
    expect(planRun?.kind).toBe('pm-plan')

    await orchestrator.handleHarnessEvent(assistant('session-1', plan([
      { title: 'Foundation', description: 'Build the foundation' },
      { title: 'Finish', description: 'Finish the feature', dependsOn: ['Foundation'] },
    ])))
    await orchestrator.handleHarnessEvent(stopped('session-1'))

    let state = await store.state()
    const foundation = state.tasks.find((item) => item.title === 'Foundation')!
    const finish = state.tasks.find((item) => item.title === 'Finish')!
    const builder = state.agents.find((item) => item.name === 'Builder')!
    expect(foundation.assignedAgentId).toBe(builder.id)
    expect(finish.assignedAgentId).toBe(builder.id)
    expect(state.projects[0]?.teamIds).toContain(builder.teamId)
    expect(foundation.status).toBe('in_progress')
    expect(finish.status).toBe('backlog')

    await finishWorker(orchestrator, 'session-2', 'Foundation implemented, but a reviewer should verify edge cases.')
    await finishReview(orchestrator, 'session-3', 'fail', 'Edge case is missing.', ['Handle the empty-state edge case'])

    state = await store.state()
    expect(state.tasks.find((item) => item.id === foundation.id)?.status).toBe('in_progress')
    expect(harness.prompts.at(-1)?.prompt).toContain('Previous independent review feedback')
    expect(harness.prompts.at(-1)?.prompt).toContain('Handle the empty-state edge case')
    expect(state.memory.some((item) => item.title === 'Review: Foundation' && item.tags.includes('failed'))).toBe(true)

    await finishWorker(orchestrator, 'session-4', 'Edge case fixed and validation passes.')
    await finishReview(orchestrator, 'session-5', 'pass', 'Foundation now satisfies all acceptance criteria.')

    state = await store.state()
    expect(state.tasks.find((item) => item.id === foundation.id)?.status).toBe('completed')
    expect(state.tasks.find((item) => item.id === finish.id)?.status).toBe('in_progress')
    expect(state.projects[0]?.progress).toBe(50)
    expect(state.milestones[0]?.status).toBe('active')

    await finishWorker(orchestrator, 'session-6', 'Final feature work complete and tests pass.')
    await finishReview(orchestrator, 'session-7', 'pass', 'Final task verified.')

    state = await store.state()
    expect(state.tasks.every((item) => item.status === 'completed')).toBe(true)
    expect(state.projects[0]?.status).toBe('completed')
    expect(state.projects[0]?.progress).toBe(100)
    expect(state.goals[0]?.status).toBe('completed')
    expect(state.milestones[0]?.status).toBe('completed')
    expect(state.runs.filter((item) => item.kind === 'task-execution')).toHaveLength(3)
    expect(state.runs.filter((item) => item.kind === 'task-review')).toHaveLength(3)
    expect(await store.activeRun(project.id)).toBeUndefined()
  })

  it('caps automatic rework after three execution attempts', async () => {
    const { store, project, orchestrator } = await fixture(4)
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Hard task', description: 'Do hard work' }] }] })
    const first = await orchestrator.runNext(project.id, false)
    expect(first?.sessionId).toBe('session-1')

    await finishWorker(orchestrator, 'session-1')
    await finishReview(orchestrator, 'session-2', 'fail', 'Still wrong', ['Issue 1'])
    await finishWorker(orchestrator, 'session-3')
    await finishReview(orchestrator, 'session-4', 'fail', 'Still wrong', ['Issue 2'])
    await finishWorker(orchestrator, 'session-5')
    await finishReview(orchestrator, 'session-6', 'fail', 'Still wrong', ['Issue 3'])

    const state = await store.state()
    expect(state.tasks[0]?.status).toBe('blocked')
    expect(await store.executionAttemptCount(state.tasks[0]!.id)).toBe(3)
    expect(await store.activeRun(project.id)).toBeUndefined()
  })

  it('keeps a task reviewable when the reviewer omits the structured verdict', async () => {
    const { store, project, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Reviewable task', description: 'Do work' }] }] })
    const task = (await store.state()).tasks[0]!
    const execution = await orchestrator.runTask(task.id)

    await finishWorker(orchestrator, execution.sessionId)
    let state = await store.state()
    const reviewRun = state.runs.find((item) => item.kind === 'task-review')!
    expect(state.tasks[0]?.status).toBe('review')
    expect(state.tasks[0]?.reviewSessionId).toBe(reviewRun.sessionId)

    await orchestrator.handleHarnessEvent(assistant(reviewRun.sessionId, 'I reviewed the changes, but forgot the required result tag.'))
    await orchestrator.handleHarnessEvent(stopped(reviewRun.sessionId))

    state = await store.state()
    expect(state.tasks[0]?.status).toBe('review')
    expect(state.tasks[0]?.reviewSessionId).toBeUndefined()
    expect(state.runs.find((item) => item.id === reviewRun.id)?.status).toBe('failed')
    expect(state.runs.find((item) => item.id === reviewRun.id)?.error).toMatch(/structured task-review/i)
    expect(await store.activeRun(project.id)).toBeUndefined()
  })

  it('treats user cancellation as a failed blocked run instead of successful work', async () => {
    const { store, project, harness, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Cancelable task', description: 'Do work' }] }] })
    const task = (await store.state()).tasks[0]!
    const run = await orchestrator.runTask(task.id)

    harness.cancel(run.sessionId)
    await orchestrator.handleHarnessEvent(stopped(run.sessionId))

    const state = await store.state()
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe('blocked')
    expect(state.runs.find((item) => item.id === run.runId)?.status).toBe('failed')
    expect(state.runs.find((item) => item.id === run.runId)?.error).toMatch(/canceled by user/i)
    expect(state.runs.some((item) => item.kind === 'task-review')).toBe(false)
  })

  it('prevents a non-isolated second project from taking shared execution while work is active', async () => {
    const { store, company, project, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal A', description: 'Goal A' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Task A', description: 'Do A' }] }] })
    const taskA = (await store.state()).tasks.find((item) => item.projectId === project.id)!
    await orchestrator.runTask(taskA.id)

    let state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Second app', objective: 'Ship v2', workspacePath: '/workspace-two' })
    const secondProject = state.projects.find((item) => item.id !== project.id)!
    await store.applyPlan(secondProject.id, { goal: { title: 'Goal B', description: 'Goal B' }, milestones: [{ title: 'M2', description: 'M2', tasks: [{ title: 'Task B', description: 'Do B' }] }] })
    state = await store.state()
    const taskB = state.tasks.find((item) => item.projectId === secondProject.id)!

    await expect(orchestrator.runTask(taskB.id)).rejects.toThrow(/without an isolated Git worktree/i)
  })

  it('honors deny policy even for explicit execution', async () => {
    const { store, company, project, orchestrator } = await fixture()
    await store.applyPlan(project.id, { goal: { title: 'Goal', description: 'Goal' }, milestones: [{ title: 'M1', description: 'M1', tasks: [{ title: 'Task', description: 'Do work' }] }] })
    await store.mutate({ type: 'policy.set', companyId: company.id, action: 'task.execute', effect: 'deny', description: 'Human disabled execution' })
    const task = (await store.state()).tasks[0]!
    await expect(orchestrator.runTask(task.id)).rejects.toThrow(/denied by company policy/i)
  })

  it('pauses autopilot and does not loop infinitely when pm-plan fails', async () => {
    const { store, project, orchestrator } = await fixture(4)
    const run = await orchestrator.planProject(project.id, true)

    await orchestrator.handleHarnessEvent({ kind: 'agent-error', sessionId: run.sessionId, message: 'LLM API key missing' })

    const state = await store.state()
    expect(state.runs.filter((item) => item.kind === 'pm-plan').length).toBe(1)
    expect(state.runs[0]?.status).toBe('failed')
    expect(await orchestrator.runNext(project.id, false)).toBeNull()
  })

  it('robustly parses plans with markdown fences, trailing commas, uppercase tags, and omitted closing tags', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)

    // Messy output: uppercase tag, markdown fences, trailing commas, missing closing tag
    const messyOutput = `Here is the comprehensive plan:
<ND-DSH-PLAN>
\`\`\`json
{
  "goal": { "title": "Messy Launch", "description": "Ship it despite messy output", },
  "milestones": [
    {
      "title": "Delivery",
      "description": "Execute tasks",
      "tasks": [
        {
          "title": "Robust task 1",
          "description": "Handle formatting edge cases",
          "acceptanceCriteria": ["Works cleanly",],
        },
      ],
    },
  ],
}
\`\`\`
Hope this helps!`

    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, messyOutput))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))

    const state = await store.state()
    expect(state.tasks[0]?.title).toBe('Robust task 1')
    expect(state.tasks[0]?.status).toBe('in_progress')
  })

  it('recovers plans via fallback when tags are omitted entirely', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)

    const untaggedOutput = `I have analyzed the project requirements.
Here is the project plan:
{
  "goal": { "title": "Untagged Goal", "description": "Goal without xml tags" },
  "milestones": [
    {
      "title": "Untagged Milestone",
      "description": "Milestone 1",
      "tasks": [
        {
          "title": "Untagged Task",
          "description": "Task from untagged json",
          "acceptanceCriteria": ["Passes"]
        }
      ]
    }
  ]
}
Let me know if you need any adjustments.`

    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, untaggedOutput))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))

    const state = await store.state()
    expect(state.tasks[0]?.title).toBe('Untagged Task')
    expect(state.tasks[0]?.status).toBe('in_progress')
  })

  it('repairs a cyclic plan instead of rejecting it, and records the repair', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)

    const cyclicOutput = `<nd-dsh-plan>{
  "goal": { "title": "Cycle Goal", "description": "Has cycle" },
  "milestones": [
    {
      "title": "M1",
      "description": "Milestone",
      "tasks": [
        { "title": "Task A", "description": "A", "dependsOn": ["Task B"], "acceptanceCriteria": [] },
        { "title": "Task B", "description": "B", "dependsOn": ["Task A"], "acceptanceCriteria": [] }
      ]
    }
  ]
}</nd-dsh-plan>`

    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, cyclicOutput))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))

    const state = await store.state()
    const run = state.runs.find((item) => item.id === planRun.runId)!
    expect(run.status).toBe('completed')
    const taskA = state.tasks.find((item) => item.title === 'Task A')!
    const taskB = state.tasks.find((item) => item.title === 'Task B')!
    expect(taskA.dependsOn).toEqual([taskB.id])
    expect(taskB.dependsOn).toEqual([])
    expect(state.activity.find((item) => item.type === 'pm.plan')?.message).toMatch(/repaired 1 plan issue/)
  })

  it('keeps every milestone when the model repeats the milestones key (seen live with MiMo)', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    const output = '<nd-dsh-plan>{"goal":{"title":"Board","description":"x"},'
      + '"milestones":[{"title":"Foundation","description":"","tasks":[{"title":"Scaffold app","description":"s"}]}],'
      + '"milestones":[{"title":"Core","description":"","tasks":[{"title":"Build form","description":"f","dependsOn":["Scaffold app"]}]}]}</nd-dsh-plan>'
    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, output))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))

    const state = await store.state()
    expect(state.runs.find((item) => item.id === planRun.runId)?.status).toBe('completed')
    expect(state.milestones.filter((item) => item.projectId === project.id).map((item) => item.title)).toEqual(['Foundation', 'Core'])
    const scaffold = state.tasks.find((item) => item.title === 'Scaffold app')!
    expect(state.tasks.find((item) => item.title === 'Build form')?.dependsOn).toEqual([scaffold.id])
    expect(state.activity.find((item) => item.type === 'pm.plan')?.message).toMatch(/Merged 1 repeated/)
  })

  it('still fails a plan that has no tasks, with a specific diagnostic', async () => {
    const { store, project, orchestrator } = await fixture()
    const planRun = await orchestrator.planProject(project.id)
    await orchestrator.handleHarnessEvent(assistant(planRun.sessionId, '<nd-dsh-plan>{"goal":{"title":"Empty","description":"x"},"milestones":[{"title":"M1","tasks":[]}]}</nd-dsh-plan>'))
    await orchestrator.handleHarnessEvent(stopped(planRun.sessionId))

    const run = (await store.state()).runs.find((item) => item.id === planRun.runId)!
    expect(run.status).toBe('failed')
    expect(run.error).toContain('contains no tasks')
  })
})
