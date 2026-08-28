#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configOnly = process.argv.includes('--config-only')
const packageJson = readJson(join(root, 'package.json'))
const builderConfig = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

const requiredScripts = ['release:stage', 'release:verify', 'dist:win:dir', 'dist:win:portable']
for (const script of requiredScripts) {
  if (typeof packageJson.scripts?.[script] !== 'string') throw new Error(`Missing package script: ${script}`)
}
if (packageJson.devDependencies?.['electron-builder'] !== '26.15.3') {
  throw new Error('electron-builder must remain pinned to the reviewed 26.15.3 release')
}
for (const marker of [
  'appId: com.nddsh.desktop',
  'from: .release/harness',
  'to: vendor/deepseek-harness',
  'from: node_modules/agent-browser',
  'from: resources/nd-pencil',
]) {
  if (!builderConfig.includes(marker)) throw new Error(`electron-builder.yml is missing: ${marker}`)
}

if (!configOnly) {
  const requiredFiles = [
    '.release/release-manifest.json',
    '.release/harness/lib/bin.js',
    '.release/harness/LICENSE',
    '.release/harness/THIRD_PARTY_NOTICES.md',
    '.release/harness/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js',
    '.release/harness/node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js',
    '.release/harness/node_modules/@deepseek-ai/dsh-subagent-codex/node_modules/@openai/codex/package.json',
    'node_modules/agent-browser/bin/agent-browser.js',
    `resources/nd-pencil/bin/${process.platform === 'win32' ? 'op-host-web-server.exe' : 'op-host-web-server'}`,
    'resources/nd-pencil/bin/web-bundle/op_host_web.js',
    'resources/nd-pencil/bin/web-bundle/op_host_web_bg.wasm',
  ]
  for (const relativePath of requiredFiles) {
    const path = join(root, relativePath)
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Release input is missing: ${relativePath}`)
  }
  const manifest = readJson(join(root, '.release', 'release-manifest.json'))
  if (manifest.schemaVersion !== 1 || manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error('Release manifest does not match the current build platform')
  }
  if (manifest.nodeRuntime?.mode !== 'electron-run-as-node') throw new Error('Packaged Node runtime mode is not declared')
}

console.log(configOnly ? 'Release packaging configuration verified.' : 'Release runtime inputs verified.')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
