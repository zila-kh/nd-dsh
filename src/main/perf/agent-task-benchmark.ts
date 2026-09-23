import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { OPENCODE_CLI_ENGINE_ID } from '../../shared/extra-coding-engines.js'
import type { OrganizationSnapshot } from '../../shared/organization.js'
import type { CapabilityRegistry } from '../capabilities/capability-registry.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { TaskMetricsRecorder } from '../metrics/task-metrics.js'
import type { OrganizationOrchestrator } from '../organization/orchestrator.js'
import type { OrganizationStore } from '../organization/store.js'

/**
 * One measured agent task, driven through the product's own task path.
 *
 * Nothing here is a benchmark-only path: the driver creates organization
 * records through the same mutations the renderer uses and calls the real
 * `OrganizationOrchestrator.runTask`, which bootstrap already wrapped in the
 * organization IPC guard — the same dispatch, runtime permit and budget
 * accounting a user's "Run task" goes through. What differs from a user session
 * is only *which* engine the worker is assigned: a deterministic offline CLI
 * fixture selected through ND's documented `ND_DSH_OPENCODE_BINARY` developer
 * override, so task cost can be measured without a model provider and without
 * touching the product code being measured.
 *
 * The counters are not written here. They come from `TaskMetricsRecorder`,
 * which is always on in production and observes these same code paths.
 */

/** What the fixture declares it will do; every field is re-checked against the record. */
export interface AgentTaskBenchmarkExpectation {
  modelRoundTrips?: number
  toolCalls?: number
  escalations?: number
  verification?: 'passed' | 'failed' | 'skipped' | 'not-run'
  outcome?: 'completed' | 'failed' | 'canceled' | 'interrupted'
  completedTask?: boolean
  bytesToModelPositive?: boolean
  bytesToModelZero?: boolean
}

export interface AgentTaskBenchmarkScenario {
  /** Pass name, recorded in the raw file so samples keep their provenance. */
  name: string
  tasks: number
  company: string
  mission: string
  project: string
  objective: string
  taskTitle: string
  taskDescription: string
  acceptanceCriteria: string[]
  testCommand: string
  expected: AgentTaskBenchmarkExpectation
  /**
   * Cancel the task once this many model round trips have been reported. Used
   * by the pass that measures a task stopped early; the driver refuses to score
   * a task that finished before the cancellation instead of guessing.
   */
  cancelAfterRoundTrips?: number
  /** Use the production deterministic fast path instead of starting a coding engine. */
  fastPath?: boolean
  /**
   * Dispatch every task concurrently instead of one after another. A matched
   * sequential/parallel pair shares its fixture and task count, so the only
   * difference between the two arms is whether the product overlapped them.
   *
   * How many actually overlap is the product's decision, not this pass's: the
   * execution pool defaults to two workers per project, so an arm that dispatches
   * more tasks than that measures the real ceiling a user hits.
   */
  parallel?: boolean
}

export interface AgentTaskBenchmarkOptions {
  outputPath: string
  scenario: AgentTaskBenchmarkScenario
  store: OrganizationStore
  orchestrator: OrganizationOrchestrator
  engines: Pick<CodingEngineRegistry, 'assign' | 'assertAvailable'>
  capabilities: Pick<CapabilityRegistry, 'verify' | 'setEnabled'>
  recorder: TaskMetricsRecorder
  workspaceRoot: string
  log?: (line: string) => void
}

const RUN_SETTLE_TIMEOUT_MS = 120_000
const CANCEL_READY_TIMEOUT_MS = 30_000
const NO_RUN_GRACE_MS = 5_000
const POLL_MS = 50

