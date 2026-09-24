#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, basename } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessSource = join(root, 'vendor', 'deepseek-harness')
const stageRoot = join(root, '.release')
const harnessOutput = join(stageRoot, 'harness')
const coreOutput = join(stageRoot, 'nd-core')
const browserHostOutput = join(stageRoot, 'nd-browser-host')
const coreBinaryName = process.platform === 'win32' ? 'nd-core.exe' : 'nd-core'
const browserHostBinaryName = process.platform === 'win32' ? 'nd-browser-host.exe' : 'nd-browser-host'
const coreSourceBinary = join(root, 'target', 'release', coreBinaryName)
const browserHostSourceBinary = join(root, 'target', 'release', browserHostBinaryName)
const coreStagedBinary = join(coreOutput, coreBinaryName)
const browserHostStagedBinary = join(browserHostOutput, browserHostBinaryName)
const codexOutput = join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex')
const cordisGroupOutput = join(harnessOutput, 'node_modules', '@deepseek-ai', 'cordis-plugin-group')
const pencilBuildScript = join(root, 'scripts', 'build-nd-pencil.mjs')
const pencilBinaryName = process.platform === 'win32' ? 'op-host-web-server.exe' : 'op-host-web-server'
const pencilBinary = join(root, 'resources', 'nd-pencil', 'bin', pencilBinaryName)
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const harnessEnv = { ...process.env, CI: 'true' }

assertInsideRoot(stageRoot)
await requireFile(join(harnessSource, 'package.json'), 'Harness source manifest')
await requireFile(join(harnessSource, 'pnpm-lock.yaml'), 'Harness lockfile')

console.log('\nBuilding the ND Core and Browser Companion native host release binaries...')
await run(cargo, ['build', '--release', '-p', 'nd-core', '-p', 'nd-browser-host'], root, harnessEnv)
await requireFile(coreSourceBinary, 'ND Core release binary')
await requireFile(browserHostSourceBinary, 'ND Browser Companion native host')
await fs.rm(coreOutput, { recursive: true, force: true })
await fs.rm(browserHostOutput, { recursive: true, force: true })
await fs.mkdir(coreOutput, { recursive: true })
await fs.mkdir(browserHostOutput, { recursive: true })
await fs.copyFile(coreSourceBinary, coreStagedBinary)
await fs.copyFile(browserHostSourceBinary, browserHostStagedBinary)
if (process.platform !== 'win32') {
  await fs.chmod(coreStagedBinary, 0o755)
  await fs.chmod(browserHostStagedBinary, 0o755)
}

// Release staging must work from a clean checkout after only the root install.
// The Harness is a git submodule rather than a pnpm workspace member, so its
// own frozen dependency graph must be installed before any source build or
// deploy operation. CI=true is the upstream-supported way to skip git-hook
// installation inside submodule worktrees.
console.log('\nInstalling the Harness release dependency graph...')
await run(corepack, ['pnpm', '--dir', harnessSource, 'install', '--frozen-lockfile'], root, harnessEnv)

console.log('\nBuilding the Harness runtime (host, client, and web faces)...')
await run(process.execPath, [join(root, 'scripts', 'build-harness.mjs'), '--skip-install'], root, harnessEnv)

console.log('\nCreating the portable Harness production closure...')
await fs.rm(harnessOutput, { recursive: true, force: true })
await fs.mkdir(stageRoot, { recursive: true })
// The upstream CLI intentionally declares its runtime plugin graph through
// peer + dev dependencies. A production-only deploy silently drops those
// peers, producing a package that cannot boot. Keep the CLI's complete,
// upstream-defined closure and use a production closure for the isolated
// Codex adapter.
await deploy('@deepseek-ai/dsh', harnessOutput, false)
// dsh-app-boot requires this upstream peer at runtime, but the CLI does not
// declare it directly. Deploy it into the portable closure so plain Node and
// the packaged Electron runtime resolve the same graph as the source workspace.
await deploy('@deepseek-ai/cordis-plugin-group', cordisGroupOutput, false)
await deploy('@deepseek-ai/dsh-subagent-codex', codexOutput, true)
await fs.copyFile(join(harnessSource, 'LICENSE'), join(harnessOutput, 'LICENSE'))
await fs.copyFile(join(harnessSource, 'THIRD_PARTY_NOTICES.md'), join(harnessOutput, 'THIRD_PARTY_NOTICES.md'))

console.log('\nBuilding and staging the ND Pencil runtime...')
await run(process.execPath, [pencilBuildScript], root)

// Every redistributed surface needs a notice in the artifact: the Harness and
// Pencil ship their own, the npm/Electron/Chromium files ship beside the app,
// and this generated aggregate covers the app.asar packages and the crates
// linked into the native binaries. verify-release.mjs asserts it arrives.
console.log('\nGenerating the aggregated third-party notices...')
await run(process.execPath, [join(root, 'scripts', 'gen-third-party-notices.mjs')], root)

