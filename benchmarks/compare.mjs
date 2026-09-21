import { readFile } from 'node:fs/promises'
import process from 'node:process'
const [baselinePath, candidatePath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) {
  console.error('Usage: pnpm bench:compare <baseline-summary.json> <candidate-summary.json>')
  process.exit(2)
}
const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'))
const rows = []
for (const [name, value] of Object.entries(candidate.benchmarks || {})) {
  const before = baseline.benchmarks?.[name]
  if (!before) continue
  for (const [metric, left, right] of [['summaryMs.p50', before.summaryMs?.p50, value.summaryMs?.p50], ['elapsedMs', before.elapsedMs, value.elapsedMs], ['cancelToExitMs', before.cancelToExitMs, value.cancelToExitMs]]) {
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue
    rows.push({ benchmark: name, metric, baseline: left, candidate: right, deltaPct: ((right - left) / left) * 100 })
  }
}
console.log(JSON.stringify({ baseline: baseline.backend, candidate: candidate.backend, rows }, null, 2))
