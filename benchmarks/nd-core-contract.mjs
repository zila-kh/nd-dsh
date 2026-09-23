/**
 * Runtime contract measurements for the nd-core sidecar contract work.
 *
 * This suite exists to turn three claims into numbers instead of assertions:
 *
 * 1. A revision marker is cheap enough to guard a read (workspace.revision).
 * 2. The revision-keyed cache actually avoids redundant work (git.status, git.log),
 *    and an external mutation invalidates it rather than serving stale state.
 * 3. Bounded content search has a measured latency and result size, and reports
 *    truncation instead of quietly capping a result.
 *
 * Usage: node benchmarks/nd-core-contract.mjs [--keep]
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { CoreRpc, benchmarkRoot } from './lib/core-rpc.mjs'
import { summarize } from './lib/metrics.mjs'
import { defaultOutputDir, writeResult, writeSummary } from './lib/results.mjs'

const execFileAsync = promisify(execFile)
const outputDir = defaultOutputDir()
const results = []
const failures = []
const temporary = []
const check = (condition, message) => { if (!condition) failures.push(message) }

const repeatCount = Number.parseInt(process.env.ND_DSH_CONTRACT_REPEATS || '9', 10)

async function tempDir(prefix) {
  const path = await mkdtemp(join(tmpdir(), prefix))
  temporary.push(path)
  return path
}

async function git(cwd, args) {
  return await execFileAsync('git', args, { cwd, windowsHide: true })
}

/** A repository with committed, modified, untracked, and ignored content. */
async function makeFixture() {
  const root = await tempDir('nd-dsh-contract-fixture-')
  await git(root, ['init', '--quiet', '--initial-branch=main'])
  await git(root, ['config', 'user.email', 'bench@example.test'])
  await git(root, ['config', 'user.name', 'ND Contract Benchmark'])
  await git(root, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(root, '.gitignore'), 'ignored/\nnode_modules/\n')
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'ignored'))
  for (let index = 0; index < 120; index += 1) {
    await writeFile(
      join(root, 'src', `module-${String(index).padStart(3, '0')}.ts`),
      `export function needle${index}(): number {\n  return ${index}\n}\n`,
    )
  }
  await writeFile(join(root, 'ignored', 'secret.ts'), 'export const hidden = "needle"\n')
  await git(root, ['add', '.'])
  await git(root, ['commit', '--quiet', '-m', 'fixture'])
  for (let index = 0; index < 15; index += 1) {
    await writeFile(join(root, 'src', `module-${String(index).padStart(3, '0')}.ts`), `export function needle${index}(): number {\n  return ${index + 1000}\n}\n`)
  }
  await writeFile(join(root, 'src', 'untracked.ts'), 'export const untracked = "needle"\n')
  return root
}

async function measure(operation, runs = repeatCount) {
  const samples = []
  let last
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now()
    last = await operation(index)
    samples.push(performance.now() - started)
  }
  return { samples, summary: summarize(samples), last }
}

async function benchmarkRevisionMarker(client, fixture) {
  const root = fixture
  const single = await measure(async () => await client.request('workspace.revision', { root }))
  const refs = await measure(async () => await client.request('workspace.revision', { root, scope: 'gitRefs' }))
  check(single.last && new Set(single.samples).size > 0, 'workspace.revision produced no samples')
  const stable = single.last.value
  const again = await client.request('workspace.revision', { root })
  check(again.value === stable, 'the revision marker moved without any state change')
  await writeFile(join(root, 'src', 'untracked.ts'), 'export const untracked = "needle changed"\n')
  const moved = await client.request('workspace.revision', { root })
  check(moved.value !== stable, 'the revision marker did not move after an external edit')
  const stillRefs = await client.request('workspace.revision', { root, scope: 'gitRefs' })
  check(stillRefs.value === refs.last.value, 'a worktree edit moved the refs-only marker')
  return {
    worktreeMs: single.summary,
    gitRefsMs: refs.summary,
    entries: moved.entries,
    movedOnExternalEdit: moved.value !== stable,
    refsUnaffectedByWorktreeEdit: stillRefs.value === refs.last.value,
  }
}

/**
 * `git.status` is the read the product repeats most: `GitService.refresh()` runs it
 * on every workspace event, every git action, and every engine turn. The cache
 * should serve every repeat of an unchanged revision without spawning git again.
 */
