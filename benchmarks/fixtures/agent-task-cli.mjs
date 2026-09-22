#!/usr/bin/env node
/**
 * Deterministic offline coding-CLI fixture for agent-task measurement.
 *
 * It stands in for a user-installed coding CLI (the same way
 * `synthetic-worker.mjs` stands in for a worker process): ND selects it through
 * the documented `ND_DSH_OPENCODE_BINARY` developer override, spawns it through
 * the real `StructuredCliEngine` adapter and reads the real OpenCode JSON wire
 * from its stdout. No model provider is contacted, so the task loop, the
 * machine verification and the cost counters are reproducible offline.
 *
 * Scenario knobs arrive through the environment so the deterministic workload
 * is independent of prompt wording. Windows npm-style shims are resolved to
 * their Node entrypoint by ND, so real multi-line prompts remain intact.
 *
 *   ND_TASK_FIXTURE_STEPS      model calls the CLI reports (default 3)
 *   ND_TASK_FIXTURE_TOOLS      tool calls the CLI reports (default 4)
 *   ND_TASK_FIXTURE_STEP_MS    artificial per-step delay (default 0)
 *   ND_TASK_FIXTURE_VERIFY     pass | fail — what the workspace evidence says
 *   ND_TASK_FIXTURE_FAIL       1 — report an agent error instead of finishing
 *
 * Every reported model call carries fixed usage, so a recorded round-trip count
 * and token total are properties of the fixture, not of a model's behaviour.
 *
 * The wire shape is OpenCode's: one JSON object per stdout line.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const STEPS = integer(process.env.ND_TASK_FIXTURE_STEPS, 3)
const TOOLS = integer(process.env.ND_TASK_FIXTURE_TOOLS, 4)
const STEP_MS = integer(process.env.ND_TASK_FIXTURE_STEP_MS, 0)
const VERIFY = process.env.ND_TASK_FIXTURE_VERIFY === 'fail' ? 'fail' : 'pass'
const FAIL_RUN = process.env.ND_TASK_FIXTURE_FAIL === '1'
const READ_ONLY = process.env.ND_TASK_FIXTURE_READ_ONLY === '1'
const INPUT_TOKENS_PER_STEP = 1000
const OUTPUT_TOKENS_PER_STEP = 50
const cwd = process.cwd()

const emit = (value) => { process.stdout.write(JSON.stringify(value) + '\n') }

emit({ sessionID: 'fixture-session', type: 'session' })

let toolsEmitted = 0
for (let step = 1; step <= STEPS; step += 1) {
  if (STEP_MS > 0) await sleep(STEP_MS)
  emit({ type: 'text', part: { text: `fixture step ${step}/${STEPS}\n` } })
  emit({ type: 'step_finish', part: { tokens: { input: INPUT_TOKENS_PER_STEP, output: OUTPUT_TOKENS_PER_STEP } } })
  const toolsDue = Math.floor((TOOLS * step) / STEPS)
  while (toolsEmitted < toolsDue) {
    toolsEmitted += 1
    const callId = `fixture-tool-${toolsEmitted}`
    emit({ type: 'tool_use', part: { callID: callId, tool: 'read', state: { status: 'running', input: { path: 'src/worker-output.txt' } } } })
    emit({ type: 'tool_use', part: { callID: callId, tool: 'read', state: { status: 'completed', input: { path: 'src/worker-output.txt' }, output: 'fixture tool output' } } })
  }
}

if (FAIL_RUN) {
  emit({ type: 'error', error: 'fixture engine reported a deterministic task failure' })
  process.exitCode = 1
} else if (!READ_ONLY) {
  // The work a mutating worker would leave behind: a source change plus the
  // evidence file the project's machine verification reads.
  await mkdir(join(cwd, 'src'), { recursive: true })
  await mkdir(join(cwd, 'evidence'), { recursive: true })
  await writeFile(join(cwd, 'src', 'worker-output.txt'), `fixture worker output\nsteps=${STEPS}\ntools=${TOOLS}\n`, 'utf8')
  await writeFile(
    join(cwd, 'evidence', 'task-result.json'),
    JSON.stringify({ ok: VERIFY === 'pass', steps: STEPS, tools: TOOLS, verify: VERIFY }, null, 2) + '\n',
    'utf8',
  )
}

function integer(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
