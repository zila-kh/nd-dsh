import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInside } from '../src/main/workspace/path-utils.js'

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
