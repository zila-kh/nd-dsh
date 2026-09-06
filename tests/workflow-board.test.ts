import { describe, expect, it } from 'vitest'
import {
  parseWorkflowSnapshot,
  projectRepositoryBoard,
  type ProjectWorkflowSnapshot,
} from '../src/shared/workflow-plugins.js'

function task(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    key: '1',
    sourcePath: 'todo-0001-0001-bootstrap.md',
    contentHash: 'h',
    title: 'Bootstrap',
    lifecycle: 'todo',
    displayStatus: 'ready',
    archived: false,
    legacyArchive: false,
    prdRefs: [],
    scope: [],
    criteria: [],
    diagnostics: [],
    ...overrides,
  }
}

function snapshot(tasks: Array<Record<string, unknown>>): ProjectWorkflowSnapshot {
  return parseWorkflowSnapshot({ scannedAt: '2026-09-06T12:00:00.000Z', git: { available: false, dirty: false }, tasks, prds: [], diagnostics: [] })
}

describe('projectRepositoryBoard', () => {
  it('maps repository lifecycles onto board columns without inventing review states', () => {
    const board = projectRepositoryBoard(snapshot([
      task({ key: '1', lifecycle: 'todo', displayStatus: 'ready', title: 'Todo task' }),
      task({ key: '2', lifecycle: 'wip', displayStatus: 'in_progress', sourcePath: 'wip-0002-dark-mode.md', title: 'Dark mode' }),
      task({ key: '3', lifecycle: 'blocked', displayStatus: 'blocked', sourcePath: 'blocked-0003.md', title: 'Blocked task' }),
      task({ key: '4', lifecycle: 'done', displayStatus: 'completed', archived: true, sourcePath: 'done/done-0004.md', title: 'Done task', humanAcceptance: 'accepted by ND' }),
    ]), 'repo:agent-workflow-scrum')

    expect(board.ready.map((card) => card.title)).toEqual(['Todo task'])
    expect(board.in_progress.map((card) => card.title)).toEqual(['Dark mode'])
    expect(board.blocked.map((card) => card.title)).toEqual(['Blocked task'])
    expect(board.review).toEqual([])
    expect(board.completed.map((card) => card.title)).toEqual(['Done task'])
    expect(board.needs_attention).toEqual([])
    expect(board.completed[0]?.key).toBe('repo:agent-workflow-scrum:4')
  })

  it('marks legacy archived records with a warning but keeps them completed', () => {
    const board = projectRepositoryBoard(snapshot([
      task({ key: '2', lifecycle: 'done', displayStatus: 'completed', archived: true, legacyArchive: true, sourcePath: 'done/wip-0002-dark-mode.md' }),
    ]))
    expect(board.completed).toHaveLength(1)
    expect(board.completed[0]?.legacyArchive).toBe(true)
    expect(board.completed[0]?.warnings.join(' ')).toMatch(/legacy/i)
    expect(board.needs_attention).toHaveLength(0)
  })

  it('sends unnumbered and ambiguous records to needs-attention without inventing a status', () => {
    const board = projectRepositoryBoard(snapshot([
      task({ key: null, sourcePath: 'todo-unnumbered.md' }),
      task({ key: '5', displayStatus: undefined, sourcePath: 'wip-mystery.md' }),
      task({ key: '6', diagnostics: [{ severity: 'error', code: 'merge_conflict_markers', message: 'conflict markers found' }] }),
    ]))
    expect(board.needs_attention).toHaveLength(3)
    for (const column of ['ready', 'in_progress', 'review', 'blocked', 'completed'] as const) {
      expect(board[column]).toHaveLength(0)
    }
    expect(board.needs_attention.some((card) => card.warnings.join(' ').includes('Unnumbered'))).toBe(true)
    expect(board.needs_attention.some((card) => card.warnings.join(' ').includes('ambiguous'))).toBe(true)
    expect(board.needs_attention.some((card) => card.warnings.join(' ').includes('conflict markers'))).toBe(true)
  })

  it('surfaces acceptance gaps on completed cards and separates checked criteria from completion', () => {
    const board = projectRepositoryBoard(snapshot([
      task({ key: '2', lifecycle: 'wip', displayStatus: 'in_progress', sourcePath: 'wip-0002.md', criteria: [
        { text: 'a', checked: true }, { text: 'b', checked: true }, { text: 'c', checked: true },
        { text: 'd', checked: true }, { text: 'e', checked: true }, { text: 'f', checked: true },
      ], evidence: 'browser pass' }),
      task({ key: '3', lifecycle: 'done', displayStatus: 'completed', archived: true, sourcePath: 'done/done-0003.md' }),
    ]))
    const wip = board.in_progress[0]!
    // Six checked criteria but still WIP: completion is source-reported only.
    expect(wip.column).toBe('in_progress')
    expect(wip.criteriaChecked).toBe(6)
    expect(wip.criteriaTotal).toBe(6)
    expect(wip.hasEvidence).toBe(true)
    const completed = board.completed[0]!
    expect(completed.humanAcceptance).toBe(false)
    expect(completed.warnings.join(' ')).toMatch(/acceptance/i)
  })

  it('returns empty columns for a missing snapshot', () => {
    const board = projectRepositoryBoard(undefined)
    expect(board.ready).toEqual([])
    expect(board.needs_attention).toEqual([])
  })
})
