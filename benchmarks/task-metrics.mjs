import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { benchmarkRoot, defaultCoreBinary } from './lib/core-rpc.mjs'
import { AGENT_TASK_READ_ONLY_TEST_COMMAND, AGENT_TASK_TEST_COMMAND, createAgentTaskWorkspace } from './lib/fixture-workspace.mjs'
import { environmentMetadata } from './lib/metrics.mjs'
import { defaultOutputDir, resultProvenance } from './lib/results.mjs'
import {
  TASK_METRICS_BENCHMARK,
  assertTaskMetricsResult,
  evaluateTaskExpectations,
  summarizeParallelism,
  summarizeTaskSamples,
} from './lib/task-metrics.mjs'

/**
 * Agent-task measurement: what one task costs in model round trips, tool calls,
 * boundary crossings and bytes, rather than how fast the runtime is.
 *
 * The passes below drive the real product — real organization records, real
 * task worktrees, real machine verification, real cancellation — against a
 * deterministic offline coding-CLI fixture, so the counters can be recorded
 * without a model provider and re-checked later with `--verify` without even
 * starting the app.
 */
const PASSES = [
  {
    name: 'normal-read',
    tasks: 2,
    readOnly: true,
    fixture: { steps: 2, toolCalls: 3, stepMs: 0, verify: 'pass', failRun: false },
    expected: { modelRoundTrips: 2, toolCalls: 3, escalations: 0, verification: 'passed', outcome: 'completed', completedTask: true, bytesToModelPositive: true },
  },
  {
    name: 'fast-read',
    tasks: 2,
    fastPath: true,
    readOnly: true,
    fixture: { steps: 0, toolCalls: 0, stepMs: 0, verify: 'pass', failRun: false },
    expected: { modelRoundTrips: 0, toolCalls: 0, escalations: 0, verification: 'passed', outcome: 'completed', completedTask: true, bytesToModelZero: true },
  },
  {
    name: 'verified',
    tasks: 2,
    cancelAfterRoundTrips: undefined,
    fixture: { steps: 3, toolCalls: 4, stepMs: 0, verify: 'pass', failRun: false },
    expected: {
      modelRoundTrips: 3,
      toolCalls: 4,
      escalations: 0,
      verification: 'passed',
      outcome: 'completed',
      completedTask: true,
      bytesToModelPositive: true,
    },
  },
  {
    name: 'verification-failed',
    tasks: 1,
    fixture: { steps: 2, toolCalls: 2, stepMs: 0, verify: 'fail', failRun: false },
    expected: {
      modelRoundTrips: 2,
      toolCalls: 2,
      escalations: 0,
      verification: 'failed',
      outcome: 'failed',
      completedTask: false,
    },
  },
  {
    name: 'engine-failed',
    tasks: 1,
    fixture: { steps: 2, toolCalls: 2, stepMs: 0, verify: 'pass', failRun: true },
    expected: {
      modelRoundTrips: 2,
      toolCalls: 2,
      escalations: 0,
      verification: 'not-run',
      outcome: 'failed',
      completedTask: false,
    },
  },
  {
    name: 'canceled',
    tasks: 1,
    cancelAfterRoundTrips: 1,
    fixture: { steps: 25, toolCalls: 25, stepMs: 200, verify: 'pass', failRun: false },
    // A canceled task is scored on how it ended, never on how little it cost:
    // its counters stop wherever the cancellation landed.
    expected: {
      escalations: 0,
      verification: 'not-run',
      outcome: 'canceled',
      completedTask: false,
    },
  },
  // The matched concurrency pair. Both arms run the same four read-only tasks
  // against the same fixture; only the dispatch differs. `stepMs` is non-zero
  // because a task with no duration cannot overlap anything measurably — the
  // delay is what makes "did these run at the same time" answerable from the
  // recorded intervals rather than assumed from the dispatch call.
  {
    name: 'sequential-4x',
    tasks: 4,
    readOnly: true,
    fixture: { steps: 3, toolCalls: 3, stepMs: 150, verify: 'pass', failRun: false },
    expected: {
      modelRoundTrips: 3,
      toolCalls: 3,
      escalations: 0,
      verification: 'passed',
      outcome: 'completed',
      completedTask: true,
    },
  },
  {
    name: 'parallel-4x',
    tasks: 4,
    parallel: true,
    readOnly: true,
    fixture: { steps: 3, toolCalls: 3, stepMs: 150, verify: 'pass', failRun: false },
    expected: {
      modelRoundTrips: 3,
      toolCalls: 3,
      escalations: 0,
      verification: 'passed',
      outcome: 'completed',
      completedTask: true,
    },
  },
]

