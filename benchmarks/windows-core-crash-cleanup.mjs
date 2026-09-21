import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { CoreRpc, benchmarkRoot } from './lib/core-rpc.mjs'
import { pidAlive, sleep } from './lib/metrics.mjs'

if (process.platform !== 'win32') {
  console.error('windows-core-crash-cleanup.mjs is a Windows-only acceptance test.')
  process.exit(2)
}

const binary = resolve(process.env.ND_DSH_CORE_BIN?.trim() || join(benchmarkRoot, '.release', 'nd-core', 'nd-core.exe'))
if (!existsSync(binary)) throw new Error('Staged Windows nd-core is missing: ' + binary)
const outputPath = resolve(process.env.ND_DSH_CORE_CRASH_OUTPUT || join(benchmarkRoot, 'benchmark-results', 'packaged-smoke', 'core-crash-cleanup.json'))
const fixture = join(benchmarkRoot, 'benchmarks', 'fixtures', 'synthetic-worker.mjs')
const client = await CoreRpc.launch({ binary })
let managedPid
let descendantPid
let output = ''

try {
  client.on('process.output', (frame) => {
    if (frame.resourceId !== 'forced-crash-worker' || frame.data?.stream !== 'stdout') return
    output += Buffer.from(frame.data.bytes || []).toString('utf8')
    const line = output.split(/\r?\n/).find(Boolean)
    if (!line || descendantPid) return
    try {
      const parsed = JSON.parse(line)
      if (Number.isInteger(parsed.childPid)) descendantPid = parsed.childPid
    } catch {}
  })

  const spawned = await client.request('process.spawn', {
    id: 'forced-crash-worker',
    command: process.execPath,
    args: [fixture],
    cwd: benchmarkRoot,
    env: {},
    inheritEnv: true,
  })
  managedPid = spawned.pid
  for (let index = 0; index < 100 && !descendantPid; index += 1) await sleep(20)
  if (!Number.isInteger(descendantPid)) throw new Error('Managed worker did not report its descendant pid before forced core termination.')
  if (!(await pidAlive(managedPid)) || !(await pidAlive(descendantPid))) throw new Error('Managed worker tree was not alive before forced core termination.')

  const exited = new Promise((resolvePromise) => client.once('core-exit', resolvePromise))
  const killed = client.child.kill()
  if (!killed) throw new Error('Could not terminate nd-core for forced cleanup test.')
  await exited

  let parentAlive = true
  let childAlive = true
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    parentAlive = await pidAlive(managedPid)
    childAlive = await pidAlive(descendantPid)
    if (!parentAlive && !childAlive) break
    await sleep(50)
  }

  const receipt = {
    schemaVersion: 1,
    benchmark: 'windows-forced-core-crash-cleanup',
    status: !parentAlive && !childAlive ? 'pass' : 'fail',
    coreBinary: binary,
    corePid: client.pid,
    managedPid,
    descendantPid,
    managedAliveAfterCoreExit: parentAlive,
    descendantAliveAfterCoreExit: childAlive,
  }
  await fs.mkdir(dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  if (receipt.status !== 'pass') throw new Error('Forced nd-core termination left a managed Windows process tree alive.')
  console.log(JSON.stringify(receipt, null, 2))
} finally {
  await client.close().catch(() => undefined)
}
