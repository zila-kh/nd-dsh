const MIB = 1024 * 1024

/**
 * Which backend must have produced each evidence document. Identity is checked
 * before the numbers are trusted: a legacy/rust pair that is swapped, or a pair
 * whose runs used different nd-core executables, satisfies every relative
 * budget in both directions, so the labels - not the deltas - are what refute
 * it. Every check carries a `kind` so a reader (and the failure list) can tell
 * an identity mismatch from a budget violation.
 */
const EXPECTED_BACKENDS = {
  coreSummary: 'rust-core',
  rustRuntime: 'rust-core',
  packagedStartup: 'rust-core',
}

export function evaluateEvidence({ coreSummary, rustRuntime, packagedStartup }) {
  const checks = []
  const observations = []

  const add = (id, label, passed, actual, budget, detail, kind = 'budget') => {
    checks.push({ id, kind, label, passed: Boolean(passed), actual: finiteOrValue(actual), budget, ...(detail ? { detail } : {}) })
  }
  const requireNumber = (id, label, value, predicate, budget, detail) => {
    add(id, label, Number.isFinite(value) && predicate(value), Number.isFinite(value) ? value : null, budget, detail)
  }

  const evidence = { coreSummary, rustRuntime, packagedStartup }
  const backendMismatches = Object.entries(EXPECTED_BACKENDS)
    .filter(([document, expected]) => evidence[document]?.backend !== expected)
    .map(([document, expected]) => document + ' is labelled backend=' + JSON.stringify(evidence[document]?.backend ?? null) + ', expected ' + JSON.stringify(expected))
  add(
    'backend-identity',
    'Every document is labelled with the backend that produced it',
    backendMismatches.length === 0,
    backendMismatches,
    'core/runtime/packaged = rust-core',
    'Release evidence must identify the single production backend before numeric budgets are trusted.',
    'identity',
  )

  const coreHashes = Object.entries(evidence)
    .map(([document, item]) => ({ document, sha256: typeof item?.ndCore?.sha256 === 'string' ? item.ndCore.sha256.toLowerCase() : null, source: item?.ndCore?.source ?? null }))
  const missingHashes = ['coreSummary', 'rustRuntime', 'packagedStartup']
    .filter((document) => coreHashes.find((entry) => entry.document === document)?.sha256 === null)
  const distinctHashes = [...new Set(coreHashes.map((entry) => entry.sha256).filter((value) => value !== null))]
  add(
    'core-binary-identity',
    'Rust evidence names one nd-core executable',
    missingHashes.length === 0 && distinctHashes.length === 1,
    { hashes: coreHashes, distinct: distinctHashes.length, missing: missingHashes },
    'one sha256 across core, rust runtime, and packaged evidence',
    'Commit and build profile identify the repository, not the executable that ran: without the binary hash, evidence from two different nd-core builds is indistinguishable.',
    'identity',
  )

  const startup = coreSummary.benchmarks?.['core-startup']
  requireNumber('core-startup-runs', 'Core startup has at least 10 measured runs', startup?.measuredRuns, (value) => value >= 10, '>= 10 runs')
  requireNumber('core-startup-p95', 'nd-core spawn→handshake p95', startup?.summaryMs?.p95, (value) => value <= 120, '<= 120 ms')
  requireNumber('core-health-rtt-p95', 'Ready core health round-trip p95', startup?.healthRoundTripSummaryMs?.p95, (value) => value <= 5, '<= 5 ms')

  const memory = coreSummary.benchmarks?.['memory-scheduler-scaling']
  const memoryPoints = Array.isArray(memory?.points) ? memory.points.filter((point) => point.kind === 'memory') : []
  const one = memoryPoints.find((point) => point.count === 1)
  const ten = memoryPoints.find((point) => point.count === 10)
  const os = coreSummary.environment?.os
  const idleLimitBytes = os === 'win32' ? 40 * MIB : os === 'linux' ? 30 * MIB : null
  add(
    'core-idle-memory',
    'Idle nd-core memory',
    Number.isFinite(one?.bytes) && Number.isFinite(idleLimitBytes) && one.bytes <= idleLimitBytes,
    one?.bytes ?? null,
    idleLimitBytes === null ? 'unsupported reference OS' : '<= ' + idleLimitBytes + ' bytes',
    one?.metric ? 'metric=' + one.metric : undefined,
  )
  const incrementalBytes = Number.isFinite(one?.bytes) && Number.isFinite(ten?.bytes) ? (ten.bytes - one.bytes) / 9 : null
  requireNumber('core-session-increment', 'Average nd-core memory increment for sessions 2-10', incrementalBytes, (value) => value <= 8 * MIB, '<= 8 MiB/session')
  add(
    'single-core-session-scaling',
    'Logical sessions keep one nd-core process',
    memoryPoints.length >= 5 && new Set(memoryPoints.map((point) => point.corePid)).size === 1,
    [...new Set(memoryPoints.map((point) => point.corePid))],
    'exactly 1 core pid',
  )
  add(
    'shared-workspace-scaling',
    'Shared workspace resource count stays one through 100 logical sessions',
    [1, 2, 4, 8, 10, 25, 50, 100].every((count) => memoryPoints.some((point) => point.count === count && point.workspaceCount === 1)),
    memoryPoints.map((point) => ({ count: point.count, workspaceCount: point.workspaceCount })),
    'workspaceCount=1 at 1/2/4/8/10/25/50/100',
  )

  const terminal = coreSummary.benchmarks?.['terminal-throughput']
  add(
    'terminal-integrity',
    'Terminal stress delivers every payload byte, intact and in order',
    terminal?.terminalCount >= 4
      && terminal?.payloadVerified === true
      && terminal?.payloadBytesObserved === terminal?.payloadBytesTarget
      && terminal?.reordered === 0,
    {
      terminalCount: terminal?.terminalCount,
      payloadBytesObserved: terminal?.payloadBytesObserved,
      payloadBytesTarget: terminal?.payloadBytesTarget,
      payloadVerified: terminal?.payloadVerified,
      capturedBytesObserved: terminal?.capturedBytesObserved,
      controlBytesObserved: terminal?.controlBytesObserved,
      reordered: terminal?.reordered,
    },
    '4 terminals, byte-exact payload, reordered=0',
  )
  requireNumber('terminal-input-rpc-p95', 'Foreground terminal input RPC p95 is measured', terminal?.inputLatencySummaryMs?.p95, () => true, 'required measurement')

  const parallel = coreSummary.benchmarks?.['scheduler-multi-agent']
  const parallelCounts = Array.isArray(parallel?.points) ? parallel.points.map((point) => point.count) : []
  add(
    'parallel-worker-points',
    'Parallel scheduler records the full 100-worker scale contract',
    [1, 2, 4, 8, 10, 25, 50, 100].every((count) => parallelCounts.includes(count)),
    parallelCounts,
    '1/2/4/8/10/25/50/100',
  )
  add(
    'parallel-worktree-cost',
    'Parallel benchmark records worktree disk cost',
    Array.isArray(parallel?.points) && parallel.points.every((point) => Number.isFinite(point.worktreeDiskBytes) && point.worktreeDiskBytes >= 0),
    parallel?.points?.map((point) => ({ count: point.count, worktreeDiskBytes: point.worktreeDiskBytes })) ?? null,
    'measured for every point',
  )

  const journal = coreSummary.benchmarks?.['session-journal-scaling']
  const journalPoints = Array.isArray(journal?.points) ? journal.points : []
  const journalCounts = journalPoints.map((point) => point.count)
  add(
    'session-journal-scale-points',
    'Native session journal records the full 100-session scale contract',
    [1, 2, 4, 8, 10, 25, 50, 100].every((count) => journalCounts.includes(count)),
    journalCounts,
    '1/2/4/8/10/25/50/100',
  )
  add(
    'session-journal-retention-bound',
    'Native session journal stays inside its configured per-session byte bound',
    journalPoints.length > 0 && journalPoints.every((point) =>
      Number.isFinite(point.retainedBytes)
      && Number.isFinite(point.maxBytesPerSession)
      && point.retainedBytes <= point.count * point.maxBytesPerSession),
    journalPoints.map((point) => ({
      count: point.count,
      retainedBytes: point.retainedBytes,
      maxBytesPerSession: point.maxBytesPerSession,
    })),
    'retainedBytes <= sessions * maxBytesPerSession',
  )
  add(
    'session-journal-tail-latency',
    'Native journal tail latency is recorded at every scale point',
    journalPoints.length > 0 && journalPoints.every((point) => Number.isFinite(point.tailLatencyMs) && point.tailLatencyMs >= 0),
    journalPoints.map((point) => ({ count: point.count, tailLatencyMs: point.tailLatencyMs })),
    'measured for every point',
  )

  const cancellation = coreSummary.benchmarks?.['cancellation-latency']
  add(
    'core-cancel-isolation',
    'Core cancellation removes target descendants and preserves peer worker',
    cancellation?.canceled?.orphanAlive === false
      && cancellation?.survivor?.aliveAfterPeerCancel === true
      && cancellation?.survivor?.cleaned === true
      && cancellation?.capacityReacquired === true,
    cancellation ?? null,
    'target gone, peer alive, cleanup complete, capacity reacquired',
  )

  requireNumber('rust-runtime-runs', 'Rust runtime has at least 10 measured runs', rustRuntime?.measuredRuns, (value) => value >= 10, '>= 10 runs')
  const documents = [coreSummary, rustRuntime, packagedStartup]
  const reference = rustRuntime
  const provenanceMismatches = []
  for (const [index, item] of documents.entries()) {
    for (const key of ['commit', 'buildProfile', 'fixtureRevision']) {
      if (item?.[key] !== reference?.[key]) provenanceMismatches.push(index + ':' + key)
    }
    for (const key of ['os', 'osVersion', 'arch', 'cpuModel', 'logicalCpuCount', 'physicalMemoryBytes']) {
      if (item?.environment?.[key] !== reference?.environment?.[key]) provenanceMismatches.push(index + ':environment.' + key)
    }
  }
  add('full-provenance', 'Core, runtime, and packaged evidence share one machine/commit/profile/fixture', provenanceMismatches.length === 0, provenanceMismatches, 'no provenance mismatch', undefined, 'identity')

  requireNumber('electron-event-loop-p95', 'Rust Electron main event-loop p95 above the process idle floor', rustRuntime?.summary?.eventLoopP95ExcessMs?.p95, (value) => value <= 16, '<= 16 ms above the measured floor')
  requireNumber('terminal-event-delivery-p95', 'Rust terminal native-event→Electron-handler p95', rustRuntime?.summary?.terminalEventDeliveryP95Ms?.p95, (value) => value <= 16, '<= 16 ms')
  requireNumber('cancel-cleanup-bound', 'Rust cancel→tree-exit p95 stays inside the runtime hard-cleanup bound', rustRuntime?.summary?.cancelToExitMs?.p95, (value) => value <= 3_000, '<= 3000 ms')
  const longStalls = (rustRuntime?.samples ?? []).filter((sample) => Number(sample?.eventLoop?.maxMs) > 50)
  observations.push({
    id: 'electron-stalls-over-50ms',
    label: 'Event-loop stalls >50 ms during combined terminal/Git/process stress',
    count: longStalls.length,
    maxMs: Math.max(0, ...longStalls.map((sample) => Number(sample.eventLoop.maxMs) || 0)),
    attribution: 'combined terminal output + repeated Git refresh + two synthetic managed worker trees',
  })

  requireNumber('packaged-startup-runs', 'Packaged Windows startup has at least 10 measured runs', packagedStartup?.measuredRuns, (value) => value >= 10, '>= 10 runs')
  add(
    'packaged-core-ready',
    'Every packaged startup run reports bundled ND Core protocol v1',
    Array.isArray(packagedStartup?.records)
      && packagedStartup.records.length >= 10
      && packagedStartup.records.every((record) => record.core?.protocolVersion === 1 && Number.isFinite(record.marks?.usable)),
    packagedStartup?.records?.map((record) => ({ protocolVersion: record.core?.protocolVersion, usableMs: record.marks?.usable })) ?? null,
    'protocolVersion=1 and usable mark for every run',
  )

  const failures = checks.filter((check) => !check.passed).map((check) =>
    '[' + check.kind + '] ' + check.label + ': expected ' + check.budget + ', got ' + formatActual(check.actual))
  return {
    status: failures.length ? 'fail' : 'pass',
    checks,
    failures,
    observations,
  }
}

function finiteOrValue(value) {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value
}

function formatActual(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}
