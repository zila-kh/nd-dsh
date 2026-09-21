import { compareRuntime, comparisonRow } from './comparison.mjs'

const MIB = 1024 * 1024

export function evaluateEvidence({ coreSummary, legacyRuntime, rustRuntime, packagedStartup }) {
  const comparison = compareRuntime(legacyRuntime, rustRuntime)
  const checks = []
  const observations = []

  const add = (id, label, passed, actual, budget, detail) => {
    checks.push({ id, label, passed: Boolean(passed), actual: finiteOrValue(actual), budget, ...(detail ? { detail } : {}) })
  }
  const requireNumber = (id, label, value, predicate, budget, detail) => {
    add(id, label, Number.isFinite(value) && predicate(value), Number.isFinite(value) ? value : null, budget, detail)
  }

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
    'Shared workspace resource count stays one for 1/2/4/8/10 sessions',
    [1, 2, 4, 8, 10].every((count) => memoryPoints.some((point) => point.count === count && point.workspaceCount === 1)),
    memoryPoints.map((point) => ({ count: point.count, workspaceCount: point.workspaceCount })),
    'workspaceCount=1 at 1/2/4/8/10',
  )

  const terminal = coreSummary.benchmarks?.['terminal-throughput']
  add(
    'terminal-integrity',
    'Terminal stress preserves bytes and event order',
    terminal?.terminalCount >= 4 && terminal?.bytesObserved === terminal?.bytesTarget && terminal?.reordered === 0,
    { terminalCount: terminal?.terminalCount, bytesObserved: terminal?.bytesObserved, bytesTarget: terminal?.bytesTarget, reordered: terminal?.reordered },
    '4 terminals, exact bytes, reordered=0',
  )
  requireNumber('terminal-input-rpc-p95', 'Foreground terminal input RPC p95 is measured', terminal?.inputLatencySummaryMs?.p95, () => true, 'required measurement')

  const parallel = coreSummary.benchmarks?.['scheduler-multi-agent']
  const parallelCounts = Array.isArray(parallel?.points) ? parallel.points.map((point) => point.count) : []
  add(
    'parallel-worker-points',
    'Parallel scheduler records 1/2/4/8/10 workers',
    [1, 2, 4, 8, 10].every((count) => parallelCounts.includes(count)),
    parallelCounts,
    '1/2/4/8/10',
  )
  add(
    'parallel-worktree-cost',
    'Parallel benchmark records worktree disk cost',
    Array.isArray(parallel?.points) && parallel.points.every((point) => Number.isFinite(point.worktreeDiskBytes) && point.worktreeDiskBytes >= 0),
    parallel?.points?.map((point) => ({ count: point.count, worktreeDiskBytes: point.worktreeDiskBytes })) ?? null,
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

  requireNumber('legacy-runtime-runs', 'Legacy comparison has at least 10 measured runs', legacyRuntime?.measuredRuns, (value) => value >= 10, '>= 10 runs')
  requireNumber('rust-runtime-runs', 'Rust comparison has at least 10 measured runs', rustRuntime?.measuredRuns, (value) => value >= 10, '>= 10 runs')
  add('same-machine', 'Legacy and Rust evidence use the same machine/commit/profile/fixture', comparison.sameMachine, comparison.mismatches, 'no provenance mismatch')

  requireNumber(
    'electron-event-loop-p95',
    'Rust Electron main event-loop p95 under combined load',
    rustRuntime?.summary?.eventLoopP95Ms?.p95,
    (value) => value <= 16,
    '<= 16 ms',
  )
  requireNumber(
    'terminal-event-delivery-p95',
    'Rust terminal native-event→Electron-handler p95',
    rustRuntime?.summary?.terminalEventDeliveryP95Ms?.p95,
    (value) => value <= 16,
    '<= 16 ms',
  )
  const longStalls = (rustRuntime?.samples ?? []).filter((sample) => Number(sample?.eventLoop?.maxMs) > 50)
  observations.push({
    id: 'electron-stalls-over-50ms',
    label: 'Event-loop stalls >50 ms during combined terminal/Git/process stress',
    count: longStalls.length,
    maxMs: Math.max(0, ...longStalls.map((sample) => Number(sample.eventLoop.maxMs) || 0)),
    attribution: 'combined terminal output + repeated Git refresh + two synthetic managed worker trees',
  })

  const cpu = comparisonRow(comparison, 'main-cpu-p50')
  add('relative-main-cpu', 'Rust reduces Electron main CPU under stress by at least 25%', cpu?.deltaPct !== null && cpu?.deltaPct <= -25, cpu?.deltaPct ?? null, '<= -25%')
  const idle = comparisonRow(comparison, 'idle-backend-memory-p50')
  add('relative-idle-memory', 'Rust idle backend memory regression stays within 20%', idle?.deltaPct !== null && idle?.deltaPct <= 20, idle?.deltaPct ?? null, '<= +20%')
  const sessions = comparisonRow(comparison, 'session-growth-p50')
  add(
    'relative-session-scaling',
    'Rust 1→10 session backend memory growth is lower than legacy',
    Number.isFinite(sessions?.baseline) && Number.isFinite(sessions?.candidate) && sessions.candidate < sessions.baseline,
    { legacy: sessions?.baseline ?? null, rust: sessions?.candidate ?? null },
    'rust < legacy',
  )
  const cancel = comparisonRow(comparison, 'cancel-p95')
  add('relative-cancel', 'Rust cancel→tree-exit p95 regresses no more than 10%', cancel?.deltaPct !== null && cancel?.deltaPct <= 10, cancel?.deltaPct ?? null, '<= +10%')
  requireNumber('cancel-cleanup-bound', 'Rust cancel→tree-exit p95 stays inside the runtime hard-cleanup bound', cancel?.candidate, (value) => value <= 3_000, '<= 3000 ms')
  const git = comparisonRow(comparison, 'git-refresh-p50')
  add('relative-git', 'Rust Git refresh p50 regresses no more than 10%', git?.deltaPct !== null && git?.deltaPct <= 10, git?.deltaPct ?? null, '<= +10%')
  const terminalRelative = comparisonRow(comparison, 'terminal-stress-p50')
  add('relative-terminal', 'Rust terminal stress p50 regresses no more than 10%', terminalRelative?.deltaPct !== null && terminalRelative?.deltaPct <= 10, terminalRelative?.deltaPct ?? null, '<= +10%')

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

  const failures = checks.filter((check) => !check.passed).map((check) => check.label + ': expected ' + check.budget + ', got ' + formatActual(check.actual))
  return {
    status: failures.length ? 'fail' : 'pass',
    checks,
    failures,
    observations,
    comparison,
  }
}

function finiteOrValue(value) {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value
}

function formatActual(value) {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}