/** The pass definition travels as JSON so the benchmark script owns the fixture. */
export function agentTaskBenchmarkScenarioFromEnv(value: string | undefined): AgentTaskBenchmarkScenario {
  const raw = value?.trim()
  if (!raw) throw new Error('Agent-task benchmark requires ND_DSH_AGENT_TASK_BENCH_SCENARIO.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('Agent-task benchmark scenario is not valid JSON: ' + errorMessage(error))
  }
  const scenario = parsed as Partial<AgentTaskBenchmarkScenario> | undefined
  if (!scenario?.name?.trim()) throw new Error('Agent-task benchmark scenario needs a name.')
  if (!Number.isInteger(scenario.tasks) || (scenario.tasks ?? 0) < 1) throw new Error('Agent-task benchmark scenario needs at least one task.')
  for (const key of ['company', 'mission', 'project', 'objective', 'taskTitle', 'taskDescription', 'testCommand'] as const) {
    if (!scenario[key]?.trim()) throw new Error(`Agent-task benchmark scenario is missing ${key}.`)
  }
  if (!Array.isArray(scenario.acceptanceCriteria) || !scenario.acceptanceCriteria.length) {
    throw new Error('Agent-task benchmark scenario needs acceptance criteria.')
  }
  const expected = scenario.expected as Record<string, unknown> | undefined
  if (!expected || typeof expected !== 'object') throw new Error('Agent-task benchmark scenario needs an expected document.')
  for (const key of ['modelRoundTrips', 'toolCalls', 'escalations'] as const) {
    const value = expected[key]
    if (value !== undefined && !Number.isInteger(value)) throw new Error(`Agent-task benchmark expectation ${key} must be an integer.`)
  }
  // A concurrency claim needs at least two tasks, and a cancellation pass waits
  // for one named task to reach a round-trip count before cancelling it. With
  // every task in flight at once there is no single "the task" to cancel, so the
  // two modes are alternatives rather than a combination.
  if (scenario.parallel && (scenario.tasks ?? 0) < 2) {
    throw new Error('Agent-task benchmark scenario needs at least two tasks to measure parallel dispatch.')
  }
  if (scenario.parallel && scenario.cancelAfterRoundTrips !== undefined) {
    throw new Error('Agent-task benchmark scenario cannot combine parallel dispatch with cancelAfterRoundTrips.')
  }
  return scenario as AgentTaskBenchmarkScenario
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runAgentTaskBenchmark(options: AgentTaskBenchmarkOptions): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line))
  const scenario = options.scenario
  // Normal passes use the deterministic CLI fixture. The fast-path pass must
  // prove that no coding/model engine needs to start at all.
  const engine = scenario.fastPath
    ? { id: 'nd-fast-path', name: 'ND Fast Path' }
    : options.engines.assertAvailable(OPENCODE_CLI_ENGINE_ID)

  const company = await options.store.mutate({
    type: 'company.create',
    name: scenario.company,
    mission: scenario.mission,
  })
  const companyId = company.activeCompanyId
  if (!companyId) throw new Error('Agent-task benchmark could not create its organization.')
  const withProject = await options.store.mutate({
    type: 'project.create',
    companyId,
    name: scenario.project,
    objective: scenario.objective,
    workspacePath: options.workspaceRoot,
    testCommand: scenario.testCommand,
  })
  const projectId = withProject.activeProjectId
  if (!projectId) throw new Error('Agent-task benchmark could not create its project.')
  // Execution without review: the reviewer's verdict is model judgment, and
  // what this benchmark measures is the worker loop plus machine verification.
  await options.store.mutate({
    type: 'workflow.create',
    companyId,
    name: 'Agent-task measurement (execute only)',
    steps: [{ id: 'execute', name: 'Assigned worker executes', kind: 'execute', requiredRole: 'Software Engineer' }],
  })

  if (!scenario.fastPath) {
    await options.engines.assign(workerAgentId(withProject), engine.id)
    await options.capabilities.verify(engine.id)
    const status = await options.capabilities.setEnabled(engine.id, true)
    if (!status.enabled) throw new Error(`Agent-task benchmark could not enable ${engine.name}.`)
  }
  log(`[agent-task] pass ${scenario.name}: engine ${engine.id} in ${options.workspaceRoot}`)

  // Every task is created before any of them is dispatched, so a matched
  // sequential/parallel pair differs in dispatch order alone rather than in how
  // much organization setup each arm happened to overlap with.
  const created: Array<{ taskId: string; title: string }> = []
  for (let index = 0; index < scenario.tasks; index += 1) {
    const withTask = await options.store.mutate({
      type: 'task.create',
      companyId,
      projectId,
      title: `${scenario.taskTitle} ${index + 1}`,
      description: scenario.taskDescription,
      acceptanceCriteria: scenario.acceptanceCriteria,
    })
    const task = withTask.tasks.filter((item) => item.projectId === projectId).at(-1)
    if (!task) throw new Error('Agent-task benchmark could not create its task.')
    created.push({ taskId: task.id, title: task.title })
  }

  const dispatched = scenario.parallel
    ? await dispatchConcurrently(options, created, log)
    : await dispatchSequentially(options, created, log)

  const recorded = options.recorder.samples()
  const tasks: AgentTaskBenchmarkTask[] = created.map((item, index) => {
    const runId = dispatched[index]
    if (runId === undefined) throw new Error(`Agent-task benchmark recorded no run for task ${item.taskId}.`)
    const sample = recorded.find((entry) => entry.runId === runId)
    if (!sample) throw new Error(`Agent-task benchmark recorded no sample for run ${runId}.`)
    return {
      taskId: item.taskId,
      runId,
      title: item.title,
      expected: scenario.expected,
      observed: {
        modelRoundTrips: sample.modelRoundTrips,
        toolCalls: sample.toolCalls,
        escalations: sample.escalations,
        bytesToModel: sample.bytesToModel,
        tokensToModel: sample.tokensToModel,
        ipcCrossings: sample.ipcCrossings,
        verification: sample.verification,
        outcome: sample.outcome,
        completedTask: sample.completedTask,
      },
    }
  })

  const runIds = new Set(tasks.map((item) => item.runId))
  const samples = recorded.filter((item) => runIds.has(item.runId))
  await writeJson(options.outputPath, {
    schemaVersion: 1,
    kind: 'nd-agent-task-raw',
    pass: scenario.name,
    scenario,
    engine: { id: engine.id, name: engine.name },
    workspaceRoot: options.workspaceRoot,
    platform: process.platform,
    arch: process.arch,
    droppedSamples: options.recorder.droppedSampleCount(),
    tasks,
    samples,
  })
  log(`[agent-task] pass ${scenario.name}: ${samples.length} sample(s) written to ${options.outputPath}`)
}

