import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { withPortableBuildStaging } from '../scripts/portable-build-staging.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-portable-build-'))
  roots.push(root)
  const source = join(root, 'dist', 'win-unpacked')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'ND-DSH.exe'), 'owned payload')
  return { root, source }
}
it('restores the original payload after a compiler failure', async () => {
  const { root, source } = await fixture()
  await expect(withPortableBuildStaging(root, async (staged) => {
    expect(await readFile(join(staged, 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
    await expect(readFile(join(source, 'ND-DSH.exe'))).rejects.toThrow()
    throw new Error('compiler failed')
  })).rejects.toThrow('compiler failed')
  expect(await readFile(join(source, 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
})
it('preserves a pre-existing staging directory and the unpacked app', async () => {
  const { root, source } = await fixture()
  await mkdir(join(root, '.release', 'app'), { recursive: true })
  await writeFile(join(root, '.release', 'app', 'keep.txt'), 'existing work')
  await expect(withPortableBuildStaging(root, async () => { throw new Error('must not run') })).rejects.toThrow('already exists')
  expect(await readFile(join(root, '.release', 'app', 'keep.txt'), 'utf8')).toBe('existing work')
  expect(await readFile(join(source, 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
})
it('keeps both payloads if another build appears during compilation', async () => {
  const { root, source } = await fixture()
  await expect(withPortableBuildStaging(root, async () => {
    await mkdir(source)
    await writeFile(join(source, 'new.exe'), 'new payload')
  })).rejects.toThrow('Refusing to replace')
  expect(await readFile(join(source, 'new.exe'), 'utf8')).toBe('new payload')
  expect(await readFile(join(root, '.release', 'app', 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
})
it('restores the build layout and returns the compiler result after success', async () => {
  const { root, source } = await fixture()
  expect(await withPortableBuildStaging(root, async () => 'built')).toBe('built')
  expect(await readFile(join(source, 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
})
it('refuses a redirected source before moving or compiling it', async () => {
  const { root, source } = await fixture()
  const redirected = join(root, 'redirected')
  await rename(source, redirected)
  await symlink(redirected, source, 'junction')
  await expect(withPortableBuildStaging(root, async () => { throw new Error('must not run') })).rejects.toThrow('inside the workspace')
  expect(await readFile(join(redirected, 'ND-DSH.exe'), 'utf8')).toBe('owned payload')
})
