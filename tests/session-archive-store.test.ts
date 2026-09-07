import { foldHistory } from '../src/shared/chat-events.js'
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

  it('archives and unarchives a batch in one store operation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const path = join(dir, 'session-archive.json')
    const store = new SessionArchiveStore(path)

    expect(await store.setArchivedMany(['sess-a', 'sess-b', 'sess-a'], true)).toEqual(expect.arrayContaining(['sess-a', 'sess-b']))
    expect(await new SessionArchiveStore(path).archivedIds()).toEqual(new Set(['sess-a', 'sess-b']))
    expect(await store.setArchivedMany(['sess-a', 'sess-a'], false)).toEqual(['sess-b'])
    expect(await store.setArchivedMany([], true)).toEqual(['sess-b'])
  })

  it('validates every batch id before changing or persisting state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const path = join(dir, 'session-archive.json')
    const store = new SessionArchiveStore(path)
    await expect(store.setArchivedMany(['good', '   '], true)).rejects.toThrow(/Session id/)
    expect(await store.archivedIds()).toEqual(new Set())
    await expect(store.setArchivedMany(['x'.repeat(257)], true)).rejects.toThrow(/Session id/)
    expect(await store.archivedIds()).toEqual(new Set())
  })

  it('rejects empty or oversized session ids', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-sessions-'))
    const store = new SessionArchiveStore(join(dir, 'session-archive.json'))
    await expect(store.setArchived('   ', true)).rejects.toThrow(/Session id/)
    await expect(store.setArchived('x'.repeat(257), true)).rejects.toThrow(/Session id/)
  })
})


it('restores exact skill echoes and metadata across archive reload without rewriting legacy text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nd-skill-messages-'))
  const path = join(dir, 'archive.json')
  const store = new SessionArchiveStore(path)
  const skill = { name: 'nd:review', displayName: 'Review', description: 'Review code', source: 'ND project', selectionId: 'a'.repeat(64) }
  const original = `/nd:review  preserve spacing
next line`
  const wire = `ND explicit skill /nd:review
private instructions`
  await store.rememberSkillMessage('s', wire, original, skill)
  const events = [{ type: 'user/message', seq: 1, data: { message: { content: [{ type: 'text', text: wire }] } } }]
  const restored = await store.restoreSkillMessages('s', events)
  expect(foldHistory(restored)[0]).toMatchObject({ kind: 'user', text: original, skillMention: skill })
  expect(await store.restoreSkillMessages('foreign', events)).toEqual(events)
  await store.setArchived('s', true)
  const reload = new SessionArchiveStore(path)
  expect(await reload.restoreSkillMessages('s', events)).toEqual(restored)
  await reload.setArchived('s', false)
  expect(await new SessionArchiveStore(path).restoreSkillMessages('s', events)).toEqual(restored)
  const legacy = [{ type: 'user/message', seq: 2, data: { message: wire + ' unknown historical envelope' } }]
  expect(await reload.restoreSkillMessages('s', legacy)).toEqual(legacy)
  expect(events[0]!.data.message.content[0]!.text).toBe(wire)
})
