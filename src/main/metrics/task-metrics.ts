import type { DshEventFrame } from '../../shared/contracts.js'
import type { OrganizationRunKind } from '../../shared/organization.js'

/**
 * Per-task agent cost measurement.
 *
 * A run receipt records that work happened; it cannot say what the work cost.
 * This module keeps that second record: one sample per organization run, with
 * the counters a task-cost claim is made of — model round trips, tool calls,
 * boundary crossings, bytes/tokens toward the model, escalations, wall time and
 * how the run ended.
 *
 * Two rules shape the implementation:
 *
 * 1. Counters are incremented on production paths and are always on. A
 *    benchmark reads the samples this recorder keeps; it never turns the
 *    measurement on, and no call site branches on being benchmarked. The same
 *    numbers describe a user's task and a benchmark task.
 * 2. A run is only a *completed task* when its machine verification passed.
 *    Outcome and verification are recorded separately so "cheap because it
 *    stopped early" can never be read as "cheap because it was fast".
 *
 * The nearest neighbours are deliberately not reused as this measurement:
 * `UsageLedger` folds per-model token totals for the cost UI, and the engines
 * keep transcript bookkeeping for the chat pane. Both are UI-facing summaries.
 * Tokens are counted here from the same engine events they fold, so a task
 * measurement never depends on reading a UI summary back.
 */

export type AgentTaskOutcome = 'completed' | 'failed' | 'canceled' | 'interrupted'

export type AgentTaskVerificationStatus = 'passed' | 'failed' | 'skipped' | 'not-run'

/**
 * Which engine-reported signal produced `modelRoundTrips`. The harness reports
 * one `assistant/message` event per model call; a CLI engine can only report
 * what its wire exposes, so the source is recorded rather than assumed. A zero
 * with source `none` means "not observable", never "free".
 */
export type AgentTaskRoundTripSource = 'harness-events' | 'cli-steps' | 'none'

export interface AgentTaskRoute {
  engineId?: string
  provider?: string
  model?: string
}

export interface AgentTaskUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface AgentTaskSample {
  runId: string
  sessionId: string
  taskId?: string
  kind: OrganizationRunKind
  engineId?: string
  provider?: string
  model?: string
  startedAt: number
  finishedAt: number
  totalWallMs: number
  modelRoundTrips: number
  roundTripSource: AgentTaskRoundTripSource
  toolCalls: number
  ipcCrossings: number
  bytesToModel: number
  tokensToModel: number
  outputTokens: number
  escalations: number
  outcome: AgentTaskOutcome
  verification: AgentTaskVerificationStatus
  verificationDurationMs?: number
  /** True only when the run completed AND its machine verification passed. */
  completedTask: boolean
  /** False when no terminal state was observed for this run. */
  finished: boolean
  error?: string
}

export interface AgentTaskRunInput extends AgentTaskRoute {
  runId: string
  sessionId: string
  kind: OrganizationRunKind
  taskId?: string
  startedAt?: number
}

export interface PermitAttribution {
  taskId?: string
  sessionId?: string
}

interface MutableSample extends AgentTaskSample {
  explicitOutcome?: AgentTaskOutcome
}

const MAX_SAMPLES = 512

export class TaskMetricsRecorder {
  private readonly byRun = new Map<string, MutableSample>()
  private readonly runBySession = new Map<string, string>()
  private droppedSamples = 0
  private permitResolver: (() => PermitAttribution | undefined) | undefined

  /**
   * Attribution for boundary crossings. Core RPCs are issued deep inside the
   * organization work that owns them, so the current runtime permit — not a
   * caller-supplied id — is what identifies the task being charged.
   */
  setPermitResolver(resolver: (() => PermitAttribution | undefined) | undefined): void {
    this.permitResolver = resolver
  }

