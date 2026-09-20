import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageLedger, parseLedgerLine, usageStepLine } from '../src/main/usage/usage-ledger.js'
import { cacheHitRate, emptyUsageTotals, summarizeUsage, type UsageSessionUsage } from '../src/shared/usage.js'

/** One `assistant/message` event as the runtime logs it, usage included. */
function stepEvent(seq: number, usage: Record<string, number>, time = 1_000 + seq) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { content: [], source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      usage,
    },
  }
}

describe('usageStepLine', () => {
  it('reads one model call as disjoint input buckets', () => {
    expect(usageStepLine('session-1', stepEvent(4, {
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 900,
      cacheWriteTokens: 30,
    }))).toEqual({
      v: 1,
      kind: 'step',
      sessionId: 'session-1',
      seq: 4,
      time: 1_004,
      turn: 1,
      step: 4,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      uncachedInputTokens: 120,
      cacheReadTokens: 900,
      cacheWriteTokens: 30,
      outputTokens: 40,
    })
  })

  it('ignores events that are not accounted model calls', () => {
    expect(usageStepLine('session-1', { type: 'tool/result', seq: 5, time: 1, data: {} })).toBeUndefined()
    // An adapter that reported no accounting must not enter as a zero-token step.
    expect(usageStepLine('session-1', { type: 'assistant/message', seq: 6, time: 2, data: { turn: 1, step: 1 } })).toBeUndefined()
    expect(usageStepLine('', stepEvent(7, { inputTokens: 1, outputTokens: 1 }))).toBeUndefined()
    // Negative and non-integer counts are impossible shapes; drop the line.
    expect(usageStepLine('session-1', stepEvent(8, { inputTokens: -1, outputTokens: 3 }))).toBeUndefined()
  })
})

describe('UsageLedger', () => {
  it('folds calls into per-session totals and keeps the per-route split', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const ledger = new UsageLedger(join(dir, 'usage-ledger.jsonl'))

    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 }))
    ledger.recordEvent('session-1', stepEvent(2, {
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 950,
      cacheWriteTokens: 25,
    }))
    ledger.recordEvent('session-2', stepEvent(1, { inputTokens: 10, outputTokens: 1 }))

    const sessions = await ledger.perSession()
    expect(sessions.map((session) => session.sessionId).sort()).toEqual(['session-1', 'session-2'])
    const first = sessions.find((session) => session.sessionId === 'session-1')!
    expect(first.totals).toEqual({
      steps: 2,
      uncachedInputTokens: 150,
      cacheReadTokens: 1850,
      cacheWriteTokens: 25,
      outputTokens: 30,
    })
    expect(first.firstAt).toBe(1_001)
    expect(first.lastAt).toBe(1_002)
    expect(first.models).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      totals: first.totals,
    }])
    // 1850 / (150 + 1850 + 25)
    expect(cacheHitRate(first.totals)).toBeCloseTo(91.36, 1)
  })

  it('does not double count a replayed step', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const path = join(dir, 'usage-ledger.jsonl')
    const ledger = new UsageLedger(path)
    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10 }))
    ledger.recordEvent('session-1', stepEvent(2, { inputTokens: 100, outputTokens: 10 }))
    // A reconnecting stream replays its snapshot; the high-water mark drops it.
    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10 }))
    ledger.recordEvent('session-1', stepEvent(2, { inputTokens: 100, outputTokens: 10 }))

    const [session] = await ledger.perSession()
    expect(session!.totals.steps).toBe(2)
    expect(session!.totals.uncachedInputTokens).toBe(200)
    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('replays persisted totals and keeps guarding replays after a restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const path = join(dir, 'usage-ledger.jsonl')
    const first = new UsageLedger(path)
    first.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 400 }))
    await first.flush()

    const restarted = new UsageLedger(path)
    // The step recorded before the restart arrives again from a fresh stream.
    restarted.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 400 }))
    restarted.recordEvent('session-1', stepEvent(2, { inputTokens: 20, outputTokens: 5 }))

    const [session] = await restarted.perSession()
    expect(session!.totals).toEqual({
      steps: 2,
      uncachedInputTokens: 120,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
      outputTokens: 15,
    })
  })

  it('keeps totals when the log is compacted into one line per session', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const path = join(dir, 'usage-ledger.jsonl')
    // A compaction checkpoint plus a later step for the same session: the
    // checkpoint replaces the folded state and the step adds to it.
    await writeFile(path, [
      JSON.stringify({
        v: 1,
        kind: 'session',
        sessionId: 'session-1',
        highSeq: 9,
        firstAt: 1_000,
        lastAt: 1_100,
        totals: { steps: 4, uncachedInputTokens: 400, cacheReadTokens: 3_600, cacheWriteTokens: 0, outputTokens: 80 },
        models: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', totals: { steps: 4, uncachedInputTokens: 400, cacheReadTokens: 3_600, cacheWriteTokens: 0, outputTokens: 80 } }],
      }),
      JSON.stringify(usageStepLine('session-1', stepEvent(10, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 }))),
      'not json at all',
      JSON.stringify({ v: 1, kind: 'step', sessionId: 'session-2' }),
      '',
    ].join('\n'), 'utf8')

    const ledger = new UsageLedger(path)
    const sessions = await ledger.perSession()
    const first = sessions.find((session) => session.sessionId === 'session-1')!
    expect(first.totals).toEqual({
      steps: 5,
      uncachedInputTokens: 500,
      cacheReadTokens: 4_500,
      cacheWriteTokens: 0,
      outputTokens: 90,
    })
    expect(sessions.find((session) => session.sessionId === 'session-2')).toBeUndefined()
  })

  it('starts empty rather than failing on an unreadable log', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const path = join(dir, 'usage-ledger.jsonl')
    await writeFile(path, '{ this is not a ledger\n', 'utf8')

    const ledger = new UsageLedger(path)
    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 7, outputTokens: 3 }))
    const [session] = await ledger.perSession()
    expect(session!.totals.uncachedInputTokens).toBe(7)
  })

  it('compacts into per-session rollups once the log passes its cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    const path = join(dir, 'usage-ledger.jsonl')
    const ledger = new UsageLedger(path, { maxLogBytes: 1 })
    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 900 }))
    await ledger.flush()

    const lines = (await readFile(path, 'utf8')).trim().split('\n').map((line) => parseLedgerLine(line))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.kind).toBe('session')
    // The rollup preserves the totals and the replay guard the next run needs.
    const [session] = await ledger.perSession()
    expect(session!.totals.cacheReadTokens).toBe(900)
  })

  it('refuses to rewrite a log it could not read, so unread lines are not lost', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-usage-'))
    // A directory where the log belongs: every read fails with a non-ENOENT
    // error, which is the case where compaction must stand down.
    const path = join(dir, 'usage-ledger.jsonl')
    await mkdir(path)
    const ledger = new UsageLedger(path, { maxLogBytes: 1 })
    ledger.recordEvent('session-1', stepEvent(1, { inputTokens: 5, outputTokens: 1 }))
    await ledger.flush()

    // Accounting still works in memory, and the unreadable path is untouched.
    const [session] = await ledger.perSession()
    expect(session!.totals.uncachedInputTokens).toBe(5)
    expect((await stat(path)).isDirectory()).toBe(true)
  })
})

