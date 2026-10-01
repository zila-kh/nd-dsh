import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm, stat, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoOfficeEngines, removeOfficeEngines } from '../scripts/release-runtime-policy.mjs'

const checkSize = createRequire(import.meta.url)('../scripts/check-release-size.cjs')
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function scratch() { const root = await mkdtemp(join(tmpdir(), 'nd-release-policy-')); roots.push(root); return root }

describe('release payload policy', () => {
  it('removes native Office engines, including nested copies, and preserves runtime JS and other engines', async () => {
    const root = await scratch()
    const scope = join(root, 'node_modules', '@deepseek-ai')
    const native = join(scope, 'libreoffice-kit-win32-x64')
    const nested = join(scope, 'dsh-web-app', 'node_modules', '@deepseek-ai', 'libreoffice-kit-wasm')
    const wrapper = join(scope, 'libreoffice-kit')
    const codex = join(scope, 'dsh-subagent-codex')
    for (const directory of [native, nested, wrapper, codex]) await mkdir(directory, { recursive: true })
    await expect(assertNoOfficeEngines(root)).rejects.toThrow('native Office engines')
    expect(await removeOfficeEngines(root)).toBe(2)
    await assertNoOfficeEngines(root)
    expect((await stat(wrapper)).isDirectory()).toBe(true)
    expect((await stat(codex)).isDirectory()).toBe(true)
  })

  it('accepts a 400 MB download and rejects even one byte over budget', async () => {
    const root = await scratch()
    const path = join(root, 'ND-DSH.exe')
    await writeFile(path, '')
    await truncate(path, 400_000_000)
    expect(checkSize({ artifactPaths: [path] })).toEqual([])
    await truncate(path, 400_000_001)
    expect(() => checkSize({ artifactPaths: [path] })).toThrow('limit is 400 MB')
  })
})
