import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { defaultOutputDir, writeResult } from './lib/results.mjs'
import { sleep, summarize } from './lib/metrics.mjs'
import { benchmarkRoot } from './lib/core-rpc.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')
const backendArg = (process.argv[2] || 'rust-core').trim().toLowerCase()
const backend = backendArg === 'rust' || backendArg === 'rust-core' ? 'rust-core' : undefined
if (!backend) {
  console.error('Usage: node benchmarks/app-runtime.mjs [rust-core] (legacy runtime retired)')
  process.exit(2)
}
const runs = Math.max(2, Number(process.env.ND_DSH_BENCH_RUNS || 5))
const outputDir = resolve(process.env.ND_DSH_BENCH_OUTPUT || defaultOutputDir())
const workspace = await mkdtemp(join(tmpdir(), 'nd-dsh-app-runtime-workspace-'))
const rawDir = join(outputDir, 'raw')
await mkdir(rawDir, { recursive: true })

try {
  await createGitFixture(workspace)
  const samples = []
  for (let index = 0; index < runs; index += 1) {
    const userData = await mkdtemp(join(tmpdir(), 'nd-dsh-app-runtime-user-data-'))
    const raw = join(rawDir, backend + '-' + index + '.json')
    const startupRaw = join(rawDir, backend + '-' + index + '-startup.json')
    try {
      const env = safeEnvironment()
      Object.assign(env, {
        ND_DSH_CORE_PROFILE: 'release',
        ND_DSH_WORKSPACE: workspace,
        ND_DSH_USER_DATA_DIR: userData,
        ND_DSH_RUNTIME_BENCH_OUTPUT: raw,
        ND_DSH_BENCHMARK_OUTPUT: startupRaw,
        ND_DSH_BROWSER_URL: 'about:blank',
      })
      const child = spawn(electronExecutable, [benchmarkRoot, '--disable-gpu'], {
        cwd: benchmarkRoot,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk).slice(-12000) })
      child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-12000) })
      const exitCode = await waitForExit(child, 90_000)
      if (exitCode !== 0) throw new Error('Electron runtime benchmark exited with code ' + String(exitCode) + '\n' + stdout + '\n' + stderr)
      const runtime = JSON.parse(await readFile(raw, 'utf8'))
      const startup = JSON.parse(await readFile(startupRaw, 'utf8'))
      if (!Number.isFinite(startup.marks?.usable)) throw new Error(backend + ' startup record has no usable mark')
      samples.push({ ...runtime, startup })
    } finally {
      await rm(userData, { recursive: true, force: true })
    }
    await sleep(150)
  }

  for (const sample of samples) {
    if (sample.cancellation?.orphanAlive === true) throw new Error(backend + ' runtime benchmark left an orphan process tree')
    if (sample.cancellation?.survivorAliveAfterPeerCancel !== true) throw new Error(backend + ' runtime benchmark killed an unrelated worker')
  }

  process.env.ND_DSH_BENCH_BACKEND = backend
  const sessionGrowth = samples.map((sample) => {
    const first = sample.sessionScaling?.find((point) => point.count === 1)?.backendMemoryBytes
    const last = sample.sessionScaling?.find((point) => point.count === 10)?.backendMemoryBytes
    return Number.isFinite(first) && Number.isFinite(last) ? last - first : NaN
  })

  const result = await writeResult(outputDir, 'electron-responsiveness', {
    measuredRuns: runs,
    samples,
    summary: {
      usableStartupMs: summarize(samples.map((sample) => sample.startup?.marks?.usable)),
      mainCpuMs: summarize(samples.map((sample) => sample.mainCpuMs)),
      eventLoopP95Ms: summarize(samples.map((sample) => sample.eventLoop?.p95Ms)),
      eventLoopMaxMs: summarize(samples.map((sample) => sample.eventLoop?.maxMs)),
      terminalEventDeliveryP95Ms: summarize(samples.map((sample) => sample.terminal?.eventDeliveryP95Ms)),
      terminalToMarkerMs: summarize(samples.map((sample) => sample.terminal?.toMarkerMs)),
      gitP50Ms: summarize(samples.map((sample) => sample.git?.p50Ms)),
      cancelToExitMs: summarize(samples.map((sample) => sample.cancellation?.cancelToExitMs)),
      idleBackendMemoryBytes: summarize(samples.map((sample) => sample.idleBackendMemoryBytes)),
      session1To10GrowthBytes: summarize(sessionGrowth),
    },
  })
  console.log(JSON.stringify({ status: 'pass', outputDir, backend, summary: result.summary }, null, 2))
} finally {
  await rm(workspace, { recursive: true, force: true })
}

async function createGitFixture(root) {
  await execFileAsync('git', ['init'], { cwd: root, windowsHide: true })
  await execFileAsync('git', ['config', 'user.email', 'runtime-bench@nd.local'], { cwd: root, windowsHide: true })
  await execFileAsync('git', ['config', 'user.name', 'ND Runtime Bench'], { cwd: root, windowsHide: true })
  for (let index = 0; index < 400; index += 1) {
    const dir = join(root, 'src', String(index % 16))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'file-' + index + '.txt'), 'seed ' + index + '\n')
  }
  await execFileAsync('git', ['add', '.'], { cwd: root, windowsHide: true })
  await execFileAsync('git', ['commit', '-m', 'runtime benchmark fixture'], { cwd: root, windowsHide: true })
  for (let index = 0; index < 80; index += 1) {
    await writeFile(join(root, 'src', String(index % 16), 'file-' + index + '.txt'), 'changed ' + index + '\n')
  }
}

function safeEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || /(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(key)) continue
    env[key] = value
  }
  return env
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      reject(new Error('Electron runtime benchmark timed out after ' + timeoutMs + 'ms'))
    }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolvePromise(code) })
  })
}
