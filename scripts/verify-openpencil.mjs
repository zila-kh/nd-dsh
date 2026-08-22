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
  'resources/openpencil/LICENSE',
  'resources/openpencil/README.md',
  'src/shared/design.ts',
  'src/main/design/openpencil-controller.ts',
  'src/preload/openpencil.ts',
  'scripts/build-openpencil.mjs',
]) {
  if (!existsSync(join(root, path))) errors.push(`missing OpenPencil integration file: ${path}`)
}

if (existsSync(manifestPath)) {
  const pin = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const repository = typeof pin.repository === 'string' ? pin.repository : ''
  commit = typeof pin.commit === 'string' ? pin.commit.toLowerCase() : ''
  release = typeof pin.release === 'string' ? pin.release : ''
  const license = typeof pin.license === 'string' ? pin.license : ''

  if (repository !== 'https://github.com/ZSeven-W/openpencil.git') errors.push('OpenPencil pin must use the canonical ZSeven-W/openpencil repository')
  if (!/^[0-9a-f]{40}$/.test(commit)) errors.push('OpenPencil pin must contain a full 40-character commit SHA')
  if (!release) errors.push('OpenPencil pin must include an upstream release')
  if (license !== 'MIT') errors.push('OpenPencil pin must record the MIT license')

  const gitmodulesPath = join(root, '.gitmodules')
  if (existsSync(gitmodulesPath)) {
    const gitmodules = await fs.readFile(gitmodulesPath, 'utf8')
    if (!gitmodules.includes(repository)) errors.push('.gitmodules is missing the pinned OpenPencil repository')
    if (/\[submodule "vendor\/openpencil"\][\s\S]*?^\s*branch\s*=/m.test(gitmodules)) errors.push('Pinned OpenPencil submodule must not track a moving branch')
  }

  const vendorLicensePath = join(root, 'vendor', 'openpencil.LICENSE')
  const runtimeLicensePath = join(root, 'resources', 'openpencil', 'LICENSE')
  if (existsSync(vendorLicensePath)) {
    const licenseText = await fs.readFile(vendorLicensePath, 'utf8')
    if (!licenseText.startsWith('MIT License') || !licenseText.includes('Copyright (c) 2026 ZSeven—W')) {
      errors.push('vendor/openpencil.LICENSE must preserve the upstream MIT notice')
    }
    if (existsSync(runtimeLicensePath)) {
      const runtimeLicenseText = await fs.readFile(runtimeLicensePath, 'utf8')
      if (runtimeLicenseText !== licenseText) errors.push('resources/openpencil/LICENSE must exactly match the tracked upstream MIT notice')
    }
  }

  const openPencilRoot = join(root, 'vendor', 'openpencil')
  if (existsSync(join(openPencilRoot, 'Cargo.toml'))) {
    try {
      const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: openPencilRoot, encoding: 'utf8' }).trim().toLowerCase()
      if (actual !== commit) errors.push(`OpenPencil submodule pin mismatch: expected ${commit}, found ${actual}`)
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: openPencilRoot, encoding: 'utf8' }).trim()
      if (status) errors.push('OpenPencil submodule has local changes')
    } catch (cause) {
      errors.push(`Could not verify OpenPencil submodule checkout: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

const controllerPath = join(root, 'src', 'main', 'design', 'openpencil-controller.ts')
if (existsSync(controllerPath)) {
  const controller = await fs.readFile(controllerPath, 'utf8')
  for (const needle of ['process.resourcesPath', 'resources', 'openpencil', 'bin', 'ND_OPENPENCIL_BINARY', '--managed', '--allow-origin', 'contextIsolation: true', 'sandbox: true']) {
    if (!controller.includes(needle)) errors.push(`OpenPencil controller is missing required bundled-runtime invariant: ${needle}`)
  }
  for (const forbidden of ['openpencil-desktop', 'which openpencil', 'where openpencil']) {
    if (controller.includes(forbidden)) errors.push(`OpenPencil controller must not require a separately installed runtime (${forbidden})`)
  }
}

const buildScriptPath = join(root, 'scripts', 'build-openpencil.mjs')
if (existsSync(buildScriptPath)) {
  const buildScript = await fs.readFile(buildScriptPath, 'utf8')
  for (const needle of [
    "'-p', 'op-host-web-server'",
    "'-p', 'op-host-web'",
    "'--features', 'canvaskit'",
    "'wasm-bindgen'",
    "'web-bundle'",
    "'op_host_web_bg.wasm'",
    "'canvaskit.wasm'",
    "'prompt_center_previews'",
    "'scene_templates'",
  ]) {
    if (!buildScript.includes(needle)) errors.push(`OpenPencil build staging is incomplete; missing ${needle}`)
  }
}

const designContractsPath = join(root, 'src', 'shared', 'design.ts')
if (existsSync(designContractsPath)) {
  const designContracts = await fs.readFile(designContractsPath, 'utf8')
  for (const needle of ["engine: 'openpencil'", 'freeformOpen', 'freeformSave', 'freeformSetVisible']) {
    if (!designContracts.includes(needle)) errors.push(`Freeform design contract is missing ${needle}`)
  }
}

if (errors.length) {
  console.error('\nOpenPencil integration verification failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`OpenPencil integration pin verified${release && commit ? ` (${release} @ ${commit.slice(0, 12)})` : ''}.`)
