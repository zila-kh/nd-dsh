import { execFile } from 'node:child_process'
import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { ND_HARNESS_ENGINE_ID } from '../src/shared/coding-engines.js'
import { isRetryableExecutionFailure } from '../src/main/organization/execution-reliability.js'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'
import { TaskWorktreeManager } from '../src/main/organization/task-worktree.js'
import { runVerification } from '../src/main/organization/verification-evidence.js'

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

async function gitWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nd-dsh-beta-git-'))
  await git(root, ['init'])
  await writeFile(join(root, 'README.md'), '# beta\n')
  await git(root, ['add', 'README.md'])
  await git(root, ['-c', 'user.name=ND-DSH Test', '-c', 'user.email=test@local', 'commit', '-m', 'base'])
  return root
}

class FakeHarness {
  async createSession(): Promise<string> { return 'harness-session' }
  async run(_prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> { return { sessionId: options?.sessionId ?? 'harness-session' } }
  async close(): Promise<void> {}
  consumeCanceledSession(): boolean { return false }
}

class FakeWorkspace {
  constructor(private root: string) {}
  state(): { root: string } { return { root: this.root } }
  async setRoot(path: string): Promise<{ root: string; name: string }> { this.root = path; return { root: path, name: path.split('/').at(-1) ?? path } }
}

class FakeEngineRuns {
  private count = 0
  stopped: string[] = []
  async createSession(engineId: string): Promise<{ sessionId: string; engineId: string }> {
    this.count += 1
    return { engineId, sessionId: `worker-${this.count}` }
  }
  async run(_prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    return { sessionId: options?.sessionId ?? 'worker' }
  }
  async stopSession(sessionId: string): Promise<void> { this.stopped.push(sessionId) }
}

async function organizationFixture(testCommand?: string) {
  const root = await gitWorkspace()
  const store = new OrganizationStore(join(root, '.organization-test.json'))
  let state = await store.mutate({ type: 'company.create', name: 'Beta Co', mission: 'Ship safely' })
  const company = state.companies[0]!
  state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Beta App', objective: 'Pass QA', workspacePath: root, ...(testCommand ? { testCommand } : {}) })
  const project = state.projects[0]!
  await store.applyPlan(project.id, {
    goal: { title: 'Beta', description: 'Reach beta' },
    milestones: [{ title: 'Build', description: 'Build safely', tasks: [{ title: 'Feature', description: 'Implement feature' }] }],
  })
  const task = (await store.state()).tasks[0]!
  const engineRuns = new FakeEngineRuns()
  const engines = {
    assignedEngine: async () => ND_HARNESS_ENGINE_ID,
    assertAvailable: () => ({ id: ND_HARNESS_ENGINE_ID, name: 'ND Harness' }),
  }
  const orchestrator = new OrganizationOrchestrator(
    store,
    new FakeHarness() as never,
    new FakeWorkspace(root) as never,
    engines as never,
    engineRuns as never,
  )
  return { root, store, project, task, engineRuns, orchestrator }
}

describe('beta execution reliability', () => {
  it('classifies transient provider failures without retrying auth or deterministic failures', () => {
    expect(isRetryableExecutionFailure('Provider returned 502 Bad Gateway')).toBe(true)
    expect(isRetryableExecutionFailure('gateway-unreachable: ECONNRESET')).toBe(true)
    expect(isRetryableExecutionFailure('401 unauthorized invalid api key')).toBe(false)
    expect(isRetryableExecutionFailure('Machine verification failed: tests red')).toBe(false)
    expect(isRetryableExecutionFailure('Project workspace has uncommitted human changes')).toBe(false)
  })

  it('records passing and failing machine verification evidence', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'nd-dsh-beta-verify-'))
    const pass = await runVerification(`"${process.execPath}" -e "process.exit(0)"`, cwd)
    const fail = await runVerification(`"${process.execPath}" -e "process.exit(3)"`, cwd)

    expect(pass.status).toBe('passed')
    expect(pass.exitCode).toBe(0)
    expect(fail.status).toBe('failed')
    expect(fail.exitCode).toBe(3)
  })

  it('rolls an ND-owned task worktree back to the exact attempt baseline', async () => {
    const root = await gitWorkspace()
    const manager = new TaskWorktreeManager()
    const worktree = await manager.ensure(root, 'rollback-task')
    expect(worktree).toBeDefined()
    const baseline = await manager.baseline(worktree!)
    const partial = join(worktree!.root, 'partial.txt')
    await writeFile(partial, 'provider died mid-write\n')

    await manager.rollback(worktree!, baseline)

    await expect(access(partial)).rejects.toThrow()
    expect(await manager.baseline(worktree!)).toBe(baseline)
  })

  it('stops and rolls back a stalled execution without waiting for its lease', async () => {
    const { root, store, task, engineRuns, orchestrator } = await organizationFixture()
    const run = await orchestrator.runTask(task.id)
    const manager = new TaskWorktreeManager()
    const worktree = await manager.existing(root, task.id)
    expect(worktree).toBeDefined()
    const partial = join(worktree!.root, 'half-written.txt')
    await writeFile(partial, 'partial\n')

    const recovered = await orchestrator.reconcileStalledRuns(Date.now() + 11 * 60 * 1_000)

    expect(recovered).toBe(1)
    expect(engineRuns.stopped).toEqual([run.sessionId])
    await expect(access(partial)).rejects.toThrow()
    const state = await store.state()
    expect(state.runs.find((item) => item.id === run.runId)?.status).toBe('failed')
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe('blocked')
  })

  it('hard-blocks completion when the configured machine verification command fails', async () => {
    const failCommand = `"${process.execPath}" -e "process.exit(7)"`
    const { store, task, orchestrator } = await organizationFixture(failCommand)
    const run = await orchestrator.runTask(task.id)

    await orchestrator.handleHarnessEvent({ kind: 'session-status', sessionId: run.sessionId, running: false })

    const state = await store.state()
    const storedRun = state.runs.find((item) => item.id === run.runId)
    expect(storedRun?.status).toBe('failed')
    expect(storedRun?.error).toMatch(/machine verification failed/i)
    expect(storedRun?.output).toContain('<nd-dsh-verification>')
    expect(state.tasks.find((item) => item.id === task.id)?.status).toBe('blocked')
  })
})
