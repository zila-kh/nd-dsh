import { describe, expect, it } from 'vitest'
import {
  archiveableVisibleSessionIds,
  cleanThreadTitle,
  nextSessionAfterArchive,
} from '../src/shared/session-archive-selection.js'
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

describe('cleanThreadTitle', () => {
  it('strips injected <nd-browser-context> tags and trailing prompt text', () => {
    expect(cleanThreadTitle('hi <nd-browser-context> ND exposes one2min')).toBe('hi')
  })

  it('strips closed and unclosed <nd-extension-context> blocks', () => {
    expect(cleanThreadTitle('deploy app <nd-extension-context>\ntools\n</nd-extension-context>')).toBe('deploy app')
    expect(cleanThreadTitle('audit code <nd-workspace-context>')).toBe('audit code')
  })

  it('picks the first non-empty line of multiline titles', () => {
    expect(cleanThreadTitle('\n  Fix auth redirect  \nSecond line')).toBe('Fix auth redirect')
  })

  it('falls back to default title when empty or only metadata', () => {
    expect(cleanThreadTitle('')).toBe('New Chat Thread')
    expect(cleanThreadTitle(null)).toBe('New Chat Thread')
    expect(cleanThreadTitle('<nd-browser-context>only context</nd-browser-context>')).toBe('New Chat Thread')
    expect(cleanThreadTitle('', 'Fallback Chat')).toBe('Fallback Chat')
  })
})

describe('nextSessionAfterArchive', () => {
  it('returns current active id if active session is not being archived', () => {
    const next = nextSessionAfterArchive(
      'session-active',
      ['session-other'],
      [harness('session-active'), harness('session-other')],
      [],
    )
    expect(next).toBe('session-active')
  })

  it('picks the next available unarchived harness session when active is archived', () => {
    const next = nextSessionAfterArchive(
      'harness-1',
      ['harness-1'],
      [harness('harness-1'), harness('harness-2')],
      [engine('engine-1')],
    )
    expect(next).toBe('harness-2')
  })

  it('falls back to engine session if no unarchived harness sessions remain', () => {
    const next = nextSessionAfterArchive(
      'harness-1',
      ['harness-1'],
      [harness('harness-1')],
      [engine('engine-1')],
    )
    expect(next).toBe('engine-1')
  })

  it('returns null if all sessions are archived', () => {
    const next = nextSessionAfterArchive(
      'engine-1',
      ['engine-1'],
      [],
      [engine('engine-1')],
    )
    expect(next).toBeNull()
  })
})
