import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error release script deliberately runs as plain Node
import { missingHarnessDependencies } from '../scripts/harness-release-peers.mjs'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-harness-closure-test-'))
  roots.push(root)
  const output = join(root, 'runtime')
  await manifest(output, { name: '@deepseek-ai/dsh', dependencies: { '@deepseek-ai/plugin': '1' } })
  return { root, output, plugin: join(output, 'node_modules', '@deepseek-ai', 'plugin') }
}
async function manifest(directory: string, value: object) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(value))
}
describe('portable Harness dependency closure', () => {
  it('detects an indirect required runtime peer even when the plugin entry exists', async () => {
    const { output, plugin } = await fixture()
    await manifest(plugin, { name: '@deepseek-ai/plugin', peerDependencies: { '@deepseek-ai/contracts': '1' } })
    await writeFile(join(plugin, 'index.js'), 'export {}')
    expect(await missingHarnessDependencies(output)).toEqual(['@deepseek-ai/contracts'])
  })
  it('does not let a source checkout outside the staged runtime satisfy a peer', async () => {
    const { root, output, plugin } = await fixture()
    await manifest(plugin, { name: '@deepseek-ai/plugin', dependencies: { '@deepseek-ai/contracts': '1' } })
    await manifest(join(root, 'node_modules', '@deepseek-ai', 'contracts'), { name: '@deepseek-ai/contracts' })
    expect(await missingHarnessDependencies(output)).toEqual(['@deepseek-ai/contracts'])
  })
  it('accepts a nested resolved peer and checks that peer’s own dependencies', async () => {
    const { output, plugin } = await fixture()
    await manifest(plugin, { name: '@deepseek-ai/plugin', peerDependencies: { '@deepseek-ai/contracts': '1' } })
    await manifest(join(plugin, 'node_modules', '@deepseek-ai', 'contracts'), { name: '@deepseek-ai/contracts', dependencies: { missing: '1' } })
    expect(await missingHarnessDependencies(output)).toEqual(['missing'])
  })
  it('does not require unused optional peers or misclassify a package self-reference', async () => {
    const { output, plugin } = await fixture()
    await manifest(plugin, { name: '@deepseek-ai/plugin', dependencies: { '@deepseek-ai/plugin': '1' }, peerDependencies: { optional: '1' }, peerDependenciesMeta: { optional: { optional: true } } })
    expect(await missingHarnessDependencies(output)).toEqual([])
  })
})
