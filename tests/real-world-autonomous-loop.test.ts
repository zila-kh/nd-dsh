import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationOrchestrator } from '../src/main/organization/orchestrator.js'
import { OrganizationStore } from '../src/main/organization/store.js'
import { TaskWorktreeManager } from '../src/main/organization/task-worktree.js'
import { runVerification } from '../src/main/organization/verification-evidence.js'

const exec = promisify(execFile)
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100,
  })))
})

class TestHarness {
  prompts: Array<{ prompt: string; sessionId?: string }> = []
  private counter = 0
  async createSession(): Promise<string> {
    this.counter += 1
    return `session-${this.counter}`
  }
  async run(prompt: string, options?: { sessionId?: string }): Promise<{ sessionId: string }> {
    this.prompts.push({ prompt, ...(options?.sessionId ? { sessionId: options.sessionId } : {}) })
    return { sessionId: options?.sessionId ?? 'session' }
  }
  async close(): Promise<void> {}
  status(): { provider: string; model: string } {
    return { provider: 'test-provider', model: 'test-model' }
  }
  cancel(): void {}
  consumeCanceledSession(): boolean { return false }
}

class TestWorkspace {
  constructor(private rootPath: string) {}
  state(): { root: string } { return { root: this.rootPath } }
  async setRoot(path: string): Promise<{ root: string; name: string }> {
    this.rootPath = path
    return { root: path, name: path.split('/').at(-1) ?? path }
  }
}

async function createRealGitRepo(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'nd-real-repo-'))
  temporary.push(parent)
  const repo = join(parent, 'repo')
  await mkdir(repo, { recursive: true })
  await exec('git', ['init', '-b', 'main', repo])
  await exec('git', ['config', 'user.email', 'nd-test@example.com'], { cwd: repo })
  await exec('git', ['config', 'user.name', 'ND Test Runner'], { cwd: repo })
  
  // Seed baseline repo with an initial file and dynamic test runner
  await writeFile(join(repo, 'README.md'), '# Autonomous Project\nBaseline\n')
  await writeFile(join(repo, 'test.js'), [
    "import { readdirSync } from 'node:fs'",
    "const files = readdirSync('.').filter((f) => f.endsWith('.test.js'))",
    "for (const file of files) {",
    "  await import('./' + file)",
    "}",
    "console.log(`All tests passed (${files.length} test files)`)",
    '',
  ].join('\n'))
  await exec('git', ['add', '.'], { cwd: repo })
  await exec('git', ['commit', '-m', 'chore: initial project baseline with dynamic test runner'], { cwd: repo })
  return repo
}

function assistant(sessionId: string, text: string) {
  return {
    kind: 'session-event',
    sessionId,
    event: {
      type: 'assistant/message',
      seq: 1,
      time: Date.now(),
      data: { message: { content: [{ type: 'text', text }] } },
    },
  } as const
}

function stopped(sessionId: string) {
  return { kind: 'session-status', sessionId, running: false } as const
}

function planXml(tasks: Array<{ title: string; description: string; role?: string }>): string {
  return `<nd-dsh-plan>${JSON.stringify({
    goal: { title: 'Delivery Goal', description: 'Deliver components' },
    milestones: [{
      title: 'Milestone 1',
      description: 'Implement components',
      tasks: tasks.map((t) => ({ ...t, acceptanceCriteria: ['Tests pass'] })),
    }],
  })}</nd-dsh-plan>`
}

function reviewXml(verdict: 'pass' | 'fail', summary: string, issues: string[] = []): string {
  return `<nd-dsh-review>${JSON.stringify({
    verdict,
    summary,
    issues,
    memory: [{ title: `Review ${verdict}`, content: summary, tags: ['review'] }],
  })}</nd-dsh-review>`
}

