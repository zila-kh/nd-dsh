import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
}))

import { BrowserExtensionManager } from '../src/main/browser/browser-extension-manager.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function fakeSession() {
  return {
    extensions: {
      getExtension: () => null,
      removeExtension: () => undefined,
      loadExtension: async () => { throw new Error('not loaded in unit tests') },
    },
  } as unknown as ConstructorParameters<typeof BrowserExtensionManager>[0]
}

async function writeExtension(path: string, name: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'manifest.json'), JSON.stringify({ manifest_version: 3, name, version: '1.0.0' }), 'utf8')
}

describe('BrowserExtensionManager', () => {
  it('keeps distinct ids for disabled extensions that share a long path prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-browser-extension-manager-'))
    dirs.push(root)
    const parent = join(root, 'a-deliberately-long-shared-parent-directory-for-extensions')
    const first = join(parent, 'first')
    const second = join(parent, 'second')
    await writeExtension(first, 'First')
    await writeExtension(second, 'Second')
    const statePath = join(root, 'extensions.json')
    await writeFile(statePath, JSON.stringify({
      version: 1,
      extensions: [
        { path: first, enabled: false, installedAt: 1 },
        { path: second, enabled: false, installedAt: 2 },
      ],
    }), 'utf8')

    const manager = new BrowserExtensionManager(fakeSession(), statePath, () => undefined)
    await manager.initialize()

    const records = manager.list()
    expect(records.map((record) => record.name)).toEqual(['First', 'Second'])
    expect(new Set(records.map((record) => record.id)).size).toBe(2)
  })
})
