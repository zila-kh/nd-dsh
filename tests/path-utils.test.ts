import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWithinWorkspace, resolveInside, sessionInWorkspace } from '../src/main/workspace/path-utils.js'

const root = join(tmpdir(), 'nd-dsh-path-test', 'project')

describe('resolveInside', () => {
  it('allows the workspace root', () => {
    expect(resolveInside(root)).toBe(resolve(root))
  })

  it('allows a path below the workspace', () => {
    expect(resolveInside(root, join('src', 'index.ts'))).toBe(join(resolve(root), 'src', 'index.ts'))
  })

  it('rejects traversal outside the workspace', () => {
    expect(() => resolveInside(root, '..')).toThrow(/escapes/)
  })
})

describe('isWithinWorkspace', () => {
  const project = resolve(root)

  it('returns true for the workspace root itself', () => {
    expect(isWithinWorkspace(project, project)).toBe(true)
  })

  it('returns true for a descendant (subfolder or worktree)', () => {
    expect(isWithinWorkspace(project, join(project, 'src'))).toBe(true)
    expect(isWithinWorkspace(project, join(project, 'worktree', 'abc'))).toBe(true)
  })

  it('returns false for a sibling or unrelated workspace', () => {
    expect(isWithinWorkspace(project, join(tmpdir(), 'nd-dsh-path-test', 'other'))).toBe(false)
    expect(isWithinWorkspace(project, join(project, '..', 'sibling'))).toBe(false)
  })

  it('matches across case differences on Windows (filesystem is case-insensitive)', () => {
    if (process.platform !== 'win32') return
    expect(isWithinWorkspace(resolve(root), resolve(root).toLowerCase())).toBe(true)
  })
})

// The chat sidebar must only show sessions for the active project's workspace.
// Modeled on the Linky case: interactive chats root at the project directory,
// delegated tasks root at a worktree under it, and other projects' chats must
// be dropped.
const linky = join(tmpdir(), 'nd-dsh-path-test', 'Linky')

describe('sessionInWorkspace', () => {
  it('keeps an interactive chat rooted at the project workspace', () => {
    expect(sessionInWorkspace(linky, linky)).toBe(true)
  })

  it('keeps a delegated task chat in a worktree under the project', () => {
    expect(sessionInWorkspace(linky, join(linky, '.nd-worktrees', 'task-42'))).toBe(true)
  })

  it('keeps a chat in a subfolder the user opened', () => {
    expect(sessionInWorkspace(linky, join(linky, 'apps', 'web'))).toBe(true)
  })

  it('drops a chat from a different project/workspace', () => {
    expect(sessionInWorkspace(linky, join(tmpdir(), 'nd-dsh-path-test', 'Nimbus'))).toBe(false)
  })

  it('keeps a session that reports no usable cwd', () => {
    expect(sessionInWorkspace(linky, undefined)).toBe(true)
    expect(sessionInWorkspace(linky, '')).toBe(true)
  })
})
