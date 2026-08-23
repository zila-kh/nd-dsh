import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionArchiveStore } from '../src/main/sessions/session-archive-store.js'

describe('SessionArchiveStore', () => {
  it('persists archived session ids across reloads and drops them on unarchive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const path = join(dir, 'session-archive.json')
    const store = new SessionArchiveStore(path)

    expect(await store.archivedIds()).toEqual(new Set())

    const first = await store.setArchived('sess-a', true)
    expect(first).toContain('sess-a')
    expect((await store.setArchived('sess-b', true))).toContain('sess-b')

    const reloaded = new SessionArchiveStore(path)
    expect(await reloaded.archivedIds()).toEqual(new Set(['sess-a', 'sess-b']))

    await reloaded.setArchived('sess-a', false)
    expect(await reloaded.archivedIds()).toEqual(new Set(['sess-b']))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, archived: { 'sess-b': expect.any(Number) } })
  })

  it('falls back to an empty archive when the file is missing or unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const corrupt = join(dir, 'corrupt.json')
    await writeFile(corrupt, '{not json', 'utf8')
    const wrongSchema = join(dir, 'schema.json')
    await writeFile(wrongSchema, JSON.stringify({ version: 2, archived: {} }), 'utf8')
    const junkEntries = join(dir, 'junk.json')
    await writeFile(junkEntries, JSON.stringify({ version: 1, archived: { ' ': 1, 'keep': Date.now(), drop: 'nope' } }), 'utf8')

    expect(await new SessionArchiveStore(join(dir, 'missing.json')).archivedIds()).toEqual(new Set())
    expect(await new SessionArchiveStore(corrupt).archivedIds()).toEqual(new Set())
    expect(await new SessionArchiveStore(wrongSchema).archivedIds()).toEqual(new Set())
    expect(await new SessionArchiveStore(junkEntries).archivedIds()).toEqual(new Set(['keep']))
  })

  it('rejects empty or oversized session ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const store = new SessionArchiveStore(join(dir, 'session-archive.json'))
    await expect(store.setArchived('   ', true)).rejects.toThrow(/Session id/)
    await expect(store.setArchived('x'.repeat(257), true)).rejects.toThrow(/Session id/)
  })
})
