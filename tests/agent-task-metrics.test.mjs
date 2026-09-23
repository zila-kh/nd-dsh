import { describe, expect, it } from 'vitest'
import {
  evaluateTaskExpectations,
  summarizeParallelism,
  summarizeTaskSamples,
  validateTaskMetricsResult,
} from '../benchmarks/lib/task-metrics.mjs'

/**
 * The agent-task result kind is only useful if its aggregate can be recomputed
 * from raw samples and if a fixture's declared workload must equal the recorded
 * counters. Both are checked here over synthetic samples, offline and without a
 * model or the desktop app — the same code path `pnpm bench:tasks:check` runs
 * against the committed baseline.
 */
const VERIFIED = taskSample({
  runId: 'run-verified',
  taskId: 'task-verified',
  outcome: 'completed',
  verification: 'passed',
  completedTask: true,
  modelRoundTrips: 3,
  toolCalls: 4,
  totalWallMs: 900,
})
const UNVERIFIED = taskSample({
  runId: 'run-unverified',
  taskId: 'task-unverified',
  outcome: 'failed',
  verification: 'failed',
  completedTask: false,
  modelRoundTrips: 2,
  toolCalls: 2,
  totalWallMs: 400,
})
const CANCELED = taskSample({
  runId: 'run-canceled',
  taskId: 'task-canceled',
  outcome: 'canceled',
  verification: 'not-run',
  completedTask: false,
  modelRoundTrips: 1,
  toolCalls: 0,
  totalWallMs: 150,
})
const SAMPLES = [VERIFIED, UNVERIFIED, CANCELED]

function taskSample(overrides) {
  return {
    runId: 'run',
    sessionId: 'session',
    taskId: 'task',
    kind: 'task-execution',
    engineId: 'opencode-cli',
    startedAt: 1_000,
    finishedAt: 1_000 + (overrides.totalWallMs ?? 0),
    totalWallMs: 0,
    modelRoundTrips: 0,
    roundTripSource: 'cli-steps',
    toolCalls: 0,
    ipcCrossings: 5,
    bytesToModel: 3_000,
    tokensToModel: 1_000,
    outputTokens: 50,
    escalations: 0,
    outcome: 'completed',
    verification: 'not-run',
    completedTask: false,
    finished: true,
    ...overrides,
  }
}

function expectationsFor(sample, expected) {
  return { tasks: [{ taskId: sample.taskId, runId: sample.runId, expected }], samples: [sample] }
}

