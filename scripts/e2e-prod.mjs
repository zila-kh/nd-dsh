/**
 * Local production validation entry point for ND's E2E layers.
 *
 * Runs the full local matrix in attribution order — a multi-company
 * correctness regression and a provider outage must never share a stage, so
 * each stage stops the chain and its result is reported independently:
 *
 *   build
 *     -> e2e:portfolio            (layer 1: deterministic isolation, offline)
 *     -> e2e:portfolio:models     (layer 2: live 3-model portfolio)
 *     -> e2e:prod:user            (real-user production journey, Phases A-F)
 *     -> e2e:models               (layer 3: autonomous multi-model stress loop)
 *
 * No GitHub Actions: validation for this line of work is local/manual and the
 * stage table printed at the end is the authoritative result record.
 *
 * Usage: corepack pnpm e2e:prod
 */
import { spawnSync } from 'node:child_process'

const STAGES = [
  { name: 'build', script: 'build' },
  { name: 'layer 1 — deterministic portfolio isolation', script: 'e2e:portfolio' },
  { name: 'layer 2 — live 3-model portfolio', script: 'e2e:portfolio:models' },
  { name: 'real-user production journey (Phases A-F)', script: 'e2e:prod:user' },
  { name: 'layer 3 — autonomous multi-model stress loop', script: 'e2e:models' },
]

function runStage(script) {
  const args = ['run', script]
  const pnpmEntrypoint = process.env.npm_execpath
  if (pnpmEntrypoint) {
    // Invoked through pnpm/corepack: reuse the exact same package runner.
    return spawnSync(process.execPath, [pnpmEntrypoint, ...args], { stdio: 'inherit', env: process.env })
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })
}

const results = []
let failedStage = null

for (const stage of STAGES) {
  console.log(`\n=== e2e:prod stage — ${stage.name} (${stage.script}) ===`)
  const started = Date.now()
  const outcome = runStage(stage.script)
  const durationSeconds = Math.round((Date.now() - started) / 1_000)
  const status = outcome.status === 0 ? 'pass' : `fail(exit ${outcome.status ?? 'signal'})`
  results.push({ stage: stage.name, script: stage.script, status, durationSeconds })
  if (outcome.status !== 0) {
    failedStage = stage.script
    break
  }
}

console.log('\n=== e2e:prod stage results ===')
for (const row of results) {
  console.log(`  ${row.status.padEnd(16)} ${row.script.padEnd(24)} ${row.durationSeconds}s  ${row.stage}`)
}
const skipped = STAGES.slice(results.length)
if (skipped.length) {
  console.log(`  ${'not-run'.padEnd(16)} ${'(stopped after failure of ' + failedStage + ')'.padEnd(24)}`)
  for (const stage of skipped) console.log(`  ${'not-run'.padEnd(16)} ${stage.script.padEnd(24)} ${stage.name}`)
}

process.exitCode = failedStage ? (results.at(-1)?.status.startsWith('fail') ? Number(/\d+/.exec(results.at(-1).status)?.[0] ?? 1) || 1 : 1) : 0
