#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessSource = join(root, 'vendor', 'deepseek-harness')
const stageRoot = join(root, '.release')
const harnessOutput = join(stageRoot, 'harness')
const codexOutput = join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex')
const pencilBuildScript = join(root, 'scripts', 'build-nd-pencil.mjs')
const pencilBinaryName = process.platform === 'win32' ? 'op-host-web-server.exe' : 'op-host-web-server'
const pencilBinary = join(root, 'resources', 'nd-pencil', 'bin', pencilBinaryName)
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'

assertInsideRoot(stageRoot)
await requireFile(join(harnessSource, 'package.json'), 'Harness source manifest')
await requireFile(join(harnessSource, 'pnpm-lock.yaml'), 'Harness lockfile')

console.log('\nBuilding the Harness host runtime...')
await run(corepack, ['pnpm', '--dir', harnessSource, 'run', 'build:lib:host'], root)

console.log('\nCreating the portable Harness production closure...')
await fs.rm(harnessOutput, { recursive: true, force: true })
await fs.mkdir(stageRoot, { recursive: true })
// The upstream CLI intentionally declares its runtime plugin graph through
// peer + dev dependencies. A production-only deploy silently drops those
// peers, producing a package that cannot boot. Keep the CLI's complete,
// upstream-defined closure and use a production closure for the isolated
// Codex adapter.
await deploy('@deepseek-ai/dsh', harnessOutput, false)
await deploy('@deepseek-ai/dsh-subagent-codex', codexOutput, true)
await fs.copyFile(join(harnessSource, 'LICENSE'), join(harnessOutput, 'LICENSE'))
await fs.copyFile(join(harnessSource, 'THIRD_PARTY_NOTICES.md'), join(harnessOutput, 'THIRD_PARTY_NOTICES.md'))

console.log('\nBuilding and staging the ND Pencil runtime...')
await run(process.execPath, [pencilBuildScript], root)

const required = [
  join(harnessOutput, 'lib', 'bin.js'),
  join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-mcp-client', 'lib', 'index.js'),
  join(codexOutput, 'lib', 'index.js'),
  join(codexOutput, 'node_modules', '@openai', 'codex', 'package.json'),
  join(root, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js'),
  pencilBinary,
  join(root, 'resources', 'nd-pencil', 'bin', 'web-bundle', 'op_host_web.js'),
  join(root, 'resources', 'nd-pencil', 'bin', 'web-bundle', 'op_host_web_bg.wasm'),
]
for (const path of required) await requireFile(path, 'Release runtime file')

// Exercise the deployed entry with plain Node before electron-builder copies it.
await run(process.execPath, [join(harnessOutput, 'lib', 'bin.js'), '--help'], root)

const rootManifest = await readJson(join(root, 'package.json'))
const harnessManifest = await readJson(join(harnessOutput, 'package.json'))
const agentBrowserManifest = await readJson(join(root, 'node_modules', 'agent-browser', 'package.json'))
const pencilPin = await readJson(join(root, 'vendor', 'openpencil.json'))
const harnessCommit = await gitHead(harnessSource)
const pencilCommit = await gitHead(join(root, 'vendor', 'openpencil'))
if (pencilPin.commit !== pencilCommit) {
  throw new Error(`ND Pencil source pin mismatch: expected ${String(pencilPin.commit)}, found ${pencilCommit}`)
}

const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  appVersion: rootManifest.version,
  platform: process.platform,
  arch: process.arch,
  nodeRuntime: { mode: 'electron-run-as-node', electronVersion: rootManifest.devDependencies?.electron },
  harness: { version: harnessManifest.version, commit: harnessCommit },
  ndPencil: { version: pencilPin.release, commit: pencilCommit, sha256: await sha256(pencilBinary) },
  agentBrowser: { version: agentBrowserManifest.version },
}
await fs.writeFile(join(stageRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log('\nRelease runtime staged successfully.')
console.log(`Harness: ${harnessManifest.version} @ ${harnessCommit.slice(0, 12)}`)
console.log(`ND Pencil: ${pencilPin.release} @ ${pencilCommit.slice(0, 12)}`)
console.log(`Manifest: ${join(stageRoot, 'release-manifest.json')}`)

async function deploy(packageName, destination, productionOnly) {
  assertInsideRoot(destination)
  await run(corepack, [
    'pnpm', '--dir', harnessSource, '--ignore-scripts',
    '--filter', packageName, ...(productionOnly ? ['--prod'] : []),
    'deploy', '--legacy', destination,
  ], root)
}

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      shell: needsWindowsShell(command),
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
      windowsHide: true,
      shell: needsWindowsShell(command),
      env: process.env,
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

async function gitHead(cwd) {
  return (await capture('git', ['rev-parse', 'HEAD'], cwd)).trim().toLowerCase()
}

async function requireFile(path, label) {
  let stats
  try { stats = await fs.stat(path) } catch { /* handled below */ }
  if (!stats?.isFile()) throw new Error(`${label} is missing: ${path}`)
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'))
}

async function sha256(path) {
  return createHash('sha256').update(await fs.readFile(path)).digest('hex')
}

function assertInsideRoot(path) {
  const location = relative(root, resolve(path))
  if (!location || location.startsWith('..') || resolve(root, location) !== resolve(path)) {
    throw new Error(`Unsafe release staging path: ${path}`)
  }
}

function needsWindowsShell(command) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)
}
