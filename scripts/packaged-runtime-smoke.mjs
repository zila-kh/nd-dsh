#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { releaseArtifact } from './release-artifact.mjs'
import { matchingProcesses, processDescendants, readProcessRows } from './e2e-process-tree.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = releaseArtifact(root, process.argv[2] || process.env.ND_DSH_E2E_EXECUTABLE)
const executable = target.executable
const startedAt = Date.now()
const outputDir = join(resolve(process.env.ND_DSH_PACKAGED_SMOKE_DIR || join(root, 'benchmark-results', 'packaged-smoke')), String(startedAt))
const workspace = await fs.mkdtemp(join(tmpdir(), 'nd-dsh-packaged-smoke-'))
const userData = await fs.mkdtemp(join(tmpdir(), 'nd-dsh-packaged-user-data-'))
const receipt = join(outputDir, 'packaged-runtime-smoke.json')
const startup = join(outputDir, 'packaged-startup.json')

await fs.mkdir(outputDir, { recursive: true })
await execFileAsync('git', ['init'], { cwd: workspace, windowsHide: true })
await execFileAsync('git', ['config', 'user.email', 'packaged-smoke@nd.local'], { cwd: workspace, windowsHide: true })
await execFileAsync('git', ['config', 'user.name', 'ND Packaged Smoke'], { cwd: workspace, windowsHide: true })
await fs.writeFile(join(workspace, 'README.md'), '# Packaged smoke\n')
await execFileAsync('git', ['add', 'README.md'], { cwd: workspace, windowsHide: true })
await execFileAsync('git', ['commit', '-m', 'packaged smoke fixture'], { cwd: workspace, windowsHide: true })

const safeEnv = {}
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)
    || /^ND_(DSH|PENCIL)_/i.test(key) || key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS') continue
  safeEnv[key] = value
}
Object.assign(safeEnv, {
  ND_DSH_WORKSPACE: workspace,
  ND_DSH_USER_DATA_DIR: userData,
  ND_DSH_PACKAGED_SMOKE_OUTPUT: receipt,
  ND_DSH_BENCHMARK_OUTPUT: startup,
  ND_DSH_SMOKE_SUFFIX: 'TERMINAL_SMOKE',
  ND_DSH_BROWSER_URL: 'about:blank',
})

console.log('Launching packaged ND runtime smoke:', executable)
const child = spawn(executable, ['--disable-gpu', '--user-data-dir=' + userData], {
  cwd: workspace,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: safeEnv,
})
let stdout = ''
let stderr = ''
const owned = new Map()
let inventoryError
function observeOwnedProcesses() {
  try {
    const rows = readProcessRows()
    for (const row of processDescendants(child.pid, rows)) owned.set(`${row.pid}:${row.command}`, row)
  } catch (error) { inventoryError = error }
}
observeOwnedProcesses()
const inventoryTimer = setInterval(observeOwnedProcesses, 2_000)
let result
child.stdout?.setEncoding('utf8')
child.stderr?.setEncoding('utf8')
child.stdout?.on('data', (chunk) => { stdout += chunk })
child.stderr?.on('data', (chunk) => { stderr += chunk })
try {
  const exitCode = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      observeOwnedProcesses()
      try { child.kill() } catch {}
      try {
        for (const row of matchingProcesses([...owned.values()], readProcessRows()).reverse()) {
          try { process.kill(row.pid, 'SIGKILL') } catch { /* already gone */ }
        }
      } catch (error) { inventoryError = error }
      reject(new Error('Packaged runtime smoke timed out after 240 seconds (including portable extraction).'))
    }, 240_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code) })
  })
  clearInterval(inventoryTimer)
  if (inventoryError) throw inventoryError
  if (exitCode !== 0) throw new Error('Packaged application exited with code ' + String(exitCode))
  const cleanupDeadline = Date.now() + 10_000
  let survivors
  do {
    survivors = matchingProcesses([...owned.values()], readProcessRows())
    if (!survivors.length) break
    await new Promise((done) => setTimeout(done, 250))
  } while (Date.now() < cleanupDeadline)
  if (survivors.length) throw new Error('Packaged application left owned processes: ' + survivors.map((row) => `${row.pid}:${row.command}`).join(', '))
  const runtime = JSON.parse(await fs.readFile(receipt, 'utf8'))
  const startupRecord = JSON.parse(await fs.readFile(startup, 'utf8'))
  if (runtime.workspaceRoot !== workspace || !Number.isFinite(runtime.startedAt) || runtime.startedAt < startedAt) throw new Error('Packaged receipt did not belong to this launch.')
  if (runtime.status !== 'pass') throw new Error('Packaged runtime receipt did not pass: ' + JSON.stringify(runtime))
  if (runtime.core?.protocolVersion !== 1) throw new Error('Packaged runtime did not report ND Core protocol v1.')
  if (runtime.harness?.gatewayResponded !== true || !['ready', 'running'].includes(runtime.harness?.state)) throw new Error('Packaged agent runtime did not become ready.')
  if (runtime.terminal?.markerObserved !== true) throw new Error('Packaged runtime terminal marker was not observed.')
  if (!runtime.git?.repoRoot || !runtime.git?.head) throw new Error('Packaged runtime Git smoke did not resolve repository history.')
  if (startupRecord.core?.protocolVersion !== 1 || !Number.isFinite(startupRecord.marks?.usable)) {
    throw new Error('Packaged startup telemetry did not prove bundled core readiness and usable startup.')
  }
  await fs.writeFile(join(outputDir, 'application-target.json'), JSON.stringify(target, null, 2) + '\n')
  result = { status: 'pass', executable: basename(executable), target, outputDir, runtime, startup: startupRecord, launchDurationMs: Date.now() - startedAt, ownedProcessesObserved: owned.size }
} catch (error) {
  // This launch uses a disposable profile and a credential-free environment.
  // Keep its startup diagnostics before removing the profile so an import or
  // runtime failure can be investigated from the same packaged bytes.
  const diagnosticDir = join(userData, 'dsh-home', 'logs')
  for (const entry of await fs.readdir(diagnosticDir).catch(() => [])) {
    if (/^startup-.*\.log$/.test(entry)) {
      await fs.copyFile(join(diagnosticDir, entry), join(outputDir, entry))
    }
  }
  console.error(stdout.slice(-6000))
  console.error(stderr.slice(-6000))
  throw error
} finally {
  clearInterval(inventoryTimer)
  // Failure exits can bypass Electron's graceful shutdown. Reap only observed,
  // still-matching descendants; never kill unrelated processes by image name.
  const remaining = matchingProcesses([...owned.values()], readProcessRows())
  for (const row of remaining.reverse()) {
    try { process.kill(row.pid, 'SIGKILL') } catch { /* already gone */ }
  }
  if (remaining.length) console.error('Cleaned failed-smoke descendants:', remaining.map((row) => row.command).join(', '))
  for (const stream of child.stdio) stream?.destroy()
  child.unref()
  // Both paths were freshly created by this script; validate their resolved
  // scope before recursive cleanup on Windows.
  for (const directory of [workspace, userData]) {
    const childPath = relative(resolve(tmpdir()), resolve(directory))
    if (!childPath || childPath.split(/[\\/]/)[0] === '..' || isAbsolute(childPath)) throw new Error('Refusing out-of-scope smoke cleanup')
  }
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  await fs.rm(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
}
await fs.writeFile(join(outputDir, 'driver-result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
