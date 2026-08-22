#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'vendor', 'openpencil.json')
const errors = []
let release = ''
let commit = ''

for (const path of [
  '.gitmodules',
  'vendor/openpencil.json',
  'vendor/openpencil.LICENSE',
  'docs/nd-pencil.md',
  'resources/nd-pencil/LICENSE.openpencil',
  'resources/nd-pencil/README.md',
  'src/shared/design.ts',
  'src/main/design/openpencil-controller.ts',
  'src/preload/nd-pencil.ts',
  'scripts/build-nd-pencil.mjs',
]) {
  if (!existsSync(join(root, path))) errors.push(`missing ND Pencil integration file: ${path}`)
}

if (existsSync(manifestPath)) {
  const pin = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const repository = typeof pin.repository === 'string' ? pin.repository : ''
  commit = typeof pin.commit === 'string' ? pin.commit.toLowerCase() : ''
  release = typeof pin.release === 'string' ? pin.release : ''
  const license = typeof pin.license === 'string' ? pin.license : ''

  if (repository !== 'https://github.com/ZSeven-W/openpencil.git') errors.push('ND Pencil upstream pin must use the canonical ZSeven-W/openpencil repository')
  if (!/^[0-9a-f]{40}$/.test(commit)) errors.push('ND Pencil upstream pin must contain a full 40-character commit SHA')
  if (!release) errors.push('ND Pencil upstream pin must include an upstream release')
  if (license !== 'MIT') errors.push('ND Pencil upstream pin must record the MIT license')

  const gitmodulesPath = join(root, '.gitmodules')
  if (existsSync(gitmodulesPath)) {
    const gitmodules = await fs.readFile(gitmodulesPath, 'utf8')
    if (!gitmodules.includes(repository)) errors.push('.gitmodules is missing the pinned ND Pencil upstream repository')
    if (/\[submodule "vendor\/openpencil"\][\s\S]*?^\s*branch\s*=/m.test(gitmodules)) errors.push('Pinned ND Pencil upstream submodule must not track a moving branch')
  }

  const vendorLicensePath = join(root, 'vendor', 'openpencil.LICENSE')
  const runtimeLicensePath = join(root, 'resources', 'nd-pencil', 'LICENSE.openpencil')
  if (existsSync(vendorLicensePath)) {
    const licenseText = await fs.readFile(vendorLicensePath, 'utf8')
    if (!licenseText.startsWith('MIT License') || !licenseText.includes('Copyright (c) 2026 ZSeven—W')) {
      errors.push('vendor/openpencil.LICENSE must preserve the upstream MIT notice')
    }
    if (existsSync(runtimeLicensePath)) {
      const runtimeLicenseText = await fs.readFile(runtimeLicensePath, 'utf8')
      if (runtimeLicenseText !== licenseText) errors.push('resources/nd-pencil/LICENSE.openpencil must exactly match the tracked upstream MIT notice')
    }
  }

  const upstreamRoot = join(root, 'vendor', 'openpencil')
  if (existsSync(join(upstreamRoot, 'Cargo.toml'))) {
    try {
      const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstreamRoot, encoding: 'utf8' }).trim().toLowerCase()
      if (actual !== commit) errors.push(`ND Pencil upstream pin mismatch: expected ${commit}, found ${actual}`)
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: upstreamRoot, encoding: 'utf8' }).trim()
      if (status) errors.push('ND Pencil upstream submodule has local changes')
    } catch (cause) {
      errors.push(`Could not verify ND Pencil upstream checkout: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

// This filename intentionally records the current upstream adapter provenance;
// the exported class/product contract is ND Pencil and must stay that way.
const controllerPath = join(root, 'src', 'main', 'design', 'openpencil-controller.ts')
if (existsSync(controllerPath)) {
  const controller = await fs.readFile(controllerPath, 'utf8')
  for (const needle of [
    'export class NdPencilController',
    "engine: 'nd-pencil'",
    'process.resourcesPath',
    "'nd-pencil'",
    'ND_PENCIL_BINARY',
    '--managed',
    '--allow-origin',
    'contextIsolation: true',
    'sandbox: true',
    'setPermissionRequestHandler',
    'setWindowOpenHandler',
    "'/api/auth/'",
    "'/api/collab/'",
    "'/api/ai/'",
    "'/mcp-tokens'",
  ]) {
    if (!controller.includes(needle)) errors.push(`ND Pencil controller is missing required product/security invariant: ${needle}`)
  }
  for (const forbidden of ['openpencil-desktop', 'which openpencil', 'where openpencil', 'ND_OPENPENCIL_BINARY']) {
    if (controller.includes(forbidden)) errors.push(`ND Pencil must not require a separately installed upstream runtime (${forbidden})`)
  }
}

const buildScriptPath = join(root, 'scripts', 'build-nd-pencil.mjs')
if (existsSync(buildScriptPath)) {
  const buildScript = await fs.readFile(buildScriptPath, 'utf8')
  for (const needle of [
    "'-p', 'op-host-web-server'",
    "'-p', 'op-host-web'",
    "'--features', 'canvaskit'",
    "'wasm-bindgen'",
    "'nd-pencil'",
    "'web-bundle'",
    "'op_host_web_bg.wasm'",
    "'canvaskit.wasm'",
    "'prompt_center_previews'",
    "'scene_templates'",
    "'LICENSE.openpencil'",
  ]) {
    if (!buildScript.includes(needle)) errors.push(`ND Pencil build staging is incomplete; missing ${needle}`)
  }
}

const designContractsPath = join(root, 'src', 'shared', 'design.ts')
if (existsSync(designContractsPath)) {
  const contracts = await fs.readFile(designContractsPath, 'utf8')
  for (const needle of ["engine: 'nd-pencil'", 'ND_PENCIL_HOST_IPC', 'freeformOpen', 'freeformSave', 'freeformSetVisible']) {
    if (!contracts.includes(needle)) errors.push(`ND Pencil design contract is missing ${needle}`)
  }
}

const rendererPath = join(root, 'src', 'renderer', 'src', 'components', 'DesignView.tsx')
if (existsSync(rendererPath)) {
  const renderer = await fs.readFile(rendererPath, 'utf8')
  for (const needle of ['ND Pencil', 'Build ND Pencil into app']) {
    if (!renderer.includes(needle)) errors.push(`ND Pencil renderer is missing product identity ${needle}`)
  }
  if (renderer.includes('OpenPencil')) errors.push('ND product renderer must not expose the upstream OpenPencil product name')
}

for (const retiredPath of [
  'src/preload/openpencil.ts',
  'scripts/build-openpencil.mjs',
  'scripts/verify-openpencil.mjs',
  'resources/openpencil/README.md',
  'resources/openpencil/LICENSE',
]) {
  if (existsSync(join(root, retiredPath))) errors.push(`retired OpenPencil product-facing path must be removed: ${retiredPath}`)
}

if (errors.length) {
  console.error('\nND Pencil integration verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`ND Pencil product boundary verified${release && commit ? ` (MIT upstream ${release} @ ${commit.slice(0, 12)})` : ''}.`)