describe('Real-World Autonomous Loop Verification', () => {
  it('executes planning, parallel worktrees, machine verification gate, review, and integration on real git state', async () => {
    // 0. Setup Real Git Repo and ND Organization Store
    const repoPath = await createRealGitRepo()
    const tempStoreDir = await mkdtemp(join(tmpdir(), 'nd-store-'))
    temporary.push(tempStoreDir)
    
    const store = new OrganizationStore(join(tempStoreDir, 'organization.json'))
    const harness = new TestHarness()
    const workspace = new TestWorkspace(repoPath)
    const worktreeManager = new TaskWorktreeManager()
    const orchestrator = new OrganizationOrchestrator(store, harness as never, workspace as never, undefined, undefined, undefined, undefined, undefined, worktreeManager)

    // Create Company with Autopilot (level 4) and Project
    let state = await store.mutate({ type: 'company.create', name: 'Acme Robotics', mission: 'Build automated tools' })
    const company = state.companies[0]!
    await store.mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel: 4 } })
    
    state = await store.mutate({
      type: 'project.create',
      companyId: company.id,
      name: 'Dashboard Service',
      objective: 'Add greeting component and math service',
      workspacePath: repoPath,
    })
    const project = state.projects[0]!
    await store.mutate({
      type: 'project.update',
      id: project.id,
      patch: { testCommand: 'node test.js' },
    })

    // ─────────────────────────────────────────────────────────────
    // STAGE 1: AI PM Planning
    // ─────────────────────────────────────────────────────────────
    const planReceipt = await orchestrator.planProject(project.id)
    expect(planReceipt.sessionId).toBe('session-1')

    // AI PM emits plan with 2 independent tasks
    const pmPlanText = planXml([
      { title: 'Add Greeting UI Component', description: 'Create greeting module', role: 'Frontend Engineer' },
      { title: 'Add Math Calculation Service', description: 'Create math module', role: 'Backend Engineer' },
    ])
    await orchestrator.handleHarnessEvent(assistant(planReceipt.sessionId, pmPlanText))
    await orchestrator.handleHarnessEvent(stopped(planReceipt.sessionId))

    state = await store.state()
    expect(state.tasks).toHaveLength(2)
    const task1 = state.tasks.find((t) => t.title.includes('Greeting'))!
    const task2 = state.tasks.find((t) => t.title.includes('Math'))!
    expect(task1).toBeDefined()
    expect(task2).toBeDefined()

    // ─────────────────────────────────────────────────────────────
    // STAGE 2: Parallel Worktree Isolation
    // ─────────────────────────────────────────────────────────────
    const worktree1 = await worktreeManager.ensure(repoPath, task1.id)
    const worktree2 = await worktreeManager.ensure(repoPath, task2.id)
    expect(worktree1).toBeTruthy()
    expect(worktree2).toBeTruthy()

    // Assert worktrees are physically distinct directories and on separate git branches
    expect(worktree1!.root).not.toBe(worktree2!.root)
    expect(worktree1!.branch).not.toBe(worktree2!.branch)

    // Worker 1 writes in Worktree 1
    await writeFile(join(worktree1!.root, 'greeting.js'), 'export function greet(name) { return `Hello ${name}`; }\n')

    // Worker 2 writes in Worktree 2
    await writeFile(join(worktree2!.root, 'math.js'), 'export function add(a, b) { return a + b; }\n')

    // PROOF OF ISOLATION:
    // 1. greeting.js does NOT exist in the base repo or in worktree2
    await expect(readFile(join(repoPath, 'greeting.js'))).rejects.toThrow()
    await expect(readFile(join(worktree2!.root, 'greeting.js'))).rejects.toThrow()
    // 2. math.js does NOT exist in the base repo or in worktree1
    await expect(readFile(join(repoPath, 'math.js'))).rejects.toThrow()
    await expect(readFile(join(worktree1!.root, 'math.js'))).rejects.toThrow()

    // ─────────────────────────────────────────────────────────────
    // STAGE 3: Machine Verification Gate (Negative & Positive Proof)
    // ─────────────────────────────────────────────────────────────
    // Negative test: Inject a failing test in Worktree 1, checkpoint it, and run verification
    await writeFile(join(worktree1!.root, 'greeting.test.js'), 'console.error("Test failed deliberately"); process.exit(1);\n')
    await worktreeManager.checkpoint(worktree1!, 'test: deliberately failing test')
    const failingVerification = await runVerification('node test.js', worktree1!.root)
    expect(failingVerification.status).toBe('failed')
    expect(failingVerification.exitCode).toBe(1)
    expect(failingVerification.stderr).toContain('Test failed deliberately')

    // Positive test: Fix test in Worktree 1, checkpoint it, and run verification again
    await writeFile(join(worktree1!.root, 'greeting.test.js'), [
      "import { greet } from " + "'./greeting.js'",
      "if (greet('World') !== 'Hello World') throw new Error('Greeting mismatch')",
      "console.log('Greeting tests OK')",
      '',
    ].join('\n'))
    await worktreeManager.checkpoint(worktree1!, 'feat: greeting component with verified tests')
    const passingVerification1 = await runVerification('node test.js', worktree1!.root)
    expect(passingVerification1.status).toBe('passed')
    expect(passingVerification1.exitCode).toBe(0)
    expect(passingVerification1.stdout).toContain('Greeting tests OK')

    // Verify Worktree 2 as well
    await writeFile(join(worktree2!.root, 'math.test.js'), [
      "import { add } from " + "'./math.js'",
      "if (add(2, 3) !== 5) throw new Error('Math mismatch')",
      "console.log('Math tests OK')",
      '',
    ].join('\n'))
    await worktreeManager.checkpoint(worktree2!, 'feat: math service with verified tests')
    const passingVerification2 = await runVerification('node test.js', worktree2!.root)
    expect(passingVerification2.status).toBe('passed')
    expect(passingVerification2.exitCode).toBe(0)
    expect(passingVerification2.stdout).toContain('Math tests OK')

    // ─────────────────────────────────────────────────────────────
    // STAGE 4: Independent Review Diff Inspection
    // ─────────────────────────────────────────────────────────────
    // Reviewer inspects diff of worktree1 against main baseline
    const diff1 = (await exec('git', ['diff', 'main', worktree1!.branch], { cwd: repoPath })).stdout
    expect(diff1).toContain('+export function greet(name)')

    const diff2 = (await exec('git', ['diff', 'main', worktree2!.branch], { cwd: repoPath })).stdout
    expect(diff2).toContain('+export function add(a, b)')

    // ─────────────────────────────────────────────────────────────
    // STAGE 5: Integration Queue & Merge into Main
    // ─────────────────────────────────────────────────────────────
    const integrated1 = await worktreeManager.integrate(repoPath, task1.id)
    expect(integrated1.merged).toBe(true)

    // Main now contains greeting.js, but not yet math.js
    expect(await readFile(join(repoPath, 'greeting.js'), 'utf8')).toContain('export function greet')
    await expect(readFile(join(repoPath, 'math.js'))).rejects.toThrow()

    // Integrate Task 2
    const integrated2 = await worktreeManager.integrate(repoPath, task2.id)
    expect(integrated2.merged).toBe(true)

    // Main now contains BOTH greeting.js and math.js!
    expect(await readFile(join(repoPath, 'greeting.js'), 'utf8')).toContain('export function greet')
    expect(await readFile(join(repoPath, 'math.js'), 'utf8')).toContain('export function add')

    // Verify Git commit log on main has both commits and merge commits
    const gitLog = (await exec('git', ['log', '--oneline'], { cwd: repoPath })).stdout
    expect(gitLog).toContain('feat: greeting component')
    expect(gitLog).toContain('feat: math service')

    // Clean working tree with no uncommitted artifacts
    const status = (await exec('git', ['status', '--porcelain'], { cwd: repoPath })).stdout.trim()
    expect(status).toBe('')
  }, 30_000)

  it('fails closed and preserves task worktree when concurrent tasks encounter merge conflicts', async () => {
    const repoPath = await createRealGitRepo()
    const worktreeManager = new TaskWorktreeManager()

    const worktreeA = await worktreeManager.ensure(repoPath, 'task-conflict-a')
    const worktreeB = await worktreeManager.ensure(repoPath, 'task-conflict-b')

    // Both workers edit the EXACT same file and line differently
    await writeFile(join(worktreeA!.root, 'shared.txt'), 'Option A\n')
    await worktreeManager.checkpoint(worktreeA!, 'feat: choose Option A')

    await writeFile(join(worktreeB!.root, 'shared.txt'), 'Option B\n')
    await worktreeManager.checkpoint(worktreeB!, 'feat: choose Option B')

    // First task integrates cleanly
    const integratedA = await worktreeManager.integrate(repoPath, 'task-conflict-a')
    expect(integratedA.merged).toBe(true)
    expect(await readFile(join(repoPath, 'shared.txt'), 'utf8')).toBe('Option A\n')

    // Second task encounters a conflict and must FAIL CLOSED
    await expect(worktreeManager.integrate(repoPath, 'task-conflict-b')).rejects.toThrow()

    // The main branch remains uncorrupted (clean git status)
    const status = (await exec('git', ['status', '--porcelain'], { cwd: repoPath })).stdout.trim()
    expect(status).toBe('')
    expect(await readFile(join(repoPath, 'shared.txt'), 'utf8')).toBe('Option A\n')

    // Task worktree B remains intact for rework/rebasing
    expect(await readFile(join(worktreeB!.root, 'shared.txt'), 'utf8')).toBe('Option B\n')
  }, 30_000)
})