const required = [
  join(harnessOutput, 'lib', 'bin.js'),
  join(cordisGroupOutput, 'lib', 'index.js'),
  join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-mcp-client', 'lib', 'index.js'),
  // The web profile loads client plugins at boot; without their emitted entries
  // the packaged runtime never becomes ready. Staging must not ship a host-only
  // build again — that is what left the runtime unable to start.
  join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-client-ui-trajectory', 'lib', 'index.js'),
  join(harnessOutput, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'index.js'),
  join(codexOutput, 'lib', 'index.js'),
  join(codexOutput, 'node_modules', '@openai', 'codex', 'package.json'),
  join(root, 'node_modules', 'agent-browser', 'bin', 'agent-browser.js'),
  coreStagedBinary,
  browserHostStagedBinary,
  join(root, 'extensions', 'browser-companion', 'manifest.json'),
  join(root, 'extensions', 'browser-companion', 'service-worker.js'),
  join(root, 'scripts', 'nd-browser-companion-runtime.mjs'),
  join(root, 'scripts', 'register-browser-native-host.mjs'),
  pencilBinary,
  join(root, 'resources', 'nd-pencil', 'bin', 'web-bundle', 'op_host_web.js'),
  join(root, 'resources', 'nd-pencil', 'bin', 'web-bundle', 'op_host_web_bg.wasm'),
  join(stageRoot, 'THIRD_PARTY_NOTICES.nd-dsh.md'),
]
for (const path of required) await requireFile(path, 'Release runtime file')

// A file list can only catch a package that is absent; it cannot catch one
// that is present but unreachable. The web profile loads every `dsh.client`
// package its bundle declares, resolved the way Node resolves - walking
// node_modules upward from the declaring package, which is also how the
// Harness maintains its profile module fallback. Assert that reachability
// here, where a gap names the package and the fix, instead of leaving it to a
// packaged app that never becomes ready.
console.log('\nVerifying the staged web-profile closure...')
const closure = await verifyWebProfileClosure()
console.log(`Web profile closure resolves ${closure.dependencies} dependencies, including ${closure.clientPackages} client face(s).`)

// Exercise the deployed entry with plain Node before electron-builder copies it.
await run(process.execPath, [join(harnessOutput, 'lib', 'bin.js'), '--help'], root)

const rootManifest = await readJson(join(root, 'package.json'))
const harnessManifest = await readJson(join(harnessOutput, 'package.json'))
const agentBrowserManifest = await readJson(join(root, 'node_modules', 'agent-browser', 'package.json'))
const pencilPin = await readJson(join(root, 'vendor', 'openpencil.json'))
const harnessPin = await readJson(join(root, 'vendor', 'deepseek-harness.json'))
const harnessCommit = await gitHead(harnessSource)
const pencilCommit = await gitHead(join(root, 'vendor', 'openpencil'))
if (pencilPin.commit !== pencilCommit) {
  throw new Error(`ND Pencil source pin mismatch: expected ${String(pencilPin.commit)}, found ${pencilCommit}`)
}
// The Harness tracks upstream during beta, so no frozen pin gates development.
// A release is different: it must ship the exact commit that was recorded when
// the runtime was last reviewed and synced, otherwise the provenance in the
// manifest describes something nobody audited. `pnpm dsh:update` refreshes the
// record as part of syncing.
if (typeof harnessPin.lastSyncedCommit !== 'string' || harnessPin.lastSyncedCommit !== harnessCommit) {
  throw new Error(
    `Harness release mismatch: vendor/deepseek-harness.json records ${String(harnessPin.lastSyncedCommit)}, ` +
    `the checkout is at ${harnessCommit}. Sync and review the runtime (corepack pnpm dsh:update) before staging a release.`,
  )
}