async function benchmarkGitStatusCache(client, fixture) {
  const cold = await client.request('git.status', { cwd: fixture })
  const coldRevision = cold.revision
  const warm = await measure(async () => await client.request('git.status', { cwd: fixture }))
  const served = warm.samples.length
  check(warm.last.cached === true, 'a repeated git.status was not served from the cache')
  check(warm.last.revision === coldRevision, 'the cached git.status described a different revision')
  check(warm.last.entries.length === cold.entries.length, 'the cached git.status returned a different entry set')

  const uncached = await measure(async () => await client.request('git.status', { cwd: fixture }), 3)
  const externalFile = join(fixture, 'src', 'external.ts')
  await writeFile(externalFile, 'export const external = "needle"\n')
  const afterMutation = await client.request('git.status', { cwd: fixture })
  check(afterMutation.cached === false, 'an external mutation was served from the cache')
  check(afterMutation.revision !== coldRevision, 'an external mutation kept the previous revision')
  check(
    afterMutation.entries.some((entry) => entry.path === 'src/external.ts'),
    'the post-mutation git.status did not see the externally created file',
  )

  return {
    coldMs: cold.durationMs,
    warmMs: warm.summary,
    cachedResponses: served,
    revisionChecks: uncached.samples.length,
    invalidatedOnExternalMutation: afterMutation.cached === false && afterMutation.revision !== coldRevision,
    entries: afterMutation.entries.length,
  }
}

async function benchmarkGitLogCache(client, fixture) {
  const cold = await client.request('git.log', { cwd: fixture, limit: 8 })
  const warm = await measure(async () => await client.request('git.log', { cwd: fixture, limit: 8 }))
  check(warm.last.cached === true, 'a repeated git.log was not served from the cache')
  check(warm.last.commits.length === cold.commits.length, 'the cached git.log returned a different history')
  await writeFile(join(fixture, 'src', 'committed-change.ts'), 'export const changed = 1\n')
  await git(fixture, ['add', '.'])
  await git(fixture, ['commit', '--quiet', '-m', 'external commit'])
  const afterCommit = await client.request('git.log', { cwd: fixture, limit: 8 })
  check(afterCommit.cached === false, 'an external commit was served from the cache')
  check(afterCommit.commits.length === cold.commits.length + 1, 'an external commit was not visible')
  return {
    coldMs: cold.durationMs,
    warmMs: warm.summary,
    cachedResponses: warm.samples.length,
    invalidatedOnExternalCommit: afterCommit.cached === false,
  }
}

async function benchmarkSearch(client, fixture) {
  const complete = await measure(async () => await client.request('workspace.search', { root: fixture, query: 'needle', maxResults: 5000 }))
  const last = complete.last
  check(last.truncated === false, 'an uncapped search over a small fixture reported truncation')
  check(last.stopReason === undefined, 'a complete search reported a stop reason')
  const paths = new Set(last.matches.map((match) => match.path))
  check([...paths].every((path) => !path.startsWith('ignored/')), 'search returned matches from an ignored path')

  const capped = await client.request('workspace.search', { root: fixture, query: 'needle', maxResults: 5 })
  check(capped.truncated === true, 'a capped search did not report truncation')
  check(capped.stopReason === 'resultLimit', 'a capped search did not name its stop reason: ' + capped.stopReason)
  check(capped.matches.length === 5, 'a capped search returned the wrong number of matches')

  const regex = await client.request('workspace.search', { root: fixture, query: 'needle\\d+', regex: true, maxResults: 5 })
  check(regex.matches.length > 0, 'a regex search found nothing')
  const payloadBytes = Buffer.byteLength(JSON.stringify(complete.last), 'utf8')

  return {
    completeMs: complete.summary,
    matches: last.matches.length,
    scannedFiles: last.scannedFiles,
    skippedBinaryFiles: last.skippedBinaryFiles,
    resultBytes: payloadBytes,
    capped: { truncated: capped.truncated, stopReason: capped.stopReason, returned: capped.matches.length },
    regexMatches: regex.matches.length,
    limits: last.limits,
  }
}

/**
 * How fast a stop actually lands. The same interrupt path serves a client cancel and
 * a core deadline, so measuring the cancel round trip measures both, and the
 * dispatcher slot is checked afterwards to prove the stopped request gave it back.
 */
