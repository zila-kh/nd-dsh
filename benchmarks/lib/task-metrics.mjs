import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertJsonSchema, validateJsonSchema } from './json-schema.mjs'
import { benchmarkRoot } from './core-rpc.mjs'

/**
 * Task-level result kind: aggregation and validation for `agent-task-metrics`.
 *
 * Raw samples are the source of truth. The summary below is recomputed from
 * them on every read — `bench:check` re-derives it rather than trusting a
 * stored number — because the whole point of this metric is that a task-cost
 * claim can be re-verified from the record instead of retold.
 */

export const TASK_METRICS_BENCHMARK = 'agent-task-metrics'
export const TASK_METRICS_SCHEMA_PATH = join(benchmarkRoot, 'benchmarks', 'schema', 'task-metrics.schema.json')

export function taskMetricsSchema() {
  return JSON.parse(readFileSync(TASK_METRICS_SCHEMA_PATH, 'utf8'))
}

export function validateTaskMetricsResult(document) {
  return validateJsonSchema(document, taskMetricsSchema())
}

export function assertTaskMetricsResult(document) {
  assertJsonSchema(document, taskMetricsSchema(), 'agent-task-metrics result')
}

/** A task sample is a task-execution run that owns a task. */
export function taskSamples(samples) {
  return samples.filter((sample) => sample.kind === 'task-execution' && Boolean(sample.taskId))
}

export function summarizeTaskSamples(samples, options = {}) {
  const runs = [...samples]
  const tasks = taskSamples(runs)
  const completed = tasks.filter((sample) => sample.completedTask === true)
  const field = (key) => tasks.map((sample) => Number(sample[key] ?? 0))
  const completedField = (key) => completed.map((sample) => Number(sample[key] ?? 0))

  return {
    wallTimeScope: options.wallTimeScope ?? 'excludes-model-latency',
    runs: runs.length,
    tasks: tasks.length,
    completedTasks: completed.length,
    completionRate: tasks.length ? completed.length / tasks.length : 0,
    unfinishedTasks: tasks.filter((sample) => sample.finished !== true).length,
    outcomes: {
      completed: tasks.filter((sample) => sample.outcome === 'completed').length,
      failed: tasks.filter((sample) => sample.outcome === 'failed').length,
      canceled: tasks.filter((sample) => sample.outcome === 'canceled').length,
      interrupted: tasks.filter((sample) => sample.outcome === 'interrupted').length,
    },
    verifications: {
      passed: tasks.filter((sample) => sample.verification === 'passed').length,
      failed: tasks.filter((sample) => sample.verification === 'failed').length,
      skipped: tasks.filter((sample) => sample.verification === 'skipped').length,
      'not-run': tasks.filter((sample) => sample.verification === 'not-run').length,
    },
    counters: {
      totalWallMs: distribution(tasks.map((sample) => Number(sample.totalWallMs ?? 0))),
      modelRoundTrips: distribution(field('modelRoundTrips')),
      toolCalls: distribution(field('toolCalls')),
      ipcCrossings: distribution(field('ipcCrossings')),
      bytesToModel: distribution(field('bytesToModel')),
      tokensToModel: distribution(field('tokensToModel')),
      escalations: distribution(field('escalations')),
    },
    // Per verified completion, not per run and not per attempt: a fast path
    // that completes fewer tasks must not look cheaper per task.
    perCompletedTask: {
      modelRoundTrips: mean(completedField('modelRoundTrips')),
      toolCalls: mean(completedField('toolCalls')),
      ipcCrossings: mean(completedField('ipcCrossings')),
      bytesToModel: mean(completedField('bytesToModel')),
      tokensToModel: mean(completedField('tokensToModel')),
      escalations: mean(completedField('escalations')),
      totalWallMs: mean(completedField('totalWallMs')),
    },
    roundTripSources: {
      'harness-events': tasks.filter((sample) => sample.roundTripSource === 'harness-events').length,
      'cli-steps': tasks.filter((sample) => sample.roundTripSource === 'cli-steps').length,
      none: tasks.filter((sample) => sample.roundTripSource === 'none').length,
    },
  }
}

/**
 * The fixture declares what it did; the recorded counters must agree. This is
 * what makes an offline result deterministic in the way that matters: not "the
 * wall clock was identical", but "the product counted exactly the model calls
 * and tool calls the fixture performed".
 */
export function evaluateTaskExpectations(tasks, samples) {
  const byRun = new Map(samples.map((sample) => [sample.runId, sample]))
  const deviations = []
  let checked = 0
  for (const task of tasks) {
    const observed = byRun.get(task.runId)
    if (!observed) {
      deviations.push({ taskId: task.taskId, field: 'sample', expected: 'recorded sample', observed: 'missing' })
      continue
    }
    const expected = task.expected ?? {}
    for (const field of ['modelRoundTrips', 'toolCalls', 'escalations', 'verification', 'outcome', 'completedTask']) {
      if (expected[field] === undefined) continue
      checked += 1
      if (observed[field] !== expected[field]) {
        deviations.push({ taskId: task.taskId, field, expected: expected[field], observed: observed[field] })
      }
    }
    if (expected.bytesToModelPositive) {
      checked += 1
      if (!(Number(observed.bytesToModel) > 0)) {
        deviations.push({ taskId: task.taskId, field: 'bytesToModel', expected: '> 0', observed: observed.bytesToModel ?? 0 })
      }
    }
  }
  return { checked, deviations }
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!sorted.length) return { total: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 }
  return {
    total: sorted.reduce((sum, value) => sum + value, 0),
    min: sorted[0],
    max: sorted.at(-1),
    mean: mean(sorted),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

function mean(values) {
  const finite = values.filter(Number.isFinite)
  if (!finite.length) return 0
  return finite.reduce((sum, value) => sum + value, 0) / finite.length
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}
