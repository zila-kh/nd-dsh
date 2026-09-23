import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserConnectionStore } from '../src/main/browser-companion/browser-connection-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('BrowserConnectionStore', () => {
  it('persists stable installation identity without credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-browser-store-'))
    roots.push(root)
    const path = join(root, 'connections.json')
    const store = new BrowserConnectionStore(path)
    const first = await store.upsertConnected({
      installationId: 'installation-a',
      browser: 'chrome',
      profileLabel: 'Company A',
      extensionVersion: '0.1.0',
    })
    await store.markDisconnected(first.id)

    const reopened = new BrowserConnectionStore(path)
    const second = await reopened.upsertConnected({
      installationId: 'installation-a',
      browser: 'chrome',
      profileLabel: 'Company A',
      extensionVersion: '0.1.0',
    })
    expect(second.id).toBe(first.id)
    expect(second.connected).toBe(true)

    const raw = await readFile(path, 'utf8')
    expect(raw).not.toMatch(/token|cookie|password/i)
  })
})