async function benchmarkStopLatency(client) {
  const requestId = 'bench-stop-' + Date.now()
  const started = performance.now()
  const pending = client.request('git.exec', {
    cwd: benchmarkRoot,
    args: ['-e', 'setTimeout(() => {}, 60000)'],
    gitPath: process.execPath,
    maxOutputBytes: 64 * 1024,
  }, 60_000, { requestId }).then((value) => ({ value }), (error) => ({ error: error.message }))
  // Give the request time to reach the sidecar and start its child.
  await new Promise((resolve) => setTimeout(resolve, 400))
  const inFlight = await client.request('metrics.snapshot', {})
  const cancelStarted = performance.now()
  const canceled = await client.request('core.cancel', { requestId })
  const settled = await pending
  const stopMs = performance.now() - cancelStarted
  const sinceStartMs = performance.now() - started
  check('error' in settled, 'a canceled git.exec reported success')
  check(
    String(settled.error).includes('canceled') || String(settled.error).includes('deadline'),
    'a canceled git.exec reported the wrong failure: ' + settled.error,
  )
  const after = await client.request('metrics.snapshot', {})
  check(
    after.dispatcher.active <= 1 && after.inFlightRequestCount <= 1,
    'the stopped request kept its dispatcher slot: ' + JSON.stringify({ dispatcher: after.dispatcher, inFlight: after.inFlightRequestCount }),
  )
  return {
    // The cancellable-latency number is cancel-to-settle; `sinceStartMs` includes the
    // deliberate wait that let the child process start.
    cancelToStopMs: stopMs,
    sinceRequestStartMs: sinceStartMs,
    canceledAccepted: canceled.canceled === true,
    inFlightDuringRun: inFlight.inFlightRequestCount,
    activeAfterStop: after.dispatcher.active,
    failure: settled.error,
  }
}

/**
 * The same stop, driven by the core's own deadline rather than by a cancel: the
 * caller never cancels, and the request still has to end on its own.
 */
async function benchmarkDeadlineExpiry(client) {
  const started = performance.now()
  const settled = await client.request('git.exec', {
    cwd: benchmarkRoot,
    args: ['-e', 'setTimeout(() => {}, 60000)'],
    gitPath: process.execPath,
    maxOutputBytes: 64 * 1024,
  }, 30_000, { deadlineMs: 800 }).then((value) => ({ value }), (error) => ({ error: error.message }))
  const elapsedMs = performance.now() - started
  check('error' in settled, 'an expired core deadline reported success')
  check(String(settled.error).includes('deadline'), 'an expired core deadline reported the wrong failure: ' + settled.error)
  check(elapsedMs < 10_000, 'an 800 ms deadline took ' + Math.round(elapsedMs) + ' ms to stop')
  const after = await client.request('metrics.snapshot', {})
  check(after.inFlightRequestCount <= 1, 'the expired request kept its slot')
  return { deadlineMs: 800, elapsedMs, failure: settled.error, activeAfterStop: after.dispatcher.active }
}

async function benchmarkEffectJournal(client) {
  const dir = await tempDir('nd-dsh-effect-journal-')
  const path = join(dir, 'effects.jsonl')
  await client.request('effectJournal.configure', { path })

  const append = await measure(async (index) => await client.request('effectJournal.append', {
    kind: 'benchmark.effect',
    state: 'complete',
    companyId: 'bench-company',
    projectId: 'bench-project',
    taskId: 'bench-task',
    runId: 'bench-run',
    idempotencyKey: 'bench-effect-' + index,
    data: { index },
  }))
  const beforeDuplicate = await client.request('effectJournal.stats', {})
  const duplicate = await client.request('effectJournal.append', {
    kind: 'benchmark.effect',
    state: 'intent',
    idempotencyKey: 'bench-effect-0',
  })
  const afterDuplicate = await client.request('effectJournal.stats', {})
  check(duplicate.duplicate === true, 'known-complete effect was not deduplicated')
  check(afterDuplicate.recordCount === beforeDuplicate.recordCount, 'duplicate known-complete effect grew the journal')

  await client.request('effectJournal.append', {
    kind: 'benchmark.uncertain',
    state: 'uncertain',
    idempotencyKey: 'bench-uncertain',
  })
  const uncertain = await client.request('effectJournal.state', { idempotencyKey: 'bench-uncertain' })
  check(uncertain.state === 'outcomeUncertain', 'uncertain effect lost recovery state')

  const replay = await measure(async () => await client.request('effectJournal.replay', {
    afterSeq: 0,
    limit: 1000,
  }))
  return {
    appendMs: append.summary,
    replayMs: replay.summary,
    recordCount: afterDuplicate.recordCount + 1,
    bytes: afterDuplicate.bytes,
    duplicateSuppressed: duplicate.duplicate === true,
    uncertainState: uncertain.state,
    replayed: replay.last.records.length,
  }
}

