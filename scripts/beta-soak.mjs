#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..')
const args = parseArgs(process.argv.slice(2))
const hours = args.hours ?? 24
const cyclesLimit = args.cycles
const targetPassRate = args.targetPassRate ?? 0.95
const command = args.command ?? 'e2e:prod:user'
const startedAt = new Date()
const deadline = startedAt.getTime() + hours * 60 * 60 * 1000
const reportDir = resolve(root, args.output ?? `beta-qa-report-${stamp(startedAt)}`)
mkdirSync(reportDir, { recursive: true })

const commit = git(['rev-parse', 'HEAD']).trim() || 'unknown'
const status = git(['status', '--porcelain'])
if (status.trim()) {
  console.error('Beta soak requires a clean worktree so every cycle tests one exact commit.')
  process.exit(2)
}

const cycles = []
let index = 0
while ((cyclesLimit === undefined || index < cyclesLimit) && Date.now() < deadline) {
  index += 1
  const cycleStarted = new Date()
  console.log(`\n[beta-soak] cycle ${index} starting at ${cycleStarted.toISOString()} using ${command}`)
  const result = runPnpm(command)
  const cycle = {
    index,
    startedAt: cycleStarted.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - cycleStarted.getTime(),
    status: result.status === 0 ? 'pass' : 'fail',
    exitCode: result.status,
    signal: result.signal ?? null,
  }
  cycles.push(cycle)
  writeSummary()

  if (result.status !== 0 && args.stopOnFailure) {
    console.error('[beta-soak] stopping on first failing cycle.')
    break
  }
  if (cyclesLimit === undefined && Date.now() < deadline && args.intervalSeconds > 0) {
    sleep(args.intervalSeconds * 1000)
  }
}

const passed = cycles.filter((item) => item.status === 'pass').length
const passRate = cycles.length === 0 ? 0 : passed / cycles.length
writeSummary()
console.log(`\n[beta-soak] ${passed}/${cycles.length} cycles passed (${(passRate * 100).toFixed(2)}%).`)
console.log(`[beta-soak] report: ${join(reportDir, 'soak-summary.json')}`)
process.exit(cycles.length > 0 && passRate >= targetPassRate ? 0 : 1)

function writeSummary() {
  const passed = cycles.filter((item) => item.status === 'pass').length
  const total = cycles.length
  const summary = {
    schemaVersion: 1,
    kind: 'nd-beta-soak',
    commit,
    command,
    startedAt: startedAt.toISOString(),
    updatedAt: new Date().toISOString(),
    requestedHours: hours,
    ...(cyclesLimit === undefined ? {} : { requestedCycles: cyclesLimit }),
    targetPassRate,
    passed,
    total,
    passRate: total === 0 ? 0 : passed / total,
    status: total > 0 && passed / total >= targetPassRate ? 'pass' : 'fail',
    cycles,
  }
  writeFileSync(join(reportDir, 'soak-summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8')
  writeFileSync(join(reportDir, 'soak-summary.sha256'), createHash('sha256').update(JSON.stringify(summary)).digest('hex') + '\n', 'utf8')
}

function runPnpm(scriptName) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, 'run', scriptName], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
  }
  return spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', scriptName], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) return ''
  return result.stdout ?? ''
}

function sleep(ms) {
  const view = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(view, 0, 0, ms)
}

function parseArgs(values) {
  const parsed = {
    hours: undefined,
    cycles: undefined,
    targetPassRate: undefined,
    command: undefined,
    output: undefined,
    stopOnFailure: false,
    intervalSeconds: 30,
  }
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value === '--stop-on-failure') parsed.stopOnFailure = true
    else if (value === '--hours') parsed.hours = positiveNumber(values[++i], '--hours')
    else if (value === '--cycles') parsed.cycles = positiveInteger(values[++i], '--cycles')
    else if (value === '--target-pass-rate') parsed.targetPassRate = ratio(values[++i])
    else if (value === '--command') parsed.command = requiredText(values[++i], '--command')
    else if (value === '--output') parsed.output = requiredText(values[++i], '--output')
    else if (value === '--interval-seconds') parsed.intervalSeconds = nonNegativeNumber(values[++i], '--interval-seconds')
    else throw new Error(`Unknown beta soak argument: ${value}`)
  }
  return parsed
}

function requiredText(value, name) {
  if (!value?.trim()) throw new Error(`${name} requires a value`)
  return value.trim()
}

function positiveNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be > 0`)
  return number
}

function nonNegativeNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be >= 0`)
  return number
}

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`)
  return number
}

function ratio(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0 || number > 1) throw new Error('--target-pass-rate must be > 0 and <= 1')
  return number
}

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-')
}
