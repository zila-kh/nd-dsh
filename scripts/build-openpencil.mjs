#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const openPencilRoot = join(root, 'vendor', 'openpencil')
const manifestPath = join(openPencilRoot, 'Cargo.toml')
const lockPath = join(openPencilRoot, 'Cargo.lock')
const binaryName = process.platform === 'win32' ? 'op-host-web-server.exe' : 'op-host-web-server'
const builtBinary = join(openPencilRoot, 'target', 'release', binaryName)
const wasmTarget = join(openPencilRoot, 'target', 'wasm32-unknown-unknown', 'release', 'op_host_web.wasm')
const webPkg = join(openPencilRoot, 'crates', 'op-host-web', 'pkg')
const canvaskit = join(openPencilRoot, 'crates', 'op-host-web', 'assets', 'canvaskit')
const stagedDirectory = join(root, 'resources', 'openpencil', 'bin')
const stagedBinary = join(stagedDirectory, binaryName)
const stagedBundle = join(stagedDirectory, 'web-bundle')

if (!existsSync(manifestPath) || !existsSync(lockPath)) {
  throw new Error('Pinned OpenPencil source is missing. Run `pnpm bootstrap -- --check` or initialize vendor/openpencil first.')
}

// Build from the upstream checkout so rustup honors OpenPencil's pinned
// rust-toolchain.toml instead of whichever Rust happens to be active for ND.
await run('cargo', ['build', '--release', '-p', 'op-host-web-server'], openPencilRoot)
if (!existsSync(builtBinary)) throw new Error(`OpenPencil build completed without ${builtBinary}`)

await run('rustup', ['target', 'add', 'wasm32-unknown-unknown'], openPencilRoot)
const wasmBindgenVersion = await readLockedPackageVersion(lockPath, 'wasm-bindgen')
if (!await commandMatchesVersion('wasm-bindgen', wasmBindgenVersion, openPencilRoot)) {
  console.log(`Installing wasm-bindgen-cli ${wasmBindgenVersion} required by the pinned OpenPencil checkout...`)
  await run('cargo', ['install', 'wasm-bindgen-cli', '--version', wasmBindgenVersion, '--locked'], openPencilRoot)
}

await run('cargo', [
  'build',
  '-p', 'op-host-web',
  '--target', 'wasm32-unknown-unknown',
  '--no-default-features',
  '--features', 'canvaskit',
  '--release',
], openPencilRoot)
if (!existsSync(wasmTarget)) throw new Error(`OpenPencil web build completed without ${wasmTarget}`)

await fs.rm(webPkg, { recursive: true, force: true })
await fs.mkdir(webPkg, { recursive: true })
await run('wasm-bindgen', ['--target', 'web', '--out-dir', webPkg, wasmTarget], openPencilRoot)
await stageRuntimeAssets(openPencilRoot, join(webPkg, 'assets'))

if (!existsSync(join(webPkg, 'op_host_web.js')) || !existsSync(join(webPkg, 'op_host_web_bg.wasm'))) {
  throw new Error('OpenPencil wasm-bindgen bundle is incomplete')
}
if (!existsSync(join(canvaskit, 'canvaskit.js')) || !existsSync(join(canvaskit, 'canvaskit.wasm'))) {
  throw new Error('Pinned OpenPencil checkout is missing its CanvasKit runtime assets')
}

await fs.rm(stagedDirectory, { recursive: true, force: true })
await fs.mkdir(stagedDirectory, { recursive: true })
await fs.copyFile(builtBinary, stagedBinary)
if (process.platform !== 'win32') await fs.chmod(stagedBinary, 0o755)
await fs.cp(webPkg, stagedBundle, { recursive: true })
await fs.cp(canvaskit, join(stagedBundle, 'canvaskit'), { recursive: true })

for (const required of [
  'op_host_web.js',
  'op_host_web_bg.wasm',
  'canvaskit/canvaskit.js',
  'canvaskit/canvaskit.wasm',
  'assets/prompt_center_previews',
  'assets/scene_template_previews',
  'assets/scene_templates',
  'assets/iconify-catalog-core.json',
]) {
  if (!existsSync(join(stagedBundle, required))) throw new Error(`Staged OpenPencil web bundle is missing ${required}`)
}

console.log(`\nOpenPencil Freeform runtime staged for ND: ${stagedDirectory}`)
console.log('The staged layout contains the host binary, web-bundle, CanvasKit, and runtime-fetched design assets.')
console.log('Packaged ND builds should copy resources/openpencil into process.resourcesPath/openpencil.')

async function readLockedPackageVersion(path, packageName) {
  const lock = await fs.readFile(path, 'utf8')
  const blocks = lock.split(/\n\[\[package\]\]\n/g)
  for (const block of blocks) {
    if (!new RegExp(`^name = ["']${escapeRegExp(packageName)}["']$`, 'm').test(block)) continue
    const version = /^version = ["']([^"']+)["']$/m.exec(block)?.[1]
    if (version) return version
  }
  throw new Error(`Could not resolve ${packageName} version from ${path}`)
}

async function commandMatchesVersion(command, version, cwd) {
  try {
    const output = await capture(command, ['--version'], cwd)
    return output.includes(version)
  } catch {
    return false
  }
}

async function stageRuntimeAssets(openPencilRoot, destination) {
  const uiAssets = join(openPencilRoot, 'crates', 'op-editor-ui', 'assets')
  const coreAssets = join(openPencilRoot, 'crates', 'op-editor-core', 'assets')
  await fs.mkdir(destination, { recursive: true })
  await copyAssetDirectory(join(uiAssets, 'prompt_center_previews'), join(destination, 'prompt_center_previews'))
  await copyAssetDirectory(join(uiAssets, 'scene_template_previews'), join(destination, 'scene_template_previews'))
  await copyAssetDirectory(join(coreAssets, 'scene_templates'), join(destination, 'scene_templates'))
  await fs.copyFile(join(uiAssets, 'iconify-catalog-core.json'), join(destination, 'iconify-catalog-core.json'))
}

async function copyAssetDirectory(source, destination) {
  if (!existsSync(source)) throw new Error(`OpenPencil runtime asset source is missing: ${source}`)
  await fs.cp(source, destination, { recursive: true })
  await fs.rm(join(destination, 'preview_provenance.json'), { force: true })
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