describe('agent-task result kind', () => {
  it('aggregates per task and per verified completion', () => {
    const summary = summarizeTaskSamples(SAMPLES)
    expect(summary.tasks).toBe(3)
    expect(summary.completedTasks).toBe(1)
    expect(summary.completionRate).toBeCloseTo(1 / 3)
    expect(summary.unfinishedTasks).toBe(0)
    expect(summary.outcomes).toEqual({ completed: 1, failed: 1, canceled: 1, interrupted: 0 })
    expect(summary.verifications).toEqual({ passed: 1, failed: 1, skipped: 0, 'not-run': 1 })
    expect(summary.roundTripSources).toEqual({ 'harness-events': 0, 'cli-steps': 3, none: 0 })
    // Cost per verified completion, so a fast path that completes fewer tasks
    // cannot look cheaper by doing less.
    expect(summary.perCompletedTask.modelRoundTrips).toBe(3)
    expect(summary.perCompletedTask.toolCalls).toBe(4)
    expect(summary.perCompletedTask.totalWallMs).toBe(900)
    expect(summary.counters.modelRoundTrips).toMatchObject({ total: 6, min: 1, max: 3, mean: 2 })
  })

  it('ignores runs that are not task executions', () => {
    const plan = { ...taskSample({}), runId: 'run-plan', kind: 'pm-plan', taskId: undefined }
    const summary = summarizeTaskSamples([...SAMPLES, plan])
    expect(summary.runs).toBe(4)
    expect(summary.tasks).toBe(3)
  })

  it('flags a fixture expectation the recorded counters do not support', () => {
    const matching = evaluateTaskExpectations(
      [{ taskId: VERIFIED.taskId, runId: VERIFIED.runId, expected: { modelRoundTrips: 3, completedTask: true, bytesToModelPositive: true } }],
      SAMPLES,
    )
    expect(matching).toEqual({ checked: 3, deviations: [] })

    const mismatched = evaluateTaskExpectations(
      [{ taskId: VERIFIED.taskId, runId: VERIFIED.runId, expected: { modelRoundTrips: 1, completedTask: false } }],
      SAMPLES,
    )
    expect(mismatched.deviations).toEqual([
      { taskId: VERIFIED.taskId, field: 'modelRoundTrips', expected: 1, observed: 3 },
      { taskId: VERIFIED.taskId, field: 'completedTask', expected: false, observed: true },
    ])
  })

  it('reports a task with no recorded sample instead of scoring it', () => {
    const result = evaluateTaskExpectations([{ taskId: 'task-missing', runId: 'run-missing', expected: {} }], SAMPLES)
    expect(result.deviations).toEqual([
      { taskId: 'task-missing', field: 'sample', expected: 'recorded sample', observed: 'missing' },
    ])
  })

  it('validates a result document against its schema and rejects a broken one', () => {
    const document = {
      schemaVersion: 1,
      benchmark: 'agent-task-metrics',
      taskKind: 'agent-task',
      timestamp: '2026-09-21T00:00:00.000Z',
      backend: 'rust-core',
      commit: '0000000',
      buildProfile: 'debug',
      fixtureRevision: 'prd-0002-v1',
      environment: {
        os: 'win32',
        osVersion: '10.0.26100',
        arch: 'x64',
        cpuModel: 'test',
        logicalCpuCount: 8,
        physicalMemoryBytes: 1,
        nodeVersion: 'v24.0.0',
      },
      wallTimeScope: 'excludes-model-latency',
      runMode: 'offline-fixture',
      fixture: {
        engineId: 'opencode-cli',
        cliPath: 'benchmarks/fixtures/agent-task-cli.mjs',
        cliSha256: '0'.repeat(64),
        shim: 'cmd-exe',
        passes: [{ name: 'verified', tasks: 1, steps: 3, toolCalls: 4, stepMs: 0, verify: 'pass', failRun: false }],
      },
      passes: [{
        name: 'verified',
        samples: 3,
        tasks: [{ taskId: VERIFIED.taskId, runId: VERIFIED.runId, expected: {}, observed: {} }],
      }],
      samples: SAMPLES,
      summary: summarizeTaskSamples(SAMPLES, { wallTimeScope: 'excludes-model-latency' }),
      expectations: { checked: 0, deviations: [] },
      fastPathComparison: {
        status: 'pass',
        normal: { samples: 1, completed: 1, completionRate: 1, modelRoundTrips: 3, toolCalls: 4, ipcCrossings: 17, escalations: 0 },
        fast: { samples: 1, completed: 1, completionRate: 1, modelRoundTrips: 0, toolCalls: 0, ipcCrossings: 9, escalations: 0 },
        failures: [],
      },
      parallelComparison: {
        status: 'pass',
        sequential: { tasks: 4, spanMs: 4_000, sumTaskWallMs: 3_600, meanTaskWallMs: 900, speedup: 0.9, peakConcurrency: 1, samples: 4, completed: 4, completionRate: 1, modelRoundTrips: 3, toolCalls: 3, ipcCrossings: 12 },
        parallel: { tasks: 4, spanMs: 1_000, sumTaskWallMs: 3_600, meanTaskWallMs: 900, speedup: 3.6, peakConcurrency: 4, samples: 4, completed: 4, completionRate: 1, modelRoundTrips: 3, toolCalls: 3, ipcCrossings: 13 },
        overflow: { tasks: 5, spanMs: 2_000, sumTaskWallMs: 4_500, meanTaskWallMs: 900, speedup: 2.25, peakConcurrency: 4, samples: 5, completed: 5, completionRate: 1, modelRoundTrips: 3, toolCalls: 3, ipcCrossings: 13 },
        budgets: { speedupFloor: 2.5, ipcGrowthBudget: 1.2, minPeakConcurrency: 4 },
        failures: [],
      },
    }
    expect(validateTaskMetricsResult(document)).toEqual([])

    // The comparison is required, not optional: the schema tightened when the
    // §12.4 budgets landed, and a document recorded before them must not pass.
    const missingComparison = { ...document }
    delete missingComparison.fastPathComparison
    expect(validateTaskMetricsResult(missingComparison))
      .toContainEqual(expect.stringContaining('fastPathComparison'))

    // Same rule for the concurrency budgets: a baseline recorded before the
    // sequential/parallel arms existed carries no overlap evidence at all.
    const missingParallel = { ...document }
    delete missingParallel.parallelComparison
    expect(validateTaskMetricsResult(missingParallel))
      .toContainEqual(expect.stringContaining('parallelComparison'))

    // The overflow arm is part of the same required evidence: a baseline that
    // never dispatched more tasks than the pool allows says nothing about whether
    // the excess queues or is refused.
    const missingOverflow = { ...document, parallelComparison: { ...document.parallelComparison } }
    delete missingOverflow.parallelComparison.overflow
    expect(validateTaskMetricsResult(missingOverflow))
      .toContainEqual(expect.stringContaining('overflow'))

    const broken = { ...document, summary: { ...document.summary, completionRate: 4 } }
    expect(validateTaskMetricsResult(broken)).toContainEqual(expect.stringContaining('above maximum 1'))
    expect(validateTaskMetricsResult({ ...document, samples: [{ ...VERIFIED, outcome: 'finished' }] }))
      .toContainEqual(expect.stringContaining('$.samples[0].outcome'))
    expect(validateTaskMetricsResult({ ...document, benchmark: 'core-startup' }))
      .toContainEqual(expect.stringContaining('$.benchmark'))
  })
})

