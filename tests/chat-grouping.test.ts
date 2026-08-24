import { describe, expect, it } from 'vitest'
import { groupEntries } from '../src/shared/chat-grouping.js'
import type { ThreadEntry } from '../src/shared/chat-types.js'

describe('groupEntries', () => {
  it('returns empty array when thread is empty', () => {
    expect(groupEntries([])).toEqual([])
  })

  it('preserves user and assistant messages as individual entries', () => {
    const entries: ThreadEntry[] = [
      { kind: 'user', id: 'u1', text: 'Hello' },
      { kind: 'assistant', id: 'a1', text: 'Hi there!' },
    ]
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toEqual({ kind: 'entry', key: 'u1', entry: entries[0] })
    expect(groups[1]).toEqual({ kind: 'entry', key: 'a1', entry: entries[1] })
  })

  it('groups consecutive file write tools into a single "Edited N files" group', () => {
    const entries: ThreadEntry[] = [
      { kind: 'tool', id: 't1', name: 'fs_write', args: { path: 'src/a.ts' }, status: 'done' },
      { kind: 'tool', id: 't2', name: 'fs_edit', args: { path: 'src/b.ts' }, status: 'done' },
    ]
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({
      kind: 'tool-group',
      key: 't1',
      tools: entries,
      label: 'Edited 2 files',
      icon: 'file',
    })
  })

  it('groups consecutive read tools into a single "Read N files" group', () => {
    const entries: ThreadEntry[] = [
      { kind: 'tool', id: 't1', name: 'fs_read', args: { path: 'src/a.ts' }, status: 'done' },
      { kind: 'tool', id: 't2', name: 'read_file', args: { path: 'src/b.ts' }, status: 'done' },
      { kind: 'tool', id: 't3', name: 'fs_cat', args: { path: 'src/c.ts' }, status: 'done' },
    ]
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({
      kind: 'tool-group',
      key: 't1',
      tools: entries,
      label: 'Read 3 files',
      icon: 'read',
    })
  })

  it('groups consecutive skill tools into a single "Loaded N skills" group', () => {
    const entries: ThreadEntry[] = [
      { kind: 'tool', id: 't1', name: 'skill_load', args: { name: 'git' }, status: 'done' },
    ]
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({
      kind: 'tool-group',
      key: 't1',
      tools: entries,
      label: 'Loaded 1 skill',
      icon: 'skill',
    })
  })

  it('sub-groups mixed tool sequences by category', () => {
    const entries: ThreadEntry[] = [
      { kind: 'user', id: 'u1', text: 'Fix the bug' },
      { kind: 'tool', id: 't1', name: 'fs_read', args: { path: 'src/main.ts' }, status: 'done' },
      { kind: 'tool', id: 't2', name: 'fs_write', args: { path: 'src/main.ts' }, status: 'done' },
      { kind: 'tool', id: 't3', name: 'skill_run', args: { name: 'test' }, status: 'done' },
      { kind: 'assistant', id: 'a1', text: 'Fixed the issue.' },
    ]
    const groups = groupEntries(entries)
    expect(groups).toHaveLength(5)
    expect(groups[0]).toEqual({ kind: 'entry', key: 'u1', entry: entries[0] })
    expect(groups[1]).toEqual({
      kind: 'tool-group',
      key: 't1',
      tools: [entries[1]],
      label: 'Read 1 file',
      icon: 'read',
    })
    expect(groups[2]).toEqual({
      kind: 'tool-group',
      key: 't2',
      tools: [entries[2]],
      label: 'Edited 1 file',
      icon: 'file',
    })
    expect(groups[3]).toEqual({
      kind: 'tool-group',
      key: 't3',
      tools: [entries[3]],
      label: 'Loaded 1 skill',
      icon: 'skill',
    })
    expect(groups[4]).toEqual({ kind: 'entry', key: 'a1', entry: entries[4] })
  })
})
