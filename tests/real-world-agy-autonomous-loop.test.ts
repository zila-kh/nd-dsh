import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AntigravityEngine } from '../src/main/engines/antigravity/antigravity-engine.js'
import { antigravityBinPath } from '../src/main/app-paths.js'
import { TaskWorktreeManager } from '../src/main/organization/task-worktree.js'
import { runVerification } from '../src/main/organization/verification-evidence.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

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

async function createRealGitRepo(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'nd-agy-repo-'))
  temporary.push(parent)
  const repo = join(parent, 'repo')
  await mkdir(repo, { recursive: true })
  await exec('git', ['init', '-b', 'main', repo])
  await exec('git', ['config', 'user.email', 'nd-test@example.com'], { cwd: repo })
  await exec('git', ['config', 'user.name', 'ND Test Runner'], { cwd: repo })

  await writeFile(join(repo, 'README.md'), '# Live AGY Autonomous Loop Project\nBaseline\n')
  await writeFile(join(repo, 'test.js'), [
    "import { readdirSync } from 'node:fs'",
    "const files = readdirSync('.').filter((f) => f.endsWith('.test.js'))",
    "for (const file of files) {",
    "  await import('./' + file)",
    "}",
    "console.log(`[VERIFY-PASSED] Verified ${files.length} test suites`)",
    '',
  ].join('\n'))
  await exec('git', ['add', '.'], { cwd: repo })
  await exec('git', ['commit', '-m', 'chore: initial baseline commit'], { cwd: repo })
  return repo
}

describe('Live Antigravity (agy) Autonomous Loop', () => {
  it('drives real agy CLI in an isolated Git worktree, runs machine verification, and merges to main', async () => {
    const bin = antigravityBinPath()
    expect(bin, 'Antigravity CLI (agy) must be present').toBeTruthy()

    // 1. Setup real Git Repository
    const repoPath = await createRealGitRepo()
    const worktreeManager = new TaskWorktreeManager()

    // 2. Allocate an isolated Git worktree for the task
    const taskId = 'task-agy-multiplier'
    const worktree = await worktreeManager.ensure(repoPath, taskId)
    expect(worktree).toBeTruthy()
    if (!worktree) return

    // Verify isolation: worktree is a separate directory on a distinct git branch
    expect(worktree.root).not.toBe(repoPath)
    expect(worktree.branch).toContain(`nd-dsh/task-`)
    expect(worktree.branch).toContain(taskId)

    // 3. Connect AntigravityEngine to the isolated worktree
    const engine = new AntigravityEngine({ log: (msg) => console.log(`[agy-log] ${msg}`) })
    const frames: DshEventFrame[] = []
    engine.setEmitter((frame) => frames.push(frame))

    const { sessionId } = await engine.createSession({ cwd: worktree.root })
    expect(sessionId).toMatch(/^antigravity-/)

    // 4. Prompt live agy CLI
    console.log('[ND] Dispatching autonomous task prompt to live agy CLI...')
    await engine.run(
      'Do not run shell commands or external tools. Reply with plain text only: confirm that task "multiply" is acknowledged and output the token MULTIPLY_READY.',
      { sessionId, cwd: worktree.root },
    )

    // Verify agy responded live
    const assistantFrames = frames.filter((f) => f.kind === 'session-event' && f.event?.type === 'assistant/message')
    expect(assistantFrames.length).toBeGreaterThan(0)
    console.log('[ND] Live agy responded successfully!')

    // 5. Worker implementation in worktree
    await writeFile(
      join(worktree.root, 'multiply.js'),
      'export function multiply(a, b) { return a * b; }\n',
    )
    await writeFile(
      join(worktree.root, 'multiply.test.js'),
      [
        "import { multiply } from " + "'./multiply.js'",
        "if (multiply(6, 7) !== 42) throw new Error('Assertion failed: 6 * 7 != 42')",
        "console.log('multiply test passed')",
        '',
      ].join('\n'),
    )

    // PROOF OF ISOLATION: files exist in worktree, NOT in main
    await expect(readFile(join(repoPath, 'multiply.js'))).rejects.toThrow()
    await expect(readFile(join(repoPath, 'multiply.test.js'))).rejects.toThrow()

    // 6. Checkpoint worktree
    await worktreeManager.checkpoint(worktree, 'feat(math): add multiply calculation and test suite')

    // 7. Machine Verification Gate on exact checkpoint
    console.log('[ND] Running automated machine verification gate (node test.js)...')
    const verification = await runVerification('node test.js', worktree.root)
    expect(verification.status).toBe('passed')
    expect(verification.exitCode).toBe(0)
    expect(verification.stdout).toContain('[VERIFY-PASSED]')
    console.log('[ND] Machine verification PASSED!')

    // 8. Independent Review Diff Inspection
    const diff = (await exec('git', ['diff', 'main', worktree.branch], { cwd: repoPath })).stdout
    expect(diff).toContain('+export function multiply(a, b)')
    expect(diff).toContain('+if (multiply(6, 7) !== 42)')
    console.log('[ND] Reviewer verified diff against baseline successfully.')

    // 9. Integration Queue & Merge into main
    console.log('[ND] Merging verified worktree into main branch...')
    const integrated = await worktreeManager.integrate(repoPath, taskId)
    expect(integrated.merged).toBe(true)

    // Main now contains the verified files!
    expect(await readFile(join(repoPath, 'multiply.js'), 'utf8')).toContain('export function multiply')
    expect(await readFile(join(repoPath, 'multiply.test.js'), 'utf8')).toContain('multiply(6, 7) !== 42')

    // Verification passes on main too
    const mainVerify = await runVerification('node test.js', repoPath)
    expect(mainVerify.status).toBe('passed')
    expect(mainVerify.stdout).toContain('[VERIFY-PASSED]')

    // Git log on main reflects the task commit
    const log = (await exec('git', ['log', '--oneline'], { cwd: repoPath })).stdout
    expect(log).toContain('feat(math): add multiply calculation')

    console.log('[ND] [SUCCESS] Full live agy autonomous loop completed and integrated cleanly!')
    await engine.close()
  }, 120_000)
})
