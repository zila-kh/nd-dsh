import { describe, expect, it } from 'vitest'
import { archiveableVisibleSessionIds } from '../src/shared/session-archive-selection.js'
import type { EngineSessionSummary, SessionSummary } from '../src/shared/contracts.js'

function harness(sessionId: string, extra: Partial<SessionSummary> = {}): SessionSummary {
  return { sessionId, updatedAt: 1, running: false, blank: false, ...extra }
}

function engine(sessionId: string, extra: Partial<EngineSessionSummary> = {}): EngineSessionSummary {
  return { sessionId, engineId: 'codex', title: 'Chat', createdAt: 1, updatedAt: 1, running: false, ...extra }
}

describe('archiveableVisibleSessionIds', () => {
  it('combines active harness and engine sessions and deduplicates ids', () => {
    expect(archiveableVisibleSessionIds(
      [harness('harness-1'), harness('shared')],
      [engine('engine-1'), engine('shared')],
      null,
    )).toEqual(['harness-1', 'shared', 'engine-1'])
  })

  it('excludes archived sessions and non-rendered blank harness drafts', () => {
    expect(archiveableVisibleSessionIds(
      [
        harness('archived', { archived: true }),
        harness('blank-hidden', { blank: true }),
        harness('blank-active', { blank: true }),
      ],
      [engine('engine-1', { archived: true }), engine('engine-2')],
      'blank-active',
    )).toEqual(['blank-active', 'engine-2'])
  })
})