  beginRun(input: AgentTaskRunInput): void {
    if (!input.runId || !input.sessionId) return
    if (this.byRun.has(input.runId)) return
    const startedAt = input.startedAt ?? Date.now()
    const sample: MutableSample = {
      runId: input.runId,
      sessionId: input.sessionId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      kind: input.kind,
      ...(input.engineId ? { engineId: input.engineId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      startedAt,
      finishedAt: startedAt,
      totalWallMs: 0,
      modelRoundTrips: 0,
      roundTripSource: 'none',
      toolCalls: 0,
      ipcCrossings: 0,
      bytesToModel: 0,
      tokensToModel: 0,
      outputTokens: 0,
      escalations: 0,
      outcome: 'failed',
      verification: 'not-run',
      completedTask: false,
      finished: false,
    }
    this.byRun.set(sample.runId, sample)
    this.runBySession.set(sample.sessionId, sample.runId)
    this.evictOverflow()
  }

  /** Attributes the engine route on first use, without overwriting a known one. */
  noteRoute(sessionId: string, route: AgentTaskRoute): void {
    const sample = this.sample(sessionId)
    if (!sample) return
    if (route.engineId && !sample.engineId) sample.engineId = route.engineId
    if (route.provider && !sample.provider) sample.provider = route.provider
    if (route.model && !sample.model) sample.model = route.model
  }

  /** Bytes submitted toward the model, measured at the engine boundary. */
  notePrompt(sessionId: string, prompt: string): void {
    const sample = this.sample(sessionId)
    if (!sample) return
    sample.bytesToModel += Buffer.byteLength(prompt, 'utf8')
  }

  noteModelRoundTrip(sessionId: string, source: Exclude<AgentTaskRoundTripSource, 'none'>, usage?: AgentTaskUsage): void {
    const sample = this.sample(sessionId)
    if (!sample) return
    sample.modelRoundTrips += 1
    if (sample.roundTripSource === 'none') sample.roundTripSource = source
    if (usage) {
      sample.tokensToModel += finite(usage.inputTokens)
      sample.outputTokens += finite(usage.outputTokens)
    }
  }

  /** Tool calls and escalations, counted from the shared engine frame fan-out. */
  noteFrame(frame: DshEventFrame): void {
    if (!frame.sessionId) return
    const sample = this.sample(frame.sessionId)
    if (!sample) return
    if (frame.kind === 'session-event' && frame.event?.type === 'tool/call') {
      sample.toolCalls += 1
      return
    }
    if (frame.kind === 'approval-requested' || frame.kind === 'question-requested') {
      sample.escalations += 1
    }
  }

  /**
   * One main-process <-> nd-core request. Attribution comes from the runtime
   * permit active on this async context, so work that crosses the boundary
   * without an organization permit is counted nowhere rather than mischarged.
   */
  noteIpcCrossing(): void {
    const attribution = this.permitResolver?.()
    if (!attribution) return
    const sample = attribution.sessionId ? this.sample(attribution.sessionId) : this.sampleByTask(attribution.taskId)
    if (!sample) return
    sample.ipcCrossings += 1
  }

  noteVerification(sessionId: string, status: AgentTaskVerificationStatus, durationMs?: number): void {
    const sample = this.sample(sessionId)
    if (!sample) return
    sample.verification = status
    if (durationMs !== undefined && Number.isFinite(durationMs)) sample.verificationDurationMs = Math.max(0, durationMs)
    if (sample.finished) sample.completedTask = sample.outcome === 'completed' && status === 'passed'
  }

  noteCanceled(sessionId: string): void {
    const sample = this.sample(sessionId)
    if (!sample) return
    // Cancellation can be observed by the run record and by the engine error
    // event in either order, so the intent is applied to the sample whenever it
    // arrives rather than only while the sample is still open.
    this.applyOutcome(sample, 'canceled')
  }

  finishRun(runId: string, error?: string): void {
    this.close(this.byRun.get(runId), error === undefined ? 'completed' : 'failed', error)
  }

  /** A run that never reached a terminal state must not be scored at all. */
  interruptRun(runId: string, reason = 'Run was interrupted before it reached a terminal state.'): void {
    this.close(this.byRun.get(runId), 'interrupted', reason)
  }

  samples(): AgentTaskSample[] {
    return [...this.byRun.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .map((sample) => ({ ...sample }))
  }

  droppedSampleCount(): number {
    return this.droppedSamples
  }

  reset(): void {
    this.byRun.clear()
    this.runBySession.clear()
    this.droppedSamples = 0
  }

  private close(sample: MutableSample | undefined, outcome: AgentTaskOutcome, error?: string): void {
    if (!sample) return
    const finishedAt = Date.now()
    if (!sample.finished) {
      sample.finished = true
      sample.finishedAt = finishedAt
      sample.totalWallMs = Math.max(0, finishedAt - sample.startedAt)
    }
    this.applyOutcome(sample, sample.explicitOutcome ?? outcome)
    if (error && !sample.error) sample.error = error
  }

  /**
   * Machine verification is the gate: a reviewer's prose, a green transcript or
   * a fast stop are not completion. `skipped` (no configured test command) and
   * `failed` both leave the task unverified.
   */
  private applyOutcome(sample: MutableSample, outcome: AgentTaskOutcome): void {
    if (outcome === 'canceled') sample.explicitOutcome = 'canceled'
    sample.outcome = outcome
    sample.completedTask = outcome === 'completed' && sample.verification === 'passed'
  }

  private sample(sessionId: string | undefined): MutableSample | undefined {
    if (!sessionId) return undefined
    const runId = this.runBySession.get(sessionId)
    return runId ? this.byRun.get(runId) : undefined
  }

  private sampleByTask(taskId: string | undefined): MutableSample | undefined {
    if (!taskId) return undefined
    for (const sample of this.byRun.values()) {
      if (sample.taskId === taskId && !sample.finished) return sample
    }
    return undefined
  }

  /**
   * Samples are kept for the lifetime of the app so a benchmark can read what
   * the product actually did. The bound only exists so a long-running desktop
   * session cannot grow without limit; evictions are counted, never silent.
   */
  private evictOverflow(): void {
    while (this.byRun.size > MAX_SAMPLES) {
      const oldest = this.byRun.values().next().value as MutableSample | undefined
      if (!oldest) return
      this.byRun.delete(oldest.runId)
      if (this.runBySession.get(oldest.sessionId) === oldest.runId) this.runBySession.delete(oldest.sessionId)
      this.droppedSamples += 1
    }
  }
}

let active: TaskMetricsRecorder | undefined

/** Main-process seam shared by IPC, engines and organization code without threading a recorder through every constructor. */
export function setTaskMetricsRecorder(recorder: TaskMetricsRecorder | undefined): void {
  active = recorder
}

export function taskMetricsRecorder(): TaskMetricsRecorder | undefined {
  return active
}

export function noteModelUsage(sessionId: string, source: Exclude<AgentTaskRoundTripSource, 'none'>, usage: unknown): void {
  active?.noteModelRoundTrip(sessionId, source, usageCounters(usage))
}

/**
 * Token fields are engine-reported and vary by wire. Only explicit token counts
 * are summed; a missing field is not a zero-token call.
 */
export function usageCounters(usage: unknown): AgentTaskUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const input = optionalNumber(record.inputTokens)
    ?? sumDefined([record.uncachedInputTokens, record.cacheReadTokens, record.cacheWriteTokens])
  const output = optionalNumber(record.outputTokens)
  if (input === undefined && output === undefined) return undefined
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
  }
}

function sumDefined(values: unknown[]): number | undefined {
  let total = 0
  let seen = false
  for (const value of values) {
    const parsed = optionalNumber(value)
    if (parsed === undefined) continue
    total += parsed
    seen = true
  }
  return seen ? total : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