/**
 * The concurrency claim is derived from recorded intervals, so the arithmetic
 * behind it is testable offline: serialized work, fully overlapped work, and the
 * shape the product actually produces when its execution pool caps overlap below
 * the number of dispatched tasks.
 */
function interval(id, startedAt, finishedAt, overrides = {}) {
  return taskSample({
    runId: `run-${id}`,
    taskId: `task-${id}`,
    startedAt,
    finishedAt,
    totalWallMs: finishedAt - startedAt,
    ...overrides,
  })
}

describe('parallelism summary', () => {
  it('reads a serialized pair as no speedup and no overlap', () => {
    const summary = summarizeParallelism([interval('a', 1_000, 1_500), interval('b', 1_500, 2_000)])
    expect(summary.tasks).toBe(2)
    expect(summary.spanMs).toBe(1_000)
    expect(summary.sumTaskWallMs).toBe(1_000)
    expect(summary.speedup).toBeCloseTo(1)
    // A task ending exactly as the next begins is a handoff, not an overlap.
    expect(summary.peakConcurrency).toBe(1)
  })

  it('reads fully overlapped work as proportional speedup', () => {
    const summary = summarizeParallelism([interval('a', 1_000, 2_000), interval('b', 1_000, 2_000)])
    expect(summary.spanMs).toBe(1_000)
    expect(summary.sumTaskWallMs).toBe(2_000)
    expect(summary.speedup).toBeCloseTo(2)
    expect(summary.peakConcurrency).toBe(2)
    expect(summary.meanTaskWallMs).toBeCloseTo(1_000)
  })

  it('reports the ceiling a capped execution pool imposed, not the tasks dispatched', () => {
    // Four tasks, two at a time: the shape ND produces with its default pool of
    // two workers per project. Span is two batches, so speedup lands at the cap.
    const summary = summarizeParallelism([
      interval('a', 0, 100),
      interval('b', 0, 100),
      interval('c', 100, 200),
      interval('d', 100, 200),
    ])
    expect(summary.tasks).toBe(4)
    expect(summary.spanMs).toBe(200)
    expect(summary.sumTaskWallMs).toBe(400)
    expect(summary.speedup).toBeCloseTo(2)
    expect(summary.peakConcurrency).toBe(2)
  })

  it('counts the widest instant when overlap is uneven', () => {
    const summary = summarizeParallelism([
      interval('a', 0, 300),
      interval('b', 50, 150),
      interval('c', 100, 200),
    ])
    expect(summary.peakConcurrency).toBe(3)
    expect(summary.spanMs).toBe(300)
    expect(summary.sumTaskWallMs).toBe(500)
  })

  it('excludes unfinished runs and runs that are not task executions', () => {
    const summary = summarizeParallelism([
      interval('a', 0, 100),
      interval('b', 0, 100, { finished: false }),
      interval('c', 0, 100, { kind: 'pm-plan', taskId: undefined }),
    ])
    expect(summary.tasks).toBe(1)
    expect(summary.peakConcurrency).toBe(1)
  })

  it('reports an unmeasurable span as zero rather than a division artifact', () => {
    expect(summarizeParallelism([])).toEqual({
      tasks: 0, spanMs: 0, sumTaskWallMs: 0, meanTaskWallMs: 0, speedup: 0, peakConcurrency: 0,
    })
    // Every task sharing one instant has a zero-length span; an infinite speedup
    // would pass any floor, so it is reported as unmeasured instead.
    expect(summarizeParallelism([interval('a', 500, 500), interval('b', 500, 500)]).speedup).toBe(0)
  })
})
