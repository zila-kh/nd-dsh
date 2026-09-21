import { promises as fs } from 'node:fs'
import process from 'node:process'
import { compareRuntime } from './lib/comparison.mjs'

const [baselinePath, candidatePath, outputPath] = process.argv.slice(2)
if (!baselinePath || !candidatePath) {
  console.error('Usage: pnpm bench:compare <legacy-electron-responsiveness.json> <rust-electron-responsiveness.json> [output.json]')
  process.exit(2)
}

const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'))
const candidate = JSON.parse(await fs.readFile(candidatePath, 'utf8'))
if (baseline.benchmark !== 'electron-responsiveness' || candidate.benchmark !== 'electron-responsiveness') {
  throw new Error('bench:compare expects two electron-responsiveness result files.')
}
const comparison = compareRuntime(baseline, candidate)
const text = JSON.stringify(comparison, null, 2) + '\n'
if (outputPath) await fs.writeFile(outputPath, text, 'utf8')
process.stdout.write(text)
if (!comparison.sameMachine) process.exitCode = 1
