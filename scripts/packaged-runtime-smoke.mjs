#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const executable = await resolvePortable(process.argv[2])
const outputDir = resolve(process.env.ND_DSH_PACKAGED_SMOKE_DIR || join(root, 'benchmark-results', 'packaged-smoke'))
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
  if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)) continue
  safeEnv[key] = value
}
Object.assign(safeEnv, {
  ND_DSH_CORE_BACKEND: 'rust',
  ND_DSH_WORKSPACE: workspace,
  ND_DSH_USER_DATA_DIR: userData,
  ND_DSH_PACKAGED_SMOKE_OUTPUT: receipt,
  ND_DSH_BENCHMARK_OUTPUT: startup,
  ND_DSH_SMOKE_SUFFIX: 'TERMINAL_SMOKE',
  ND_DSH_BROWSER_URL: 'about:blank',
})

console.log('Launching packaged ND runtime smoke:', executable)
const child = spawn(executable, ['--disable-gpu'], {
  cwd: workspace,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: safeEnv,
})
let stdout = ''
let stderr = ''
child.stdout?.setEncoding('utf8')
child.stderr?.setEncoding('utf8')
child.stdout?.on('data', (chunk) => { stdout += chunk })
child.stderr?.on('data', (chunk) => { stderr += chunk })
const exitCode = await new Promise((resolvePromise, reject) => {
  const timer = setTimeout(() => {
    try { child.kill() } catch {}
    reject(new Error('Packaged runtime smoke timed out after 90 seconds.'))
  }, 90_000)
  child.once('error', (error) => { clearTimeout(timer); reject(error) })
  child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code) })
})

try {
  if (exitCode !== 0) throw new Error('Packaged application exited with code ' + String(exitCode))
  const runtime = JSON.parse(await fs.readFile(receipt, 'utf8'))
  const startupRecord = JSON.parse(await fs.readFile(startup, 'utf8'))
  if (runtime.status !== 'pass') throw new Error('Packaged runtime receipt did not pass: ' + JSON.stringify(runtime))
  if (runtime.core?.protocolVersion !== 1) throw new Error('Packaged runtime did not report ND Core protocol v1.')
  if (runtime.terminal?.markerObserved !== true) throw new Error('Packaged runtime terminal marker was not observed.')
  if (!runtime.git?.repoRoot || !runtime.git?.head) throw new Error('Packaged runtime Git smoke did not resolve repository history.')
  if (startupRecord.core?.protocolVersion !== 1 || !Number.isFinite(startupRecord.marks?.usable)) {
    throw new Error('Packaged startup telemetry did not prove bundled core readiness and usable startup.')
  }
  console.log(JSON.stringify({ status: 'pass', executable: basename(executable), outputDir, runtime, startup: startupRecord }, null, 2))
} catch (error) {
  console.error(stdout.slice(-6000))
  console.error(stderr.slice(-6000))
  throw error
} finally {
  await fs.rm(workspace, { recursive: true, force: true })
  await fs.rm(userData, { recursive: true, force: true })
}

async function resolvePortable(argument) {
  if (argument?.trim()) {
    const path = resolve(argument)
    if (!existsSync(path)) throw new Error('Packaged executable does not exist: ' + path)
    return path
  }
  const dist = join(root, 'dist')
  const entries = await fs.readdir(dist)
  const name = entries.find((entry) => /^ND-DSH-.+-private-beta-.+\.exe$/i.test(entry))
  if (!name) throw new Error('Could not find a Windows portable ND-DSH executable in ' + dist)
  return join(dist, name)
}
