#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configOnly = process.argv.includes('--config-only')
const packageJson = readJson(join(root, 'package.json'))
const builderConfig = readFileSync(join(root, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')

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
  'from: .release/nd-core',
  'to: nd-core',
  'from: .release/nd-browser-host',
  'to: nd-browser-host',
  'from: .release/THIRD_PARTY_NOTICES.nd-dsh.md',
  'to: THIRD_PARTY_NOTICES.nd-dsh.md',
  'from: extensions/browser-companion',
  'to: browser-companion',
  'from: node_modules/agent-browser',
  'from: resources/nd-pencil',
]) {
  if (!builderConfig.includes(marker)) throw new Error(`electron-builder.yml is missing: ${marker}`)
}
const extraResourcesConfig = builderConfig.split('extraResources:')[1] ?? ''
if (!builderConfig.includes('  - package.json\n  - node_modules/**')) {
  throw new Error('electron-builder.yml must keep the application package.json in app.asar')
}
if (/\n\s*- from: package\.json\b/.test(extraResourcesConfig)) {
  throw new Error('electron-builder.yml must not exclude package.json from app.asar via extraResources')
}

// Development UI previews intentionally contain fake companies/sessions for
// isolated visual work. Production builds must tree-shake that entire branch;
// scan the built renderer whenever it exists so a future import change cannot
// silently ship preview data into the desktop product.
verifyProductionRendererIsolation()

if (!configOnly) {
  const requiredFiles = [
    '.release/release-manifest.json',
    `.release/nd-core/${process.platform === 'win32' ? 'nd-core.exe' : 'nd-core'}`,
    `.release/nd-browser-host/${process.platform === 'win32' ? 'nd-browser-host.exe' : 'nd-browser-host'}`,
    'extensions/browser-companion/manifest.json',
    'extensions/browser-companion/service-worker.js',
    'scripts/nd-browser-companion-runtime.mjs',
    'scripts/register-browser-native-host.mjs',
    '.release/harness/lib/bin.js',
    '.release/harness/LICENSE',
    '.release/harness/THIRD_PARTY_NOTICES.md',
    '.release/THIRD_PARTY_NOTICES.nd-dsh.md',
    'LICENSE',
    'vendor/openpencil.LICENSE',
    'vendor/vscode-git.LICENSE',
    'resources/nd-pencil/LICENSE.openpencil',
    'node_modules/agent-browser/LICENSE',
    'node_modules/electron/dist/LICENSE',
    'node_modules/electron/dist/LICENSES.chromium.html',
    '.release/harness/node_modules/@deepseek-ai/cordis-plugin-group/lib/index.js',
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
  if (manifest.ndCore?.protocolVersion !== 1 || typeof manifest.ndCore?.sha256 !== 'string' || manifest.ndCore.sha256.length !== 64) {
    throw new Error('Packaged ND Core provenance is missing or invalid')
  }
  if (manifest.browserCompanion?.protocolVersion !== 1
    || typeof manifest.browserCompanion?.nativeHostSha256 !== 'string'
    || manifest.browserCompanion.nativeHostSha256.length !== 64) {
    throw new Error('Packaged Browser Companion provenance is missing or invalid')
  }
  verifyThirdPartyNotices()
}

console.log(configOnly ? 'Release packaging configuration verified.' : 'Release runtime inputs verified.')

/**
 * A notices file that exists but names nothing is worse than no file at all:
 * it claims compliance without recording the software. Assert that the
 * generated aggregate covers every direct runtime dependency the app bundles
 * and every third-party runtime the artifact redistributes.
 */
function verifyThirdPartyNotices() {
  const notices = readFileSync(join(root, '.release', 'THIRD_PARTY_NOTICES.nd-dsh.md'), 'utf8')
  for (const name of Object.keys(packageJson.dependencies ?? {})) {
    if (!notices.includes(`\`${name}\``)) {
      throw new Error(`Third-party notices do not name the runtime dependency ${name}`)
    }
  }
  for (const component of ['DeepSeek Harness', 'agent-browser', 'ND Pencil', 'Electron', 'Chromium']) {
    if (!notices.includes(component)) {
      throw new Error(`Third-party notices do not include the bundled component ${component}`)
    }
  }
  if (!/Native runtime crates[\s\S]*\| Crate \|/.test(notices)) {
    throw new Error('Third-party notices do not include the native runtime crate table')
  }
}

function verifyProductionRendererIsolation() {
  const outputRoot = join(root, 'out', 'renderer')
  if (!existsSync(outputRoot)) return
  const forbidden = [
    'preview-session',
    'C:/workspace/nd-product',
    'Northstar Digital',
    'sha256-openviking010hashplaceholder',
    'sha256-graphify100hashplaceholder',
  ]
  for (const path of walkFiles(outputRoot)) {
    if (!['.html', '.js', '.mjs'].includes(extname(path))) continue
    const content = readFileSync(path, 'utf8')
    for (const marker of forbidden) {
      if (content.includes(marker)) throw new Error(`Production renderer contains development preview marker ${JSON.stringify(marker)} in ${path}`)
    }
  }
}

function walkFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
