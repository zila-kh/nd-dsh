/**
 * Minimal reproduction: boot the vendored dsh web profile the same way
 * HarnessService does and probe POST /api/session.create.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const cliBin = process.env.ND_DSH_HARNESS_ROOT ? join(process.env.ND_DSH_HARNESS_ROOT, 'apps/cli/lib/bin.js') : join(REPO, 'vendor/deepseek-harness/apps/cli/lib/bin.js')
const patchPath = join(REPO, 'configs/dsh/nd-dsh.patch.yml')
const cwd = process.env.PROBE_CWD ?? 'C:\\Users\\dila\\Documents\\GitHub\\nd-dsh-todo-fullstack'

const providers = JSON.parse(readFileSync(join(process.env.USERPROFILE ?? '', 'AppData/Local/Temp/nd-dsh-e2e-fullstack/providers.seed.json'), 'utf8'))
const keyEnv = `ND_DSH_LLM_KEY_${Buffer.from('omiroute').toString('hex').toUpperCase()}`
void keyEnv

const port = 25117

const child = spawn('node', [cliBin, '--profile', 'web', '--patch', patchPath, '--no-open', '--port', String(port)], {
  cwd: join(REPO, 'vendor/deepseek-harness'),
  env: {
    ...process.env,
    ND_DSH_LLM_PROVIDERS_JSON: JSON.stringify(Object.fromEntries(providers.map((p) => [p.id, { displayName: p.name, api: 'openai-completions', baseURL: p.baseUrl, models: p.models.map((m) => ({ id: m.id })) }]))),
    ND_DSH_DEFAULT_PROVIDER: 'omiroute',
    ND_DSH_DEFAULT_MODEL: 'auto/coding:pro',
    DSH_HOME: join(process.env.TEMP ?? '.', 'nd-dsh-probe-home'),
    DSH_CWD: cwd,
    DSH_PERMISSION_MODE: 'workspace-write',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (d) => process.stdout.write(`[rt-out] ${d}`))
child.stderr.on('data', (d) => process.stderr.write(`[rt-err] ${d}`))

async function ready() {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`runtime exited early: ${child.exitCode}`)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`)
      if (res.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('runtime never became ready')
}
await ready()
console.log(`[probe] runtime ready on ${port}`)

for (const method of ['session.create', 'session.list']) {
  const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${Date.now()}`, method, payload: method === 'session.create' ? { cwd } : {} }),
  })
  const text = await res.text()
  console.log(`[probe] POST /api/${method} -> HTTP ${res.status}: ${text.slice(0, 400)}`)
}

child.kill('SIGTERM')
process.exit(0)
