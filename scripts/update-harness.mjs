#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'vendor', 'deepseek-harness')
const pinPath = join(root, 'vendor', 'deepseek-harness.json')
const vendorReadmePath = join(root, 'vendor', 'README.md')
const projectReadmePath = join(root, 'README.md')
const requestedRef = process.argv[2]?.trim()

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/update-harness.mjs <tag-or-commit>')
  console.log('Fetches one explicit upstream ref, checks it out detached, and records the exact resulting commit.')
  process.exit(0)
}

if (!requestedRef || requestedRef.startsWith('-') || /\s/.test(requestedRef)) {
  console.error('An explicit DeepSeek Harness tag or commit is required.')
  console.error('Example: corepack pnpm run dsh:update -- 141eb6fef83422698aef7a981029e843e8161534')
  process.exit(1)
}
if (!existsSync(join(harnessRoot, '.git'))) {
  throw new Error('DeepSeek Harness is not initialized. Run corepack pnpm bootstrap first.')
}

const status = await capture('git', ['status', '--porcelain'], harnessRoot)
if (status.trim()) throw new Error('DeepSeek Harness has local changes. Clean the submodule before updating it.')

await run('git', ['fetch', '--depth=1', 'origin', requestedRef], harnessRoot)
await run('git', ['checkout', '--detach', 'FETCH_HEAD'], harnessRoot)

const commit = (await capture('git', ['rev-parse', 'HEAD'], harnessRoot)).trim()
const packageJson = JSON.parse(await fs.readFile(join(harnessRoot, 'package.json'), 'utf8'))
const release = typeof packageJson.version === 'string' ? packageJson.version : 'unknown'
const currentPin = JSON.parse(await fs.readFile(pinPath, 'utf8'))
const repository = typeof currentPin.repository === 'string'
  ? currentPin.repository
  : 'https://github.com/deepseek-ai/deepseek-harness.git'

await fs.writeFile(pinPath, `${JSON.stringify({ repository, commit, release }, null, 2)}\n`)
await updateTextFile(vendorReadmePath, commit, release)
await updateTextFile(projectReadmePath, commit, release)

console.log(`Harness checked out at ${commit} (${release}).`)
console.log('Review upstream breaking changes and adapters, run bootstrap/checks, then commit the gitlink and pin metadata together.')

async function updateTextFile(path, nextCommit, nextRelease) {
  let content = await fs.readFile(path, 'utf8')
  content = content.replace(/commit\s+`[0-9a-f]{40}`/i, `commit \`${nextCommit}\``)
  content = content.replace(/commit:\s+`[0-9a-f]{40}`/i, `commit: \`${nextCommit}\``)
  content = content.replace(/\(`[^`]+`\)\./, `(\`${nextRelease}\`).`)
  content = content.replace(/release at that commit:\s+`[^`]+`/i, `release at that commit: \`${nextRelease}\``)
  await fs.writeFile(path, content)
}

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
    child.once('close', (code) => code === 0
      ? resolvePromise(stdout)
      : reject(new Error(stderr.trim() || `${command} exited with ${String(code)}`)))
  })
}