/**
 * Concurrency budgets for the matched pair above.
 *
 * The speedup floor is deliberately modest: the product's execution pool
 * defaults to two workers per project, so four dispatched tasks can reach at
 * best ~2x, and the floor only has to refute "these never actually overlapped".
 * `peakConcurrency` carries the sharper claim, because it reports the ceiling
 * the product imposed rather than the one the pass asked for.
 */
const PARALLEL_SPEEDUP_FLOOR = 1.25
const PARALLEL_IPC_GROWTH_BUDGET = 1.2

const BASELINE_PATH = join(benchmarkRoot, 'benchmarks', 'baselines', 'agent-task-normal-loop.json')
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const fixtureCliPath = join(benchmarkRoot, 'benchmarks', 'fixtures', 'agent-task-cli.mjs')
const args = process.argv.slice(2)

if (args.includes('--verify')) {
  const target = args[args.indexOf('--verify') + 1]
  if (!target) fail('Usage: node benchmarks/task-metrics.mjs --verify <agent-task-metrics.json>')
  await verifyResult(resolve(target))
} else {
  await record()
}

async function record() {
  const outputDir = resolve(readFlag('--out') || process.env.ND_DSH_BENCH_OUTPUT || defaultOutputDir())
  const profile = readFlag('--profile') || process.env.ND_DSH_BENCH_PROFILE?.trim() || 'debug'
  const coreBinary = defaultCoreBinary(profile)
  if (!existsSync(coreBinary)) fail(`ND Core benchmark binary is missing: ${coreBinary}\nRun "corepack pnpm core:build${profile === 'release' ? '' : ':dev'}" first.`)
  if (!existsSync(join(benchmarkRoot, 'out', 'main', 'index.js'))) fail('The desktop build is missing: run "corepack pnpm build" first.')
  // Provenance must describe the binaries that actually ran: the profile is
  // resolved here, so it is reported here rather than left at the default.
  process.env.ND_DSH_BENCH_PROFILE = profile
  process.env.ND_DSH_BENCH_BACKEND = process.env.ND_DSH_BENCH_BACKEND?.trim() || 'rust-core'
  process.env.ND_DSH_BENCH_FIXTURE_REVISION = process.env.ND_DSH_BENCH_FIXTURE_REVISION?.trim() || 'agent-task-v1'

  const rawDir = join(outputDir, 'raw')
  await fs.mkdir(rawDir, { recursive: true })
  const cliSha256 = sha256(await fs.readFile(fixtureCliPath))
  const runtimePath = process.execPath
  const shimKind = process.platform === 'win32' ? 'cmd-exe' : 'posix-shell'
  const recorded = []

  for (const pass of PASSES) {
    const workspaceRoot = join(rawDir, 'workspace-' + pass.name)
    const userDataDir = join(rawDir, 'user-data-' + pass.name)
    const shimPath = join(rawDir, 'agent-task-cli-' + pass.name + (process.platform === 'win32' ? '.cmd' : '.sh'))
    const rawPath = join(rawDir, pass.name + '.json')
    await createAgentTaskWorkspace(workspaceRoot)
    await rm(userDataDir)
    await rm(rawPath)
    await writeShim(shimPath, runtimePath)
    const env = safeEnvironment()
    Object.assign(env, {
      ND_DSH_CORE_PROFILE: profile,
      ND_DSH_BENCH_PROFILE: profile,
      ND_DSH_WORKSPACE: workspaceRoot,
      ND_DSH_USER_DATA_DIR: userDataDir,
      ND_DSH_BROWSER_URL: 'about:blank',
      ND_DSH_OPENCODE_BINARY: shimPath,
      ND_DSH_AGENT_TASK_BENCH_OUTPUT: rawPath,
      ND_DSH_AGENT_TASK_BENCH_SCENARIO: JSON.stringify(scenarioFor(pass)),
      ND_TASK_FIXTURE_STEPS: String(pass.fixture.steps),
      ND_TASK_FIXTURE_TOOLS: String(pass.fixture.toolCalls),
      ND_TASK_FIXTURE_STEP_MS: String(pass.fixture.stepMs),
      ND_TASK_FIXTURE_VERIFY: pass.fixture.verify,
      ND_TASK_FIXTURE_FAIL: pass.fixture.failRun ? '1' : '0',
      ND_TASK_FIXTURE_READ_ONLY: pass.readOnly ? '1' : '0',
    })
    process.stdout.write(`[agent-task] pass "${pass.name}": ${pass.tasks} task(s)\n`)
    const { stdout, stderr, code } = await runApp(env)
    if (code !== 0) fail(`Pass "${pass.name}" exited with code ${String(code)}.\n${stdout}\n${stderr}`)
    if (!existsSync(rawPath)) fail(`Pass "${pass.name}" wrote no raw result.\n${stdout}\n${stderr}`)
    const raw = JSON.parse(await fs.readFile(rawPath, 'utf8'))
    if (raw.samples.length !== pass.tasks) fail(`Pass "${pass.name}" recorded ${raw.samples.length} sample(s) for ${pass.tasks} task(s).`)
    recorded.push({ pass, raw, workspaceRoot })
  }

  const samples = recorded.flatMap((entry) => entry.raw.samples)
  const tasks = recorded.flatMap((entry) => entry.raw.tasks)
  const passes = recorded.map((entry) => ({
    name: entry.pass.name,
    tasks: entry.raw.tasks,
    samples: entry.raw.samples.length,
    workspaceRoot: entry.raw.workspaceRoot,
    droppedSamples: entry.raw.droppedSamples ?? 0,
  }))
  const document = {
    schemaVersion: 1,
    benchmark: TASK_METRICS_BENCHMARK,
    taskKind: 'agent-task',
    timestamp: new Date().toISOString(),
    backend: process.env.ND_DSH_BENCH_BACKEND?.trim() || 'rust-core',
    ...await resultProvenance(),
    environment: environmentMetadata(),
    // Counters do not depend on model latency, so they are comparable in either
    // scope; the wall times of an offline fixture are product overhead, and no
    // user-facing latency claim may be derived from them.
    wallTimeScope: 'excludes-model-latency',
    runMode: 'offline-fixture',
    notes: [
      'Tasks run through the production task path: organization records, runtime permits, isolated task worktrees, the real engine router and machine verification.',
      `Windows npm-style shims are resolved to their Node entrypoint before spawn, so multi-line prompts arrive intact (shim: ${shimKind}).`,
      'A task counts as completed only when its machine verification passed. Failed, canceled and interrupted runs are reported, never dropped.',
      'The sequential/parallel pair dispatches the same four tasks and derives overlap from the recorded run intervals, so how many tasks really ran at once is decided by the product execution pool rather than asserted by the pass.',
    ],
    fixture: {
      engineId: 'opencode-cli',
      cliPath: relativeToRepo(fixtureCliPath),
      cliSha256,
      shim: shimKind,
      runtimePath,
      passes: PASSES.map((pass) => ({ name: pass.name, tasks: pass.tasks, ...pass.fixture })),
    },
    passes,
    samples,
    summary: summarizeTaskSamples(samples, { wallTimeScope: 'excludes-model-latency' }),
    expectations: evaluateTaskExpectations(tasks, samples),
    fastPathComparison: compareFastPath(passes, samples),
    parallelComparison: compareParallel(passes, samples),
  }
  assertTaskMetricsResult(document)

  await fs.writeFile(join(outputDir, 'agent-task-metrics.json'), JSON.stringify(document, null, 2) + '\n', 'utf8')
  const verdict = judge(document)
  if (args.includes('--baseline')) {
    // A baseline is a reviewed claim about the normal loop, so only a run that
    // passed its own verdict may replace it; writing before the verdict is
    // known would let a regression quietly become the new reference.
    if (verdict.status === 'pass') {
      await fs.mkdir(join(benchmarkRoot, 'benchmarks', 'baselines'), { recursive: true })
      await fs.writeFile(BASELINE_PATH, JSON.stringify(document, null, 2) + '\n', 'utf8')
      process.stdout.write(`[agent-task] baseline written to ${relativeToRepo(BASELINE_PATH)}\n`)
    } else {
      process.stdout.write('[agent-task] baseline NOT written: this run failed its own verdict.\n')
    }
  }
  process.stdout.write(JSON.stringify({ outputDir, ...verdict }, null, 2) + '\n')
  if (verdict.status !== 'pass') process.exitCode = 1
}

