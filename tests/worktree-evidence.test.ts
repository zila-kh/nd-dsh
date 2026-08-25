import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { captureWorkspaceEvidence } from '../src/main/organization/worktree-evidence.js'

const run = promisify(execFile)
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('worktree evidence', () => {
  it('changes the receipt fingerprint for tracked edits and untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-evidence-'))
    temporary.push(root)
    await run('git', ['init'], { cwd: root })
    await run('git', ['config', 'user.email', 'nd@example.test'], { cwd: root })
    await run('git', ['config', 'user.name', 'ND Test'], { cwd: root })
    await writeFile(join(root, 'app.ts'), 'export const value = 1\n')
    await run('git', ['add', 'app.ts'], { cwd: root })
    await run('git', ['commit', '-m', 'initial'], { cwd: root })

    await writeFile(join(root, 'app.ts'), 'export const value = 2\n')
    const first = await captureWorkspaceEvidence(root)
    expect(first.exact).toBe(true)
    expect(first.changedFiles).toEqual(['app.ts'])

    await writeFile(join(root, 'new.ts'), 'export const added = true\n')
    const second = await captureWorkspaceEvidence(root)
    expect(second.exact).toBe(true)
    expect(second.changedFiles).toEqual(['app.ts', 'new.ts'])
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('fails closed when an exact Git worktree cannot be observed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-evidence-no-git-'))
    temporary.push(root)
    const capture = await captureWorkspaceEvidence(root)
    expect(capture.exact).toBe(false)
    expect(capture.source).toBe('workspace-unavailable')
  })
})
