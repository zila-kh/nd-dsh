import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { releaseArtifact } from '../scripts/release-artifact.mjs'

const roots = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-release-artifact-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.1' }))
  await mkdir(join(root, 'dist'))
  return root
}

it('selects the current version even when an old artifact is present', async () => {
  const root = await fixture()
  await writeFile(join(root, 'dist', 'ND-DSH-0.1.0-private-beta-x64.exe'), 'old dummy package')
  const executable = join(root, 'dist', 'ND-DSH-0.1.1-private-beta-x64.exe')
  await writeFile(executable, 'current dummy package')
  expect(releaseArtifact(root).executable).toBe(executable)
})

it('rejects an absent or ambiguous current artifact instead of selecting an old one', async () => {
  const root = await fixture()
  await writeFile(join(root, 'dist', 'ND-DSH-0.1.0-private-beta-x64.exe'), 'old dummy package')
  expect(() => releaseArtifact(root)).toThrow(/found 0/)
  await writeFile(join(root, 'dist', 'ND-DSH-0.1.1-private-beta-x64.exe'), 'dummy package')
  await writeFile(join(root, 'dist', 'ND-DSH-0.1.1-private-beta-arm64.exe'), 'dummy package')
  expect(() => releaseArtifact(root)).toThrow(/found 2/)
})

it('honors an explicit artifact and fails on a bad override', async () => {
  const root = await fixture()
  const executable = join(root, 'custom.exe')
  await writeFile(executable, 'explicit dummy package')
  expect(releaseArtifact(root, executable).kind).toBe('packaged')
  expect(() => releaseArtifact(root, join(root, 'missing.exe'))).toThrow()
})