const manifest = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  appVersion: rootManifest.version,
  platform: process.platform,
  arch: process.arch,
  nodeRuntime: { mode: 'electron-run-as-node', electronVersion: rootManifest.devDependencies?.electron },
  ndCore: { version: rootManifest.version, protocolVersion: 1, sha256: await sha256(coreStagedBinary) },
  browserCompanion: {
    version: rootManifest.version,
    protocolVersion: 1,
    nativeHostSha256: await sha256(browserHostStagedBinary),
  },
  harness: { version: harnessManifest.version, commit: harnessCommit },
  ndPencil: { version: pencilPin.release, commit: pencilCommit, sha256: await sha256(pencilBinary) },
  agentBrowser: { version: agentBrowserManifest.version },
}
await fs.writeFile(join(stageRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log('\nRelease runtime staged successfully.')
console.log(`ND Core: ${rootManifest.version} / protocol 1`)
console.log(`Browser Companion: ${rootManifest.version} / protocol 1`)
console.log(`Harness: ${harnessManifest.version} @ ${harnessCommit.slice(0, 12)}`)
console.log(`ND Pencil: ${pencilPin.release} @ ${pencilCommit.slice(0, 12)}`)
console.log(`Manifest: ${join(stageRoot, 'release-manifest.json')}`)

async function deploy(packageName, destination, productionOnly) {
  assertInsideRoot(destination)
  // `--legacy` copies the selected project's own node_modules surface and stops
  // there: a workspace dependency is copied without its dependencies, so the
  // stage shipped `@deepseek-ai/dsh-web-app` with an empty node_modules and
  // none of the 80 packages the web profile loads (every `dsh-client-ui-*`
  // face among them). The injected install resolves the closure a published
  // install would - workspace packages are injected as files - and the hoisted
  // linker leaves the result free of symlinks, so it survives electron-builder
  // copying the tree into the packaged app.
  await run(corepack, [
    'pnpm', '--dir', harnessSource, '--ignore-scripts',
    '--filter', packageName, ...(productionOnly ? ['--prod'] : []),
    '--config.inject-workspace-packages=true',
    '--config.node-linker=hoisted',
    'deploy', destination,
  ], root, harnessEnv)
}

function run(command, args, cwd, env = process.env) {
  console.log(`> ${command} ${args.join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      windowsHide: true,
      shell: needsWindowsShell(command),
      env,
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

/**
 * Every dependency the staged web profile declares must resolve from inside
 * the staged runtime, and every client face it loads must have the entry its
 * manifest points at. Returns the counts for the staging log.
 */
async function verifyWebProfileClosure() {
  const webApp = resolveStagedPackage(harnessOutput, '@deepseek-ai/dsh-web-app')
  if (webApp === undefined) {
    throw new Error(
      'The staged Harness closure does not contain @deepseek-ai/dsh-web-app, the bundle the web profile boots. ' +
      'Release staging must deploy the Harness app closure (see deploy() in scripts/stage-release.mjs).',
    )
  }
  const manifest = await readJson(join(webApp, 'package.json'))
  const declared = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]
  const unresolvable = []
  const brokenEntries = []
  let clientPackages = 0
  for (const name of declared) {
    const directory = resolveStagedPackage(webApp, name)
    if (directory === undefined) {
      unresolvable.push(name)
      continue
    }
    const child = await readJson(join(directory, 'package.json')).catch(() => undefined)
    if (child?.dsh?.client === undefined) continue
    clientPackages += 1
    const entry = typeof child.main === 'string' ? child.main : undefined
    if (entry === undefined || !existsSync(join(directory, entry))) {
      brokenEntries.push(`${name} (main: ${entry ?? 'unset'})`)
    }
  }
  if (unresolvable.length > 0 || brokenEntries.length > 0) {
    const lines = []
    if (unresolvable.length > 0) {
      lines.push(
        `${unresolvable.length} of ${declared.length} dependencies of @deepseek-ai/dsh-web-app are not resolvable from ` +
        `the staged runtime (first: ${unresolvable.slice(0, 5).join(', ')}).`,
      )
    }
    if (brokenEntries.length > 0) {
      lines.push(`${brokenEntries.length} client face(s) resolve without the entry their manifest declares (first: ${brokenEntries.slice(0, 5).join(', ')}).`)
    }
    throw new Error(
      'The staged Harness closure is incomplete. A packaged app would fail to boot the web profile, because the ' +
      'profile loads these packages at startup.\n  ' + lines.join('\n  ') +
      '\n  The deploy in scripts/stage-release.mjs must install the full dependency closure ' +
      '(--config.inject-workspace-packages=true --config.node-linker=hoisted); a plain `pnpm deploy --legacy` copies ' +
      'one level only.',
    )
  }
  return { dependencies: declared.length, clientPackages }
}

/**
 * Resolve one package the way Node resolves it from `fromDirectory`: every
 * ancestor's node_modules, skipping a directory that is itself node_modules.
 * Resolution is bounded to `root` so a developer checkout beside the staged
 * runtime cannot stand in for a package the runtime does not ship.
 */
function resolveStagedPackage(fromDirectory, name) {
  const root = resolve(harnessOutput)
  let directory = resolve(fromDirectory)
  while (true) {
    if (basename(directory) !== 'node_modules') {
      const candidate = join(directory, 'node_modules', ...name.split('/'))
      if (existsSync(join(candidate, 'package.json'))) {
        const inside = relative(root, resolve(candidate))
        if (!inside.startsWith('..')) return candidate
      }
    }
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
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
