import { describe, expect, it } from 'vitest'
import type { SuggestionDirent } from '../src/main/workspace/suggest.js'
import { collectSuggestionIndex, rankFileSuggestions } from '../src/main/workspace/suggest.js'

function dirent(name: string, kind: 'file' | 'directory'): SuggestionDirent {
  return {
    name,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => false,
  }
}

describe('collectSuggestionIndex', () => {
  it('walks the tree breadth-first with workspace-relative paths', async () => {
    const tree: Record<string, SuggestionDirent[]> = {
      '': [dirent('src', 'directory'), dirent('package.json', 'file')],
      src: [dirent('main.ts', 'file'), dirent('ui', 'directory')],
      'src/ui': [dirent('panel.tsx', 'file')],
    }
    const entries = await collectSuggestionIndex(async (dir) => tree[dir] ?? [])
    expect(entries).toEqual([
      { relativePath: 'src', kind: 'directory' },
      { relativePath: 'package.json', kind: 'file' },
      { relativePath: 'src/main.ts', kind: 'file' },
      { relativePath: 'src/ui', kind: 'directory' },
      { relativePath: 'src/ui/panel.tsx', kind: 'file' },
    ])
  })

  it('skips generated and dependency directories', async () => {
    const entries = await collectSuggestionIndex(async (dir) => {
      if (dir === 'node_modules') throw new Error('must not be walked')
      return dir === '' ? [dirent('node_modules', 'directory'), dirent('index.ts', 'file')] : []
    })
    expect(entries).toEqual([{ relativePath: 'index.ts', kind: 'file' }])
  })

  it('stops at the entry limit', async () => {
    const entries = await collectSuggestionIndex(async () => [
      dirent('a.ts', 'file'),
      dirent('b.ts', 'file'),
      dirent('c.ts', 'file'),
      dirent('d.ts', 'file'),
      dirent('e.ts', 'file'),
    ], 3)
    expect(entries).toHaveLength(3)
  })

  it('survives unreadable directories', async () => {
    const entries = await collectSuggestionIndex(async (dir) => {
      if (dir === 'locked') throw new Error('EACCES')
      return dir === '' ? [dirent('locked', 'directory'), dirent('ok.ts', 'file')] : []
    })
    expect(entries).toEqual([
      { relativePath: 'locked', kind: 'directory' },
      { relativePath: 'ok.ts', kind: 'file' },
    ])
  })
})

describe('rankFileSuggestions', () => {
  const entries = [
    { relativePath: 'src/main/chat-panel.tsx', kind: 'file' as const },
    { relativePath: 'chat.md', kind: 'file' as const },
    { relativePath: 'docs/chat.md', kind: 'file' as const },
    { relativePath: 'chat', kind: 'directory' as const },
    { relativePath: 'unrelated.ts', kind: 'file' as const },
  ]

  it('keeps basename matches ahead of deep path matches, ties alphabetical', () => {
    expect(rankFileSuggestions(entries, 'chat').map((item) => item.relativePath)).toEqual([
      'chat',
      'chat.md',
      'docs/chat.md',
      'src/main/chat-panel.tsx',
    ])
  })

  it('matches paths case-insensitively', () => {
    expect(rankFileSuggestions(entries, 'CHAT.MD').map((item) => item.relativePath)).toEqual(['chat.md', 'docs/chat.md'])
  })

  it('returns alphabetical entries for an empty query', () => {
    expect(rankFileSuggestions(entries, '').map((item) => item.relativePath)).toEqual([
      'chat',
      'chat.md',
      'docs/chat.md',
      'src/main/chat-panel.tsx',
      'unrelated.ts',
    ])
  })

  it('drops non-matching entries', () => {
    expect(rankFileSuggestions(entries, 'zzz')).toEqual([])
  })

  it('honors the result limit', () => {
    expect(rankFileSuggestions(entries, 'chat', 1)).toHaveLength(1)
  })
})
