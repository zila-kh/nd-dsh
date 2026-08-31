import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scopeSessionListPayload } from '../src/main/harness/session-scope.js'

const linky = join(tmpdir(), 'nd-dsh-path-test', 'Linky')
const nimbus = join(tmpdir(), 'nd-dsh-path-test', 'Nimbus')

function session(sessionId: string, cwd: string | undefined): Record<string, unknown> {
  return { sessionId, updatedAt: Date.now(), running: false, blank: false, ...(cwd === undefined ? {} : { cwd }) }
}

describe('scopeSessionListPayload', () => {
  it('keeps only sessions inside the active workspace and preserves their fields', () => {
    const value = {
      items: [
        session('sess-linky', linky),
        session('sess-worktree', join(linky, '.nd-worktrees', 'task-42')),
        session('sess-nimbus', nimbus),
      ],
    }
    const scoped = scopeSessionListPayload(value, linky, new Set()) as { items: Array<Record<string, unknown>> }
    expect(scoped.items.map((item) => item.sessionId)).toEqual(['sess-linky', 'sess-worktree'])
    expect(scoped.items[0]).toMatchObject({ sessionId: 'sess-linky', cwd: linky })
  })

  it('stamps the ND archive flag only on surviving rows', () => {
    const value = {
      items: [
        session('sess-archived', linky),
        session('sess-archived-cross', nimbus),
        session('sess-live', linky),
      ],
    }
    const scoped = scopeSessionListPayload(value, linky, new Set(['sess-archived', 'sess-archived-cross'])) as {
      items: Array<Record<string, unknown>>
    }
    expect(scoped.items.map((item) => item.sessionId)).toEqual(['sess-archived', 'sess-live'])
    expect(scoped.items[0]!.archived).toBe(true)
    expect(scoped.items[1]!.archived).toBeUndefined()
  })

  it('passes a non-array or missing items payload through unchanged', () => {
    expect(scopeSessionListPayload({ foo: 1 }, linky, new Set())).toEqual({ foo: 1 })
    expect(scopeSessionListPayload(undefined, linky, new Set())).toBeUndefined()
  })

  it('drops rows that are not session-like', () => {
    const scoped = scopeSessionListPayload({ items: [{ cwd: linky }, session('real', linky)] }, linky, new Set()) as {
      items: Array<{ sessionId: string }>
    }
    expect(scoped.items.map((item) => item.sessionId)).toEqual(['real'])
  })
})