/**
 * Offline check of a recorded result: the schema is enforced, the summary is
 * recomputed from the raw samples instead of trusted, and every task is
 * re-compared against what the fixture declared it would do.
 */
async function verifyResult(target) {
  const document = JSON.parse(await fs.readFile(target, 'utf8'))
  assertTaskMetricsResult(document)
  const recomputed = summarizeTaskSamples(document.samples, { wallTimeScope: document.wallTimeScope })
  const stored = JSON.stringify(document.summary)
  const actual = JSON.stringify(recomputed)
  const expectations = evaluateTaskExpectations(document.passes.flatMap((pass) => pass.tasks ?? []), document.samples)
  // The §12.4 fast-path budgets are re-derived from the stored raw samples too,
  // so a hand-edited or rotted comparison fails offline, and a result recorded
  // before the comparison existed cannot pass as a baseline.
  const fastPathComparison = compareFastPath(document.passes, document.samples)
  const comparisonMatches = JSON.stringify(document.fastPathComparison) === JSON.stringify(fastPathComparison)
  // The concurrency verdict is re-derived from the stored intervals as well, so
  // a speedup or peak-concurrency number that was written by hand, or recorded
  // before these arms existed, cannot pass as a baseline either.
  const parallelComparison = compareParallel(document.passes, document.samples)
  const parallelMatches = JSON.stringify(document.parallelComparison) === JSON.stringify(parallelComparison)
  const verdict = {
    status: stored === actual
      && !expectations.deviations.length
      && comparisonMatches
      && fastPathComparison.status === 'pass'
      && parallelMatches
      && parallelComparison.status === 'pass' ? 'pass' : 'fail',
    file: relativeToRepo(target),
    schema: 'valid',
    summaryRecomputed: stored === actual,
    fastPathComparisonRecomputed: comparisonMatches,
    fastPathComparison,
    parallelComparisonRecomputed: parallelMatches,
    parallelComparison,
    completedTasks: recomputed.completedTasks,
    tasks: recomputed.tasks,
    completionRate: recomputed.completionRate,
    perCompletedTask: recomputed.perCompletedTask,
    expectations,
  }
  process.stdout.write(JSON.stringify(verdict, null, 2) + '\n')
  if (verdict.status !== 'pass') process.exitCode = 1
}

