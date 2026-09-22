import { describe, expect, it } from 'vitest'
import type { DshEventFrame } from '../src/shared/contracts.js'
import { TaskMetricsRecorder, usageCounters } from '../src/main/metrics/task-metrics.js'

function sessionEvent(sessionId: string, type: string, data?: unknown): DshEventFrame {
  return {
    kind: 'session-event',
    sessionId,
    event: { type, seq: 1, time: Date.now(), ...(data === undefined ? {} : { data }) },
  }
}

function begin(recorder: TaskMetricsRecorder, overrides: { runId?: string; sessionId?: string; taskId?: string } = {}): void {
  recorder.beginRun({
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? 'session-1',
    kind: 'task-execution',
    taskId: overrides.taskId ?? 'task-1',
  })
}

describe('TaskMetricsRecorder', () => {
  it('records one sample per run with the counters of that run', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.noteRoute('session-1', { engineId: 'opencode-cli', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    recorder.notePrompt('session-1', 'worker prompt')
    recorder.noteModelRoundTrip('session-1', 'cli-steps', { inputTokens: 1_000, outputTokens: 50 })
    recorder.noteModelRoundTrip('session-1', 'cli-steps', { inputTokens: 1_000, outputTokens: 50 })
    recorder.noteFrame(sessionEvent('session-1', 'tool/call'))
    recorder.noteFrame(sessionEvent('session-1', 'tool/call'))
    recorder.noteVerification('session-1', 'passed', 25)
    recorder.finishRun('run-1')

    const samples = recorder.samples()
    expect(samples).toHaveLength(1)
    const sample = samples[0]!
    expect(sample).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      kind: 'task-execution',
      engineId: 'opencode-cli',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      modelRoundTrips: 2,
      roundTripSource: 'cli-steps',
      toolCalls: 2,
      bytesToModel: 'worker prompt'.length,
      tokensToModel: 2_000,
      outputTokens: 100,
      escalations: 0,
      outcome: 'completed',
      verification: 'passed',
      verificationDurationMs: 25,
      completedTask: true,
      finished: true,
    })
    expect(sample.totalWallMs).toBeGreaterThanOrEqual(0)
  })

  it('only counts frames and prompts for sessions that own an open run', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.notePrompt('interactive-chat', 'not a task')
    recorder.noteFrame(sessionEvent('interactive-chat', 'tool/call'))
    recorder.noteModelRoundTrip('interactive-chat', 'harness-events', { inputTokens: 10 })

    const sample = recorder.samples()[0]!
    expect(sample.bytesToModel).toBe(0)
    expect(sample.toolCalls).toBe(0)
    expect(sample.modelRoundTrips).toBe(0)
    expect(sample.roundTripSource).toBe('none')
  })

  it('counts escalations from approval and question frames', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.noteFrame({ kind: 'approval-requested', sessionId: 'session-1', approvalId: 'a-1' })
    recorder.noteFrame({ kind: 'question-requested', sessionId: 'session-1', rpcId: 'q-1' })
    recorder.noteFrame({ kind: 'session-status', sessionId: 'session-1', running: false })
    expect(recorder.samples()[0]!.escalations).toBe(2)
  })

  it('counts a router escalation even when no engine approval frame exists', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.noteEscalation('session-1')
    expect(recorder.samples()[0]!.escalations).toBe(1)
  })

  it('attributes boundary crossings through the active runtime permit', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.setPermitResolver(() => ({ taskId: 'task-1' }))
    recorder.noteIpcCrossing()
    recorder.noteIpcCrossing()
    // Work outside any permit is counted nowhere rather than charged to a task.
    recorder.setPermitResolver(() => undefined)
    recorder.noteIpcCrossing()
    expect(recorder.samples()[0]!.ipcCrossings).toBe(2)
  })

  it('counts a run as a completed task only when machine verification passed', () => {
    for (const [verification, expected] of [['passed', true], ['failed', false], ['skipped', false], ['not-run', false]] as const) {
      const recorder = new TaskMetricsRecorder()
      begin(recorder)
      recorder.noteVerification('session-1', verification)
      recorder.finishRun('run-1')
      const sample = recorder.samples()[0]!
      expect(sample.outcome).toBe('completed')
      expect(sample.completedTask).toBe(expected)
    }
  })

  it('records a failed run and never scores it as a completion', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.noteVerification('session-1', 'failed')
    recorder.finishRun('run-1', 'Machine verification failed: exit 1')
    const sample = recorder.samples()[0]!
    expect(sample.outcome).toBe('failed')
    expect(sample.verification).toBe('failed')
    expect(sample.completedTask).toBe(false)
    expect(sample.error).toBe('Machine verification failed: exit 1')
  })

  it('keeps a canceled task canceled even when the failure close arrives first', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.finishRun('run-1', 'Canceled by user before the run completed.')
    recorder.noteCanceled('session-1')
    const sample = recorder.samples()[0]!
    expect(sample.outcome).toBe('canceled')
    expect(sample.completedTask).toBe(false)
  })

  it('reports a run that never reached a terminal state as unfinished', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.noteModelRoundTrip('session-1', 'cli-steps')
    const sample = recorder.samples()[0]!
    expect(sample.finished).toBe(false)
    expect(sample.completedTask).toBe(false)
    expect(sample.totalWallMs).toBe(0)
  })

  it('marks an interrupted run explicitly instead of leaving it open', () => {
    const recorder = new TaskMetricsRecorder()
    begin(recorder)
    recorder.interruptRun('run-1', 'Interrupted: ND-DSH restarted before the run finished.')
    const sample = recorder.samples()[0]!
    expect(sample.outcome).toBe('interrupted')
    expect(sample.finished).toBe(true)
    expect(sample.completedTask).toBe(false)
  })

  it('bounds retained samples and counts evictions instead of hiding them', () => {
    const recorder = new TaskMetricsRecorder()
    for (let index = 0; index < 600; index += 1) {
      recorder.beginRun({ runId: `run-${index}`, sessionId: `session-${index}`, kind: 'pm-plan' })
    }
    expect(recorder.samples()).toHaveLength(512)
    expect(recorder.droppedSampleCount()).toBe(88)
    expect(recorder.samples()[0]!.runId).toBe('run-88')
  })

  it('reads token usage from either engine-reported field shape', () => {
    expect(usageCounters({ inputTokens: 5, outputTokens: 2 })).toEqual({ inputTokens: 5, outputTokens: 2 })
    expect(usageCounters({ uncachedInputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 })).toEqual({ inputTokens: 10 })
    expect(usageCounters({})).toBeUndefined()
    expect(usageCounters(undefined)).toBeUndefined()
  })
})