describe('parseLedgerLine', () => {
  it('rejects every shape this build cannot read', () => {
    expect(parseLedgerLine('{')).toBeUndefined()
    expect(parseLedgerLine('{"v":2,"kind":"step","sessionId":"s"}')).toBeUndefined()
    expect(parseLedgerLine('{"v":1,"kind":"unknown","sessionId":"s"}')).toBeUndefined()
    expect(parseLedgerLine('{"v":1,"kind":"step","sessionId":"  "}')).toBeUndefined()
    expect(parseLedgerLine(JSON.stringify({ v: 1, kind: 'session', sessionId: 's', highSeq: 1, firstAt: 1, lastAt: 1 }))).toBeUndefined()
    expect(parseLedgerLine(JSON.stringify(usageStepLine('s', stepEvent(1, { inputTokens: 1, outputTokens: 1 }))))).toBeDefined()
  })
})

describe('summarizeUsage', () => {
  const sessions: UsageSessionUsage[] = [
    {
      sessionId: 'exec-1',
      firstAt: 100,
      lastAt: 200,
      totals: { steps: 2, uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 },
      models: [],
    },
    {
      sessionId: 'review-1',
      firstAt: 300,
      lastAt: 400,
      totals: { steps: 1, uncachedInputTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
      models: [],
    },
    {
      sessionId: 'chat-1',
      firstAt: 500,
      lastAt: 600,
      totals: { steps: 1, uncachedInputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 0, outputTokens: 5 },
      models: [],
    },
  ]
  const attribution = new Map([
    ['exec-1', { companyId: 'company-1', projectId: 'project-1', taskId: 'task-1' }],
    ['review-1', { companyId: 'company-1', projectId: 'project-1', taskId: 'task-1' }],
  ])

  it('groups by task and never folds an unowned chat session into a project', () => {
    const summary = summarizeUsage({ sessions, scope: 'task', attribution })

    expect(summary.buckets).toHaveLength(1)
    expect(summary.buckets[0]!.key).toBe('task-1')
    expect(summary.buckets[0]!.sessionIds.sort()).toEqual(['exec-1', 'review-1'])
    expect(summary.buckets[0]!.totals.uncachedInputTokens).toBe(1_100)
    expect(summary.buckets[0]!.firstAt).toBe(100)
    expect(summary.buckets[0]!.lastAt).toBe(400)
    expect(summary.attributedSessions).toBe(2)
    expect(summary.unattributedSessions).toBe(1)
  })

  it('rolls the same sessions up to a project and reports its hit rate', () => {
    const summary = summarizeUsage({ sessions, scope: 'project', attribution })
    const project = summary.buckets[0]!

    expect(project.key).toBe('project-1')
    expect(project.totals).toEqual({
      steps: 3,
      uncachedInputTokens: 1_100,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
      outputTokens: 70,
    })
    expect(cacheHitRate(project.totals)).toBeCloseTo(45, 5)
  })

  it('filters one group id and a since window without changing whole-session totals', () => {
    const byId = summarizeUsage({ sessions, scope: 'session', attribution, id: 'chat-1' })
    expect(byId.buckets.map((bucket) => bucket.key)).toEqual(['chat-1'])
    expect(byId.attributedSessions).toBe(1)

    const recent = summarizeUsage({ sessions, scope: 'task', attribution, since: 350 })
    expect(recent.buckets[0]!.sessionIds).toEqual(['review-1'])
    expect(recent.attributedSessions).toBe(1)
  })

  it('reports an undefined hit rate before any input was billed', () => {
    expect(cacheHitRate(emptyUsageTotals())).toBeUndefined()
  })
})
