import { describe, expect, it } from 'vitest'
import {
  evaluateTaskExpectations,
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
    }
    expect(validateTaskMetricsResult(document)).toEqual([])

    const broken = { ...document, summary: { ...document.summary, completionRate: 4 } }
    expect(validateTaskMetricsResult(broken)).toContainEqual(expect.stringContaining('above maximum 1'))
    expect(validateTaskMetricsResult({ ...document, samples: [{ ...VERIFIED, outcome: 'finished' }] }))
      .toContainEqual(expect.stringContaining('$.samples[0].outcome'))
    expect(validateTaskMetricsResult({ ...document, benchmark: 'core-startup' }))
      .toContainEqual(expect.stringContaining('$.benchmark'))
  })
})
