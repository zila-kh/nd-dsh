import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserHistoryStore } from '../src/main/browser/browser-history-store.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('BrowserHistoryStore', () => {
  it('persists bounded navigation metadata and clears by origin', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-browser-history-'))
    roots.push(root)
    const path = join(root, 'history.json')
    const store = new BrowserHistoryStore(path)
    await store.record({ targetId: 'builtin', tabId: 'a', url: 'https://example.com/a', title: 'A', visitedAt: 1 })
    await store.record({ targetId: 'builtin', tabId: 'b', url: 'https://other.test/b', title: 'B', visitedAt: 2 })

    const reopened = new BrowserHistoryStore(path)
    expect((await reopened.list('builtin')).map((entry) => entry.title)).toEqual(['B', 'A'])
    expect(await reopened.clear({ targetId: 'builtin', origin: 'https://example.com' })).toBe(1)
    expect((await reopened.list('builtin')).map((entry) => entry.title)).toEqual(['B'])
  })
})
