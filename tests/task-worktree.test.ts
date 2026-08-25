import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskWorktreeManager, taskEvidenceWorkspace } from '../src/main/organization/task-worktree.js'

const exec = promisify(execFile)
const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function repoFixture(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'nd-worktree-'))
  temporary.push(parent)
  const repo = join(parent, 'repo')
  await exec('git', ['init', repo])
  await exec('git', ['config', 'user.email', 'nd@example.test'], { cwd: repo })
  await exec('git', ['config', 'user.name', 'ND Test'], { cwd: repo })
  await writeFile(join(repo, 'app.ts'), 'export const value = 1\n')
  await exec('git', ['add', 'app.ts'], { cwd: repo })
  await exec('git', ['commit', '-m', 'initial'], { cwd: repo })
  return repo
}

describe('TaskWorktreeManager', () => {
  it('isolates task edits, checkpoints them, and merges only after integration', async () => {
    const repo = await repoFixture()
    const manager = new TaskWorktreeManager()
    const worktree = await manager.ensure(repo, 'task-1')
    expect(worktree).toBeTruthy()
    if (!worktree) return

    await writeFile(join(worktree.root, 'app.ts'), 'export const value = 2\n')
    expect(await readFile(join(repo, 'app.ts'), 'utf8')).toContain('value = 1')
    await manager.checkpoint(worktree, 'Update app')
    expect(await taskEvidenceWorkspace(repo, 'task-1')).toBe(worktree.root)

    const integrated = await manager.integrate(repo, 'task-1')
    expect(integrated.merged).toBe(true)
    expect(await readFile(join(repo, 'app.ts'), 'utf8')).toContain('value = 2')
    expect((await exec('git', ['status', '--porcelain'], { cwd: repo })).stdout.trim()).toBe('')
  })

  it('bootstraps a truly empty project workspace into Git before first task isolation', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'nd-empty-workspace-'))
    temporary.push(parent)
    const workspace = join(parent, 'project')
    await mkdir(workspace)

    const manager = new TaskWorktreeManager()
    const worktree = await manager.ensure(workspace, 'first-task')
    expect(worktree).toBeTruthy()
    if (!worktree) return

    expect((await exec('git', ['rev-parse', 'HEAD'], { cwd: workspace })).stdout.trim()).toBeTruthy()
    await writeFile(join(worktree.root, 'app.ts'), 'export const ready = true\n')
    await manager.checkpoint(worktree, 'Bootstrap app')
    expect(await taskEvidenceWorkspace(workspace, 'first-task')).toBe(worktree.root)

    await manager.integrate(workspace, 'first-task')
    expect(await readFile(join(workspace, 'app.ts'), 'utf8')).toContain('ready = true')
  })

  it('does not create a new task branch from a dirty human workspace', async () => {
    const repo = await repoFixture()
    const manager = new TaskWorktreeManager()
    await writeFile(join(repo, 'human.txt'), 'unsaved human work\n')
    expect(await manager.ensure(repo, 'task-dirty')).toBeUndefined()
  })

  it('fails closed on integration conflict and keeps the task worktree intact', async () => {
    const repo = await repoFixture()
    const manager = new TaskWorktreeManager()
    const worktree = await manager.ensure(repo, 'task-conflict')
    expect(worktree).toBeTruthy()
    if (!worktree) return

    await writeFile(join(worktree.root, 'app.ts'), 'export const value = "task"\n')
    await manager.checkpoint(worktree, 'Task branch')

    await writeFile(join(repo, 'app.ts'), 'export const value = "human-main"\n')
    await exec('git', ['add', 'app.ts'], { cwd: repo })
    await exec('git', ['commit', '-m', 'main change'], { cwd: repo })

    await expect(manager.integrate(repo, 'task-conflict')).rejects.toThrow(/integration conflict/i)
    expect(await readFile(join(worktree.root, 'app.ts'), 'utf8')).toContain('"task"')
    expect((await exec('git', ['status', '--porcelain'], { cwd: repo })).stdout.trim()).toBe('')
  })
})
