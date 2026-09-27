import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '../src/shared/contracts.js'
import { buildSessionTree } from '../src/shared/session-tree.js'

function session(sessionId: string, parentSessionId?: string, running = false, origin: SessionSummary['origin'] = parentSessionId ? 'subagent' : undefined): SessionSummary {
  return {
    sessionId,
    updatedAt: 1,
    running,
    blank: false,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(origin ? { origin } : {}),
  }
}

describe('buildSessionTree', () => {
  it('groups child agent sessions under their parent while preserving order', () => {
    const tree = buildSessionTree([
      session('main'),
      session('child-a', 'main', true),
      session('child-b', 'main'),
      session('manual'),
    ])

    expect(tree.map((node) => node.session.sessionId)).toEqual(['main', 'manual'])
    expect(tree[0]?.children.map((node) => node.session.sessionId)).toEqual(['child-a', 'child-b'])
    expect(tree[0]?.children[0]?.session.running).toBe(true)
  })

  it('keeps an orphan visible instead of hiding it', () => {
    const tree = buildSessionTree([session('orphan', 'missing-parent')])
    expect(tree.map((node) => node.session.sessionId)).toEqual(['orphan'])
  })

  it('does not misclassify an ordinary fork as a subagent', () => {
    // session() defaults origin to 'subagent' when a parent is given, and an
    // explicit undefined would re-trigger that default, so build the fork here.
    const fork: SessionSummary = { sessionId: 'fork', updatedAt: 1, running: false, blank: false, parentSessionId: 'main' }
    const tree = buildSessionTree([session('main'), fork])
    expect(tree.map((node) => node.session.sessionId)).toEqual(['main', 'fork'])
    expect(tree[0]?.children).toHaveLength(0)
  })

  it('fails soft on cyclic parent links', () => {
    const tree = buildSessionTree([
      session('child-a', 'child-b'),
      session('child-b', 'child-a'),
    ])
    expect(tree.map((node) => node.session.sessionId)).toEqual(['child-a', 'child-b'])
  })
})
