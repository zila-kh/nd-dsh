import { describe, expect, it } from 'vitest'
import { filterSessionsInProjectScope, isSessionInProjectScope } from '../src/shared/session-project-scope.js'

const sessionProjects = {
  'sess-plan-dfdf': 'project-dfdf',
  'sess-review-dfdf': 'project-dfdf',
  'sess-plan-ndf': 'project-ndf',
  'sess-engine-ndf': 'project-ndf',
}

function session(sessionId: string, parentSessionId?: string, origin: 'subagent' | undefined = parentSessionId ? 'subagent' : undefined): { sessionId: string; parentSessionId?: string; origin?: 'subagent' } {
  return { sessionId, ...(parentSessionId ? { parentSessionId } : {}), ...(origin ? { origin } : {}) }
}

describe('isSessionInProjectScope', () => {
  it('shows everything when no project is active (standalone workspace)', () => {
    expect(isSessionInProjectScope('sess-plan-ndf', undefined, sessionProjects)).toBe(true)
    expect(isSessionInProjectScope('sess-personal', undefined, sessionProjects)).toBe(true)
  })

  it('keeps sessions with no run attribution visible in every project', () => {
    expect(isSessionInProjectScope('sess-personal', 'project-dfdf', sessionProjects)).toBe(true)
  })

  it('keeps sessions that belong to the active project', () => {
    expect(isSessionInProjectScope('sess-review-dfdf', 'project-dfdf', sessionProjects)).toBe(true)
  })

  it('hides sessions attributed to another project', () => {
    expect(isSessionInProjectScope('sess-plan-ndf', 'project-dfdf', sessionProjects)).toBe(false)
  })
})

describe('filterSessionsInProjectScope', () => {
  it('filters harness and engine session listings down to the active project', () => {
    const items = ['sess-plan-dfdf', 'sess-personal', 'sess-plan-ndf', 'sess-engine-ndf'].map(session)
    expect(filterSessionsInProjectScope(items, 'project-dfdf', sessionProjects).map((item) => item.sessionId)).toEqual([
      'sess-plan-dfdf',
      'sess-personal',
    ])
  })

  it('inherits project attribution for nested subagent sessions from their parent chain', () => {
    const items = [
      session('sess-plan-dfdf'),
      session('sess-child-dfdf', 'sess-plan-dfdf'),
      session('sess-grandchild-dfdf', 'sess-child-dfdf'),
      session('sess-plan-ndf'),
      session('sess-child-ndf', 'sess-plan-ndf'),
    ]
    expect(filterSessionsInProjectScope(items, 'project-dfdf', sessionProjects).map((item) => item.sessionId)).toEqual([
      'sess-plan-dfdf',
      'sess-child-dfdf',
      'sess-grandchild-dfdf',
    ])
  })

  it('keeps an ordinary fork globally visible when it has no run attribution', () => {
    const items = [
      session('sess-plan-ndf'),
      session('sess-fork-ndf', 'sess-plan-ndf', undefined),
    ]
    expect(filterSessionsInProjectScope(items, 'project-dfdf', sessionProjects).map((item) => item.sessionId)).toEqual([
      'sess-fork-ndf',
    ])
  })

  it('returns the full listing unchanged when no project is active', () => {
    const items = ['sess-plan-dfdf', 'sess-plan-ndf'].map(session)
    expect(filterSessionsInProjectScope(items, undefined, sessionProjects)).toEqual(items)
  })
})
