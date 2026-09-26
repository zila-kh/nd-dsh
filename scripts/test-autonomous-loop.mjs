#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vitestBin = join(root, 'node_modules', '.bin', 'vitest')
const deterministicFile = join(root, 'tests', 'real-world-autonomous-loop.test.ts')
const liveAgyFile = join(root, 'tests', 'real-world-agy-autonomous-loop.test.ts')

const args = process.argv.slice(2)
const liveOnly = args.includes('--live')
const deterministicOnly = args.includes('--deterministic')

const targets = liveOnly
  ? [liveAgyFile]
  : deterministicOnly
    ? [deterministicFile]
    : [deterministicFile, liveAgyFile]

console.log('='.repeat(70))
console.log('  ND-DSH: REAL-WORLD AUTONOMOUS LOOP VERIFICATION RUNNER')
console.log('='.repeat(70))
console.log('Testing Section 3 Claims:')
console.log('  1. AI PM Planning -> Structured Task Dependency Graph')
console.log('  2. Parallel Workers -> Isolated Git Worktrees (zero collision)')
console.log('  3. Live Engine Integration -> Real Antigravity (agy) CLI worker')
console.log('  4. Machine Verification -> Real process test execution & failure gating')
console.log('  5. Independent Review -> Diff inspection against baseline')
console.log('  6. Integration Queue -> Clean merge into main branch & conflict safety')
console.log('='.repeat(70) + '\n')

const child = spawn(vitestBin, ['run', ...targets, '--reporter=verbose'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n' + '='.repeat(70))
    console.log('  [PASS] ALL AUTONOMOUS LOOP REAL-WORLD GATES VERIFIED SUCCESSFULLY!')
    console.log('='.repeat(70))
  } else {
    console.error(`\n[FAIL] Test exited with code ${code}`)
  }
  process.exit(code ?? 1)
})
