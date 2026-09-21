import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { evaluateEvidence } from './lib/budgets.mjs'

const file = process.argv[2]
if (!file) {
  console.error('Usage: pnpm bench:check <benchmark-bundle/summary.json>')
  process.exit(2)
}
const summaryPath = resolve(file)
const summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'))
if (summary.schemaVersion !== 1 || summary.kind !== 'nd-performance-evidence' || !summary.paths) {
  throw new Error('bench:check requires the top-level summary.json produced by pnpm bench:record.')
}
const root = dirname(summaryPath)
const [coreSummary, legacyRuntime, rustRuntime, packagedStartup] = await Promise.all([
  readRelative(root, summary.paths.core),
  readRelative(root, summary.paths.legacy),
  readRelative(root, summary.paths.rust),
  readRelative(root, summary.paths.packaged),
])
const evaluated = evaluateEvidence({ coreSummary, legacyRuntime, rustRuntime, packagedStartup })
const result = {
  status: evaluated.status,
  checks: evaluated.checks,
  failures: evaluated.failures,
  observations: evaluated.observations,
}
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
if (evaluated.failures.length) process.exitCode = 1

async function readRelative(root, path) {
  if (typeof path !== 'string' || !path.trim()) throw new Error('Benchmark summary contains an invalid raw-result path.')
  const resolved = resolve(root, path)
  const relative = resolved.slice(root.length)
  if (resolved === root || (!resolved.startsWith(root + '/') && !resolved.startsWith(root + '\\'))) {
    throw new Error('Benchmark raw-result path escapes the evidence bundle: ' + path)
  }
  return JSON.parse(await fs.readFile(resolved, 'utf8'))
}