function judge(document) {
  const { summary, expectations } = document
  const failures = []
  if (summary.unfinishedTasks > 0) failures.push(`${summary.unfinishedTasks} task(s) never reached a terminal state`)
  if (expectations.deviations.length) failures.push(...expectations.deviations.map((item) => `${item.field}: expected ${JSON.stringify(item.expected)}, observed ${JSON.stringify(item.observed)}`))
  const comparison = document.fastPathComparison
  if (comparison?.status !== 'pass') {
    failures.push(...(comparison?.failures ?? ['the fast-path comparison (normal-read vs fast-read arms) is missing from this result']))
  }
  const parallel = document.parallelComparison
  if (parallel?.status !== 'pass') {
    failures.push(...(parallel?.failures ?? ['the parallel comparison (sequential-4x vs parallel-4x arms) is missing from this result']))
  }
  return {
    status: failures.length ? 'fail' : 'pass',
    tasks: summary.tasks,
    completedTasks: summary.completedTasks,
    completionRate: summary.completionRate,
    counts: summary.counters,
    perCompletedTask: summary.perCompletedTask,
    fastPathComparison: comparison,
    parallelComparison: parallel,
    fixtureChecks: expectations.checked,
    failures,
  }
}

function scenarioFor(pass) {
  return {
    name: pass.name,
    tasks: pass.tasks,
    company: `ND Agent Task Fixture (${pass.name})`,
    mission: 'Measure what one agent task costs without contacting a model provider.',
    project: `Agent task fixture (${pass.name})`,
    objective: 'Run deterministic tasks through the production task path.',
    taskTitle: `Fixture task (${pass.name})`,
    taskDescription: pass.fastPath
      ? [
          'Inspect the fixture source using the deterministic typed fast path.',
          '<nd-dsh-fast-actions>',
          JSON.stringify({ version: 1, actions: [
            { verb: 'READ_FILE', params: { path: 'src/app.txt', maxBytes: 4096 }, writeScope: [] },
            { verb: 'SEARCH_CODE', params: { query: 'fixture application source', path: 'src', maxResults: 20 }, writeScope: [] },
            { verb: 'CHECK_GIT', params: { operation: 'status' }, writeScope: [] },
            { verb: 'DONE', params: { summary: 'Fixture source inspected and Git state checked.' }, writeScope: [] },
          ] }),
          '</nd-dsh-fast-actions>',
        ].join('\n')
      : `Deterministic fixture task for pass "${pass.name}". The fixture CLI reports ${pass.fixture.steps} model step(s) and ${pass.fixture.toolCalls} tool call(s).`,
    acceptanceCriteria: pass.readOnly
      ? ['The fixture source is inspected without mutation.', 'The project read-only test command decides the outcome.']
      : ['The fixture writes evidence/task-result.json in the task worktree.', 'The project test command decides the outcome.'],
    testCommand: pass.readOnly ? AGENT_TASK_READ_ONLY_TEST_COMMAND : AGENT_TASK_TEST_COMMAND,
    expected: pass.expected,
    ...(pass.fastPath ? { fastPath: true } : {}),
    ...(pass.parallel ? { parallel: true } : {}),
    ...(pass.cancelAfterRoundTrips === undefined ? {} : { cancelAfterRoundTrips: pass.cancelAfterRoundTrips }),
  }
}

