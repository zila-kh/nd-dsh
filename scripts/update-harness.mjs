#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'vendor', 'deepseek-harness')
const pinPath = join(root, 'vendor', 'deepseek-harness.json')
const requestedRef = process.argv[2]?.trim()

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/update-harness.mjs [tag-or-commit]')
  console.log('Syncs the Harness submodule to the latest upstream commit by default.')
  console.log('An explicit ref is available for debugging or downgrades only.')
  process.exit(0)
}

if (requestedRef !== undefined && (!requestedRef || requestedRef.startsWith('-') || /\s/.test(requestedRef))) {
  console.error('An explicit DeepSeek Harness ref must be a single tag or commit.')
  console.error('Example: corepack pnpm dsh:update              # sync to upstream latest')
  console.error('         corepack pnpm dsh:update -- <tag-or-commit>')
  process.exit(1)
}
if (!existsSync(join(harnessRoot, '.git'))) {
  throw new Error('DeepSeek Harness is not initialized. Run corepack pnpm bootstrap first.')
}

const status = await capture('git', ['status', '--porcelain'], harnessRoot)
if (status.trim()) throw new Error('DeepSeek Harness has local changes. Clean the submodule before updating it.')

const currentPin = JSON.parse(await fs.readFile(pinPath, 'utf8'))
const repository = typeof currentPin.repository === 'string'
  ? currentPin.repository
  : 'https://github.com/deepseek-ai/deepseek-harness.git'
const branch = typeof currentPin.branch === 'string' && currentPin.branch.trim()
  ? currentPin.branch.trim()
  : 'master'

await run('git', ['fetch', '--depth=1', 'origin', requestedRef ?? branch], harnessRoot)
await run('git', ['checkout', '--detach', 'FETCH_HEAD'], harnessRoot)
await run('git', ['submodule', 'update', '--init', '--recursive'], harnessRoot)

const commit = (await capture('git', ['rev-parse', 'HEAD'], harnessRoot)).trim()
const packageJson = JSON.parse(await fs.readFile(join(harnessRoot, 'package.json'), 'utf8'))
const release = typeof packageJson.version === 'string' ? packageJson.version : 'unknown'

// Provenance snapshot of the last sync; informational only, nothing pins to it.
await fs.writeFile(pinPath, `${JSON.stringify({ repository, branch, lastSyncedCommit: commit, lastSyncedRelease: release }, null, 2)}\n`)

console.log(requestedRef
  ? `Harness synced to explicit ref ${requestedRef} at ${commit} (${release}).`
  : `Harness synced to upstream ${branch} latest at ${commit} (${release}).`)
console.log('Review upstream breaking changes against the ND overlay and adapters, run corepack pnpm verify && corepack pnpm test, then commit the moved submodule gitlink together with any adapter fixes.')

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} exited with ${String(code)}`)))
  })
}

function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell: process.platform === 'win32', windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) return resolvePromise(stdout)
      reject(new Error(stderr.trim() || `${command} exited with code ${String(code)}`))
    })
  })
}