async function benchmarkDecisionKernel(client) {
  const low = {
    provider: 'laya',
    ok: true,
    result: {
      provider: 'laya',
      model: 'english',
      answers: {
        route: { type: 'choice', choice: 'standard', confidence: 0.51 },
      },
      latencyMs: 1,
      minimumConfidence: 0.51,
    },
  }
  const high = {
    provider: 'jev',
    ok: true,
    result: {
      provider: 'jev',
      model: 'jev-latest',
      answers: {
        route: { type: 'choice', choice: 'deep', confidence: 0.91 },
      },
      latencyMs: 2,
      minimumConfidence: 0.91,
    },
  }
  const first = await client.request('decision.evaluate', {
    purpose: 'review-assist',
    mode: 'assist',
    threshold: 0.78,
    providerCount: 2,
    attempts: [low],
  })
  check(first.shouldContinue === true, 'low-confidence Laya did not request escalation')
  check(first.receipt.escalated === true, 'decision receipt did not record escalation')

  const measured = await measure(async () => await client.request('decision.evaluate', {
    purpose: 'review-assist',
    mode: 'assist',
    threshold: 0.78,
    providerCount: 2,
    attempts: [low, high],
  }))
  check(measured.last.shouldContinue === false, 'high-confidence Jev did not stop cascade')
  check(measured.last.receipt.selectedProvider === 'jev', 'Rust kernel selected the wrong provider')
  return {
    evaluateMs: measured.summary,
    selectedProvider: measured.last.receipt.selectedProvider,
    escalated: measured.last.receipt.escalated,
  }
}

try {
  const fixture = await makeFixture()
  const client = await CoreRpc.launch()
  try {
    results.push(await writeResult(outputDir, 'contract-revision-marker', await benchmarkRevisionMarker(client, fixture)))
    results.push(await writeResult(outputDir, 'contract-git-status-cache', await benchmarkGitStatusCache(client, fixture)))
    results.push(await writeResult(outputDir, 'contract-git-log-cache', await benchmarkGitLogCache(client, fixture)))
    results.push(await writeResult(outputDir, 'contract-search', await benchmarkSearch(client, fixture)))
    results.push(await writeResult(outputDir, 'contract-stop-latency', await benchmarkStopLatency(client)))
    results.push(await writeResult(outputDir, 'contract-deadline-expiry', await benchmarkDeadlineExpiry(client)))
    results.push(await writeResult(outputDir, 'contract-effect-journal', await benchmarkEffectJournal(client)))
    results.push(await writeResult(outputDir, 'contract-decision-kernel', await benchmarkDecisionKernel(client)))
    const metrics = await client.request('metrics.snapshot', {})
    check(metrics.cache.hits >= 1, 'the cache reported no hits after cached reads')
    check(metrics.cache.entries >= 1, 'the cache reported no entries after cached reads')
    results.push(await writeResult(outputDir, 'contract-cache-metrics', {
      cache: metrics.cache,
      inFlightRequestCount: metrics.inFlightRequestCount,
      retainedTerminalBufferBytes: metrics.retainedTerminalBufferBytes,
    }))
  } finally {
    await client.close()
  }
  const summary = await writeSummary(outputDir, results, failures)
  console.log(JSON.stringify({
    outputDir,
    status: summary.status,
    failures,
    contracts: Object.fromEntries(results.map((item) => [item.benchmark, item])),
  }, null, 2))
  if (failures.length) process.exitCode = 1
} finally {
  if (process.env.ND_DSH_BENCH_KEEP === '1') console.log('kept fixtures: ' + temporary.join(', '))
  else await Promise.allSettled(temporary.map((path) => rm(path, { recursive: true, force: true })))
}