async function writeShim(path, runtime) {
  const localFixture = join(dirname(path), 'agent-task-cli.mjs')
  await fs.copyFile(fixtureCliPath, localFixture)
  const content = process.platform === 'win32'
    ? `@echo off\r\nnode "%~dp0agent-task-cli.mjs" %*\r\n`
    : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${runtime}" "${localFixture}" "$@"\n`
  await fs.writeFile(path, content, 'utf8')
  if (process.platform !== 'win32') await fs.chmod(path, 0o755)
}

function runApp(env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(electronExecutable, [benchmarkRoot, '--disable-gpu'], {
      cwd: benchmarkRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk).slice(-20_000) })
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-20_000) })
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      reject(new Error('Agent-task benchmark timed out after 180000ms'))
    }, 180_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }) })
  })
}

function safeEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)) continue
    env[key] = value
  }
  return env
}

function readFlag(name) {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function relativeToRepo(path) {
  return resolve(path).slice(benchmarkRoot.length + 1).replaceAll('\\', '/')
}

/**
 * The §12.4 fast-path budgets, derived from the raw samples instead of trusted
 * from a stored summary. The matched `normal-read` and `fast-read` arms run in
 * the same recording, so the difference between them is attributable to the
 * router rather than to drift between recording days. Counters are means per
 * *verified completion*, never per attempt: a fast arm that completes less of
 * its work must not read as cheaper, which is also why the completion-rate
 * regression below is a failure rather than a warning.
 */
function compareFastPath(passes, samples) {
  const arm = (name) => {
    const pass = passes.find((entry) => entry.name === name)
    if (pass === undefined) return []
    const ids = new Set((pass.tasks ?? []).map((task) => task.runId))
    return samples.filter((sample) => ids.has(sample.runId))
  }
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const metrics = (items) => {
    const completed = items.filter((sample) => sample.completedTask === true)
    const perCompleted = (key) => mean(completed.map((sample) => sample[key]))
    return {
      samples: items.length,
      completed: completed.length,
      completionRate: items.length ? completed.length / items.length : 0,
      modelRoundTrips: perCompleted('modelRoundTrips'),
      toolCalls: perCompleted('toolCalls'),
      ipcCrossings: perCompleted('ipcCrossings'),
      escalations: perCompleted('escalations'),
    }
  }
  const normal = metrics(arm('normal-read'))
  const fast = metrics(arm('fast-read'))
  if (normal.completed === 0 || fast.completed === 0) {
    return {
      status: 'not-run',
      normal,
      fast,
      failures: ['the matched normal-read and fast-read arms did not both record a verified completion, so the §12.4 budgets were not measured'],
    }
  }
  const failures = []
  if (!(fast.modelRoundTrips < normal.modelRoundTrips)) failures.push('fast path did not reduce model round trips per verified completion')
  if (!(fast.toolCalls < normal.toolCalls)) failures.push('fast path did not reduce model-visible tool calls per verified completion')
  if (!(fast.ipcCrossings < normal.ipcCrossings)) failures.push('fast path did not reduce nd-core IPC crossings per verified completion')
  if (fast.completionRate < normal.completionRate) failures.push('fast path completion rate regressed')
  if (fast.escalations > 0.1) failures.push('fast path escalation rate exceeded the deterministic fixture budget')
  return { status: failures.length ? 'fail' : 'pass', normal, fast, failures }
}

/**
 * The concurrency budgets, derived from the recorded run intervals of the
 * matched `sequential-4x` and `parallel-4x` arms.
 *
 * The claim being tested is the one a user actually makes: "I handed ND several
 * tasks at once and they finished sooner than one after another." So the gate is
 * not a wall-clock threshold — those drift with the machine — but a ratio
 * computed inside each arm, plus the overlap observed between the recorded
 * intervals.
 *
 * `peakConcurrency` is reported as a measurement rather than a budget because it
 * is the product's decision, not the pass's: the execution pool defaults to two
 * workers per project, so four dispatched tasks legitimately overlap two at a
 * time. The floor below only has to refute the failure mode that matters, which
 * is a parallel arm that never ran anything concurrently at all.
 */
function compareParallel(passes, samples) {
  const arm = (name) => {
    const pass = passes.find((entry) => entry.name === name)
    if (pass === undefined) return []
    const ids = new Set((pass.tasks ?? []).map((task) => task.runId))
    return samples.filter((sample) => ids.has(sample.runId))
  }
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const metrics = (items) => {
    const completed = items.filter((sample) => sample.completedTask === true)
    return {
      ...summarizeParallelism(items),
      samples: items.length,
      completed: completed.length,
      completionRate: items.length ? completed.length / items.length : 0,
      modelRoundTrips: mean(completed.map((sample) => sample.modelRoundTrips)),
      toolCalls: mean(completed.map((sample) => sample.toolCalls)),
      ipcCrossings: mean(completed.map((sample) => sample.ipcCrossings)),
    }
  }
  const sequential = metrics(arm('sequential-4x'))
  const parallel = metrics(arm('parallel-4x'))
  const budgets = {
    speedupFloor: PARALLEL_SPEEDUP_FLOOR,
    ipcGrowthBudget: PARALLEL_IPC_GROWTH_BUDGET,
    minPeakConcurrency: 2,
  }
  if (sequential.completed === 0 || parallel.completed === 0) {
    return {
      status: 'not-run',
      sequential,
      parallel,
      budgets,
      failures: ['the matched sequential-4x and parallel-4x arms did not both record a verified completion, so the concurrency budgets were not measured'],
    }
  }
  const failures = []
  if (!(parallel.peakConcurrency >= budgets.minPeakConcurrency)) {
    failures.push(`no two tasks were ever in flight at the same instant (peak concurrency ${parallel.peakConcurrency}), so the parallel arm did not actually run in parallel`)
  }
  if (!(parallel.speedup >= PARALLEL_SPEEDUP_FLOOR)) {
    failures.push(`parallel speedup ${round(parallel.speedup)} is below the ${PARALLEL_SPEEDUP_FLOOR} floor (sequential arm measured ${round(sequential.speedup)})`)
  }
  if (!(parallel.spanMs < sequential.spanMs)) {
    failures.push(`dispatching four tasks together took ${Math.round(parallel.spanMs)}ms against ${Math.round(sequential.spanMs)}ms one after another`)
  }
  if (parallel.completionRate < sequential.completionRate) {
    failures.push('parallel dispatch regressed the completion rate, so the overlap was bought with unfinished work')
  }
  // Per-task boundary cost must not explode just because tasks share the process.
  // The ratio is only meaningful against a non-zero sequential denominator.
  if (sequential.ipcCrossings > 0 && parallel.ipcCrossings > sequential.ipcCrossings * PARALLEL_IPC_GROWTH_BUDGET) {
    failures.push(`per-task nd-core IPC crossings grew from ${round(sequential.ipcCrossings)} to ${round(parallel.ipcCrossings)}, beyond the ${PARALLEL_IPC_GROWTH_BUDGET}x concurrency budget`)
  }
  return { status: failures.length ? 'fail' : 'pass', sequential, parallel, budgets, failures }
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function rm(path) {
  await fs.rm(path, { recursive: true, force: true })
}

function fail(message) {
  process.stderr.write(message + '\n')
  process.exit(2)
}
