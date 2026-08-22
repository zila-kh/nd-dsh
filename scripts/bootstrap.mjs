#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'vendor', 'deepseek-harness')
const pin = JSON.parse(await fs.readFile(join(root, 'vendor', 'deepseek-harness.json'), 'utf8'))
const harnessRepository = requireString(pin.repository, 'repository')
const harnessCommit = requireCommit(pin.commit)
const flags = new Set(process.argv.slice(2))

if (flags.has('--help')) {
  console.log(`Usage: node scripts/bootstrap.mjs [options]\n\n` +
    `  --check             Verify prerequisites and the pinned submodule only\n` +
    `  --skip-root-install Skip the ND-DSH pnpm install\n` +
    `  --skip-dsh-build    Skip install/build inside DeepSeek Harness\n`)
  process.exit(0)
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
if (nodeMajor < 24) {
  throw new Error(`Node.js 24 or newer is required by agent-browser. Current: ${process.version}`)
}

await ensureHarnessSource()
await verifyHarnessPin()

if (flags.has('--check')) {
  console.log('Bootstrap check passed.')
  process.exit(0)
}

if (!flags.has('--skip-root-install')) {
  await run('corepack', ['pnpm', 'install'], root)
}

if (!flags.has('--skip-dsh-build')) {
  await run('corepack', ['pnpm', 'install', '--frozen-lockfile'], harnessRoot)
  await run('corepack', ['pnpm', 'run', 'build'], harnessRoot)
}

await run(process.execPath, ['scripts/verify.mjs'], root)
console.log('\nND-DSH bootstrap complete. Configure a model provider in Settings (or use DEEPSEEK_API_KEY for the compatibility route), then run:')
console.log('  corepack pnpm dev')
console.log('Codex CLI is available as an optional coding engine when native Codex authentication is configured.')

async function ensureHarnessSource() {
  const packagePath = join(harnessRoot, 'package.json')
  if (existsSync(packagePath)) return

  await fs.mkdir(dirname(harnessRoot), { recursive: true })
  if (existsSync(join(root, '.git'))) {
    console.log('Initializing pinned Harness submodule...')
    await run('git', ['submodule', 'sync', '--', 'vendor/deepseek-harness'], root)
    await run('git', ['submodule', 'update', '--init', '--recursive', '--', 'vendor/deepseek-harness'], root)
  } else {
    console.log('Source archive detected; cloning the pinned Harness checkout...')
    await run('git', ['clone', '--filter=blob:none', '--no-checkout', harnessRepository, harnessRoot], root)
    await run('git', ['fetch', '--depth=1', 'origin', harnessCommit], harnessRoot)
    await run('git', ['checkout', '--detach', harnessCommit], harnessRoot)
  }

  if (!existsSync(packagePath)) throw new Error('Pinned Harness source was not initialized correctly.')
}

async function verifyHarnessPin() {
  const status = await capture('git', ['status', '--porcelain'], harnessRoot)
  if (status.trim()) throw new Error('Harness submodule has local changes. Clean it before bootstrapping.')

  let current = (await capture('git', ['rev-parse', 'HEAD'], harnessRoot)).trim()
  if (current !== harnessCommit) {
    console.log(`Checking out pinned Harness commit ${harnessCommit}...`)
    await run('git', ['fetch', 'origin', harnessCommit, '--depth=1'], harnessRoot)
    await run('git', ['checkout', '--detach', harnessCommit], harnessRoot)
    current = (await capture('git', ['rev-parse', 'HEAD'], harnessRoot)).trim()
  }
  if (current !== harnessCommit) throw new Error(`Harness pin mismatch: expected ${harnessCommit}, found ${current}`)
  console.log(`Harness pinned at ${current.slice(0, 12)}.`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`vendor/deepseek-harness.json has an invalid ${field}`)
  return value.trim()
}

function requireCommit(value) {
  const commit = requireString(value, 'commit')
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error('Harness commit must be a full 40-character SHA')
  return commit.toLowerCase()
}

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with code ${String(code)}`))
    })
  })
}

function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      env: process.env,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(stderr.trim() || `${command} exited with code ${String(code)}`))
    })
  })
}
