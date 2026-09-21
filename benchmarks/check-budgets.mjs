import { readFile } from 'node:fs/promises'
import process from 'node:process'
const file = process.argv[2]
if (!file) { console.error('Usage: pnpm bench:check <summary.json>'); process.exit(2) }
const summary = JSON.parse(await readFile(file, 'utf8'))
const failures = [...(summary.failures || [])]
const startup = summary.benchmarks?.['core-startup']?.summaryMs
if (startup?.p95 !== undefined && startup.p95 > 120) failures.push('core startup p95 exceeds 120ms: ' + startup.p95)
const terminal = summary.benchmarks?.['terminal-throughput']
if (terminal && (terminal.reordered !== 0 || terminal.bytesObserved !== terminal.bytesTarget)) failures.push('terminal integrity budget failed')
const cancel = summary.benchmarks?.['cancellation-latency']
if (cancel?.orphanAlive === true) failures.push('cancellation left an orphan process')
console.log(JSON.stringify({ status: failures.length ? 'fail' : 'pass', failures }, null, 2))
if (failures.length) process.exitCode = 1
