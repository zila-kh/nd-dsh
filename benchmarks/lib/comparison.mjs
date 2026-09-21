const FINGERPRINT_KEYS = ['os', 'osVersion', 'arch', 'cpuModel', 'logicalCpuCount', 'physicalMemoryBytes']

const METRICS = [
  ['usable-startup-p50', 'Same-build usable startup p50', 'ms', ['summary', 'usableStartupMs', 'p50']],
  ['main-cpu-p50', 'Electron main CPU under stress p50', 'ms', ['summary', 'mainCpuMs', 'p50']],
  ['event-loop-p95-median', 'Event-loop p95 (median run)', 'ms', ['summary', 'eventLoopP95Ms', 'p50']],
  ['idle-backend-memory-p50', 'Idle backend memory p50', 'bytes', ['summary', 'idleBackendMemoryBytes', 'p50']],
  ['session-growth-p50', 'Session 1→10 backend memory growth p50', 'bytes', ['summary', 'session1To10GrowthBytes', 'p50']],
  ['terminal-stress-p50', 'Terminal stress completion p50', 'ms', ['summary', 'terminalToMarkerMs', 'p50']],
  ['git-refresh-p50', 'Git refresh p50 under combined load', 'ms', ['summary', 'gitP50Ms', 'p50']],
  ['cancel-p95', 'Cancel→process-tree exit p95', 'ms', ['summary', 'cancelToExitMs', 'p95']],
]

export function compareRuntime(baseline, candidate) {
  const mismatches = []
  for (const key of FINGERPRINT_KEYS) {
    if (baseline.environment?.[key] !== candidate.environment?.[key]) mismatches.push('environment.' + key)
  }
  for (const key of ['commit', 'buildProfile', 'fixtureRevision']) {
    if (baseline?.[key] !== candidate?.[key]) mismatches.push(key)
  }
  const rows = METRICS.map(([id, label, unit, path]) => {
    const baselineValue = numberAt(baseline, path)
    const candidateValue = numberAt(candidate, path)
    return {
      id,
      label,
      unit,
      baseline: baselineValue,
      candidate: candidateValue,
      deltaPct: percentageDelta(baselineValue, candidateValue),
    }
  })
  return {
    baseline: { backend: baseline.backend, commit: baseline.commit },
    candidate: { backend: candidate.backend, commit: candidate.commit },
    sameMachine: mismatches.length === 0,
    mismatches,
    rows,
  }
}

export function comparisonRow(comparison, id) {
  return comparison.rows.find((row) => row.id === id)
}

export function percentageDelta(baseline, candidate) {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) return null
  if (baseline === 0) return candidate === 0 ? 0 : null
  return ((candidate - baseline) / Math.abs(baseline)) * 100
}

function numberAt(value, path) {
  let current = value
  for (const key of path) current = current?.[key]
  return typeof current === 'number' && Number.isFinite(current) ? current : null
}
