import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CoreClient } from '../src/main/core/core-client.js'
import { createCoreEvidenceCapturer, unavailableEvidenceCapturer, type WorkspaceEvidenceCapturer } from '../src/main/organization/worktree-evidence.js'

const run = promisify(execFile)
const binaryPath = process.env.ND_DSH_CORE_BIN?.trim()
  || join(process.cwd(), 'target', 'debug', process.platform === 'win32' ? 'nd-core.exe' : 'nd-core')
const temporary: string[] = []
let core: CoreClient
let capture: WorkspaceEvidenceCapturer

beforeAll(async () => {
  core = new CoreClient({ binaryPath })
  await core.start()
  capture = createCoreEvidenceCapturer(core)
})
afterAll(async () => {
  await core.close()
})
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function repoFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nd-evidence-'))
  temporary.push(root)
  await run('git', ['init'], { cwd: root })
  await run('git', ['config', 'user.email', 'nd@example.test'], { cwd: root })
  await run('git', ['config', 'user.name', 'ND Test'], { cwd: root })
  await writeFile(join(root, 'app.ts'), 'export const value = 1\n')
  await run('git', ['add', 'app.ts'], { cwd: root })
  await run('git', ['commit', '-m', 'initial'], { cwd: root })
  return root
}

describe('worktree evidence', () => {
  it('changes the receipt fingerprint for tracked edits and untracked files', async () => {
    const root = await repoFixture()
    await writeFile(join(root, 'app.ts'), 'export const value = 2\n')
    const first = await capture(root)
    expect(first.exact).toBe(true)
    expect(first.changedFiles).toEqual(['app.ts'])

    await writeFile(join(root, 'new.ts'), 'export const added = true\n')
    const second = await capture(root)
    expect(second.exact).toBe(true)
    expect(second.changedFiles).toEqual(['app.ts', 'new.ts'])
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  it('keeps the stored fingerprint layout that earlier receipts were recorded with', async () => {
    const root = await repoFixture()
    await writeFile(join(root, 'app.ts'), 'export const value = 3\n')
    await writeFile(join(root, 'b.ts'), 'b\n')
    await writeFile(join(root, 'a.ts'), 'a\n')
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
    const diff = (await run('git', ['diff', '--binary', 'HEAD', '--', '.'], { cwd: root, encoding: 'buffer' })).stdout
    const expected = createHash('sha256')
    expected.update(`nd-dsh-evidence-v1\0${head}\0`)
    expected.update(diff)
    expected.update('\0')
    for (const name of ['a.ts', 'b.ts']) {
      const content = createHash('sha256').update(await readFile(join(root, name))).digest('hex')
      expected.update(`${name}\0${content}\0`)
    }

    const result = await capture(root)
    expect(result.gitHead).toBe(head)
    expect(result.fingerprint).toBe(expected.digest('hex'))
  })

  it('fails closed when an exact Git worktree cannot be observed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-evidence-no-git-'))
    temporary.push(root)
    const result = await capture(root)
    expect(result.exact).toBe(false)
    expect(result.source).toBe('workspace-unavailable')
  })

  it('reports every receipt as inexact when no nd-core is attached', async () => {
    const result = await unavailableEvidenceCapturer('/any/workspace')
    expect(result.exact).toBe(false)
    expect(result.source).toBe('workspace-unavailable')
  })
})
