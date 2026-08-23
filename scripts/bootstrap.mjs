#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'vendor', 'deepseek-harness')
const ndPencilUpstreamRoot = join(root, 'vendor', 'openpencil')
const harnessPin = JSON.parse(await fs.readFile(join(root, 'vendor', 'deepseek-harness.json'), 'utf8'))
const ndPencilUpstreamPin = JSON.parse(await fs.readFile(join(root, 'vendor', 'openpencil.json'), 'utf8'))
const harnessRepository = requireString(harnessPin.repository, 'vendor/deepseek-harness.json repository')
const harnessCommit = requireCommit(harnessPin.commit, 'Harness commit')
const ndPencilUpstreamRepository = requireString(ndPencilUpstreamPin.repository, 'vendor/openpencil.json repository')
const ndPencilUpstreamCommit = requireCommit(ndPencilUpstreamPin.commit, 'ND Pencil upstream commit')
const flags = new Set(process.argv.slice(2))

if (flags.has('--help')) {
  console.log(`Usage: node scripts/bootstrap.mjs [options]\n\n` +
    `  --check                Verify prerequisites and pinned upstream sources only\n` +
    `  --skip-root-install    Skip the ND-DSH pnpm install\n` +
    `  --skip-dsh-build       Skip install/build inside DeepSeek Harness\n` +
    `  --build-nd-pencil      Compile and stage the bundled ND Pencil runtime\n`)
  process.exit(0)
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
if (nodeMajor < 24) {
  throw new Error(`Node.js 24 or newer is required by agent-browser. Current: ${process.version}`)
}

await ensurePinnedSource({
  name: 'Harness',
  root: harnessRoot,
  marker: 'package.json',
  submodulePath: 'vendor/deepseek-harness',
  repository: harnessRepository,
  commit: harnessCommit,
})
await ensurePinnedSource({
  name: 'ND Pencil upstream',
  root: ndPencilUpstreamRoot,
  marker: 'Cargo.toml',
  submodulePath: 'vendor/openpencil',
  repository: ndPencilUpstreamRepository,
  commit: ndPencilUpstreamCommit,
})
await verifyPinnedSource('Harness', harnessRoot, harnessCommit)
await verifyPinnedSource('ND Pencil upstream', ndPencilUpstreamRoot, ndPencilUpstreamCommit)

if (flags.has('--check')) {
  console.log('Bootstrap check passed for DeepSeek Harness and the ND Pencil upstream source.')
  process.exit(0)
}

if (!flags.has('--skip-root-install')) {
  await run('corepack', ['pnpm', 'install'], root)
}

if (!flags.has('--skip-dsh-build')) {
  await run('corepack', ['pnpm', 'install', '--frozen-lockfile'], harnessRoot)
  await run('corepack', ['pnpm', 'run', 'build'], harnessRoot)
}

if (flags.has('--build-nd-pencil')) {
  await run(process.execPath, ['scripts/build-nd-pencil.mjs'], root)
} else {
  console.log('\nND Pencil upstream source is pinned and ready. Run `pnpm nd-pencil:build` when developing the embedded Freeform canvas.')
}

await run('corepack', ['pnpm', 'verify'], root)
console.log('\nND-DSH bootstrap complete. Configure a model provider in Settings (or use DEEPSEEK_API_KEY for the compatibility route), then run:')
console.log('  corepack pnpm dev')
console.log('Codex CLI is available as an optional coding engine when native Codex authentication is configured.')

async function ensurePinnedSource({ name, root: sourceRoot, marker, submodulePath, repository, commit }) {
  if (existsSync(join(sourceRoot, marker))) return

  await fs.mkdir(dirname(sourceRoot), { recursive: true })
  if (existsSync(join(root, '.git'))) {
    console.log(`Initializing pinned ${name} submodule...`)
    await run('git', ['submodule', 'sync', '--', submodulePath], root)
    await run('git', ['submodule', 'update', '--init', '--recursive', '--', submodulePath], root)
  } else {
    console.log(`Source archive detected; cloning the pinned ${name} checkout...`)
    await run('git', ['clone', '--filter=blob:none', '--no-checkout', repository, sourceRoot], root)
    await run('git', ['fetch', '--depth=1', 'origin', commit], sourceRoot)
    await run('git', ['checkout', '--detach', commit], sourceRoot)
    await run('git', ['submodule', 'update', '--init', '--recursive'], sourceRoot)
  }

  if (!existsSync(join(sourceRoot, marker))) throw new Error(`Pinned ${name} source was not initialized correctly.`)
}

async function verifyPinnedSource(name, sourceRoot, expectedCommit) {
  const status = await capture('git', ['status', '--porcelain'], sourceRoot)
  if (status.trim()) throw new Error(`${name} submodule has local changes. Clean it before bootstrapping.`)

  let current = (await capture('git', ['rev-parse', 'HEAD'], sourceRoot)).trim().toLowerCase()
  if (current !== expectedCommit) {
    console.log(`Checking out pinned ${name} commit ${expectedCommit}...`)
    await run('git', ['fetch', 'origin', expectedCommit, '--depth=1'], sourceRoot)
    await run('git', ['checkout', '--detach', expectedCommit], sourceRoot)
    await run('git', ['submodule', 'update', '--init', '--recursive'], sourceRoot)
    current = (await capture('git', ['rev-parse', 'HEAD'], sourceRoot)).trim().toLowerCase()
  }
  if (current !== expectedCommit) throw new Error(`${name} pin mismatch: expected ${expectedCommit}, found ${current}`)
  console.log(`${name} pinned at ${current.slice(0, 12)}.`)
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is invalid`)
  return value.trim()
}

function requireCommit(value, field) {
  const commit = requireString(value, field)
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`${field} must be a full 40-character SHA`)
  return commit.toLowerCase()
}

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(platformExecutable(command), args, {
      cwd,
      stdio: 'inherit',
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
    const child = spawn(platformExecutable(command), args, {
      cwd,
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

function platformExecutable(command) {
  return process.platform === 'win32' && command === 'corepack' ? 'corepack.cmd' : command
}