/**
 * A human-readable copy of the record for this task. It is not the source of
 * truth: `--verify` re-reads the samples, so a stale copy here can never make a
 * task look cheaper than it was.
 */
export interface AgentTaskBenchmarkTask {
  taskId: string
  runId: string
  title: string
  expected: AgentTaskBenchmarkExpectation
  observed: {
    modelRoundTrips: number
    toolCalls: number
    escalations: number
    bytesToModel: number
    tokensToModel: number
    ipcCrossings: number
    verification: string
    outcome: string
    completedTask: boolean
  }
}

/**
 * The sequential arm: one task settles before the next is dispatched, so the
 * pass measures a single task's cost with nothing else competing for the
 * scheduler, the journal or the main-process event loop.
 */
async function dispatchSequentially(
  options: AgentTaskBenchmarkOptions,
  created: ReadonlyArray<{ taskId: string; title: string }>,
  log: (line: string) => void,
): Promise<string[]> {
  const runIds: string[] = []
  for (const item of created) runIds.push(await dispatchTask(options, item.taskId, log))
  return runIds
}

type ConcurrentDispatch =
  | { ok: true; taskId: string; runId: string }
  | { ok: false; taskId: string; error: string }

/**
 * The parallel arm: every task is handed to the product at once, and the arm
 * reports what the product did with them. How many actually overlap is decided
 * by the execution pool rather than here, so a pass that dispatched four tasks
 * but only ever ran two is reporting the real ceiling a user hits instead of a
 * number this file chose.
 *
 * Each dispatch is settled independently, so one refused or failed task is
 * reported as the measured outcome it is rather than aborting the arm and
 * discarding the runs that did complete.
 */
async function dispatchConcurrently(
  options: AgentTaskBenchmarkOptions,
  created: ReadonlyArray<{ taskId: string; title: string }>,
  log: (line: string) => void,
): Promise<string[]> {
  log(`[agent-task] pass ${options.scenario.name}: dispatching ${created.length} task(s) concurrently`)
  const settled: ConcurrentDispatch[] = await Promise.all(created.map(async (item): Promise<ConcurrentDispatch> => {
    try {
      return { ok: true, taskId: item.taskId, runId: await dispatchTask(options, item.taskId, log) }
    } catch (error) {
      return { ok: false, taskId: item.taskId, error: errorMessage(error) }
    }
  }))
  const failures = settled.flatMap((entry) => entry.ok ? [] : [`${entry.taskId}: ${entry.error}`])
  if (failures.length) {
    throw new Error(`Agent-task benchmark parallel pass could not settle ${failures.length} task(s): ${failures.join('; ')}`)
  }
  return settled.flatMap((entry) => entry.ok ? [entry.runId] : [])
}

/**
 * Dispatch one task through the product's own dispatch entry point.
 *
 * `orchestrator.runTask` is the *guarded* method: bootstrap wraps it with the
 * organization IPC guard, which acquires the runtime permit, runs the task
 * inside it — that is what makes the core RPCs of this task attributable to it,
 * so `ipcCrossings` is a per-task measurement — records the dispatch against the
 * company's turn budget, and releases the permit when the run settles. The
 * benchmark deliberately does not acquire a second permit of its own; it would
 * double-count capacity and change the thing being measured.
 *
 * A task that fails is a measured outcome, not a benchmark failure: the run
 * record and its sample are still read back and scored, which is exactly how a
 * "cheap because it stopped early" claim would otherwise go unnoticed.
 */
async function dispatchTask(
  options: AgentTaskBenchmarkOptions,
  taskId: string,
  log: (line: string) => void,
): Promise<string> {
  let dispatchError: string | undefined
  try {
    const dispatch = options.orchestrator.runTask(taskId, true)
    if (options.scenario.cancelAfterRoundTrips !== undefined) {
      await cancelMidTask(options, taskId, options.scenario.cancelAfterRoundTrips)
    }
    await dispatch
  } catch (error) {
    dispatchError = errorMessage(error)
    log(`[agent-task] task ${taskId} execution reported: ${dispatchError}`)
  }
  return await waitForExecutionRun(options, taskId, log, dispatchError)
}

/**
 * Cancel one task through the product's own `cancelRun`, once the engine has
 * reported the requested progress. Cancelling on observed progress rather than
 * on a timer is what keeps "stopped early" a deterministic outcome instead of
 * a race against a fast fixture.
 */
async function cancelMidTask(options: AgentTaskBenchmarkOptions, taskId: string, roundTrips: number): Promise<void> {
  const deadline = Date.now() + CANCEL_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const sample = options.recorder.samples().find((item) => item.taskId === taskId && !item.finished)
    if (sample && sample.modelRoundTrips >= roundTrips) break
    await sleep(POLL_MS)
  }
  const active = (await options.store.state()).runs.find((item) => item.taskId === taskId && item.kind === 'task-execution' && item.status === 'running')
  if (!active) throw new Error(`Agent-task benchmark could not cancel task ${taskId}: its run finished before the cancellation was issued.`)
  await options.orchestrator.cancelRun(active.id)
}

/**
 * `runTask` returns when the engine turn ends; the run record reaches its
 * terminal state on the organization event stream shortly after. Waiting for
 * the record (not a fixed sleep) is what keeps a task's sample closed before it
 * is read, and a run that never settles fails the pass loudly.
 */
async function waitForExecutionRun(
  options: AgentTaskBenchmarkOptions,
  taskId: string,
  log: (line: string) => void,
  dispatchError?: string,
): Promise<string> {
  const deadline = Date.now() + RUN_SETTLE_TIMEOUT_MS
  const startedAt = Date.now()
  while (Date.now() < deadline) {
    const state = await options.store.state()
    const run = state.runs.find((item) => item.taskId === taskId && item.kind === 'task-execution')
    if (run && run.status !== 'running') {
      const task = state.tasks.find((item) => item.id === taskId)
      log(`[agent-task] run ${run.status} (${run.error ?? 'no error'}); task ${task?.status ?? 'unknown'}`)
      return run.id
    }
    // A task that never started is a broken pass, not a slow one: report the
    // reason the dispatch gave instead of waiting out the timeout.
    if (dispatchError && !run && Date.now() - startedAt > NO_RUN_GRACE_MS) {
      throw new Error(`Agent-task benchmark could not start a run for task ${taskId}: ${dispatchError}`)
    }
    await sleep(POLL_MS)
  }
  throw new Error(`Agent-task benchmark timed out waiting for task ${taskId} to reach a terminal state.`)
}

function workerAgentId(state: OrganizationSnapshot): string {
  const agent = state.agents.find((item) => /engineer/i.test(roleName(state, item.roleId) ?? '')) ?? state.agents[0]
  if (!agent) throw new Error('Agent-task benchmark found no worker agent in its organization.')
  return agent.id
}

function roleName(state: OrganizationSnapshot, roleId: string): string | undefined {
  return state.roles.find((item) => item.id === roleId)?.name
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = path + '.tmp-' + process.pid
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await fs.rename(temp, path)
}
