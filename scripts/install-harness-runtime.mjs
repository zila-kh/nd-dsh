#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(
  process.env.ND_DSH_MANAGED_RUNTIME_ROOT ?? join(projectRoot, '.nd-dsh', 'runtime', 'dsh'),
)
const packageName = '@deepseek-ai/dsh'
const packageSpec = `${packageName}@latest`
const requiredPeerSpec = '@deepseek-ai/cordis-plugin-group@latest'

assertSafeRuntimeRoot(runtimeRoot)
await fs.mkdir(runtimeRoot, { recursive: true })

const runtimeManifestPath = join(runtimeRoot, 'package.json')
if (!existsSync(runtimeManifestPath)) {
  await fs.writeFile(runtimeManifestPath, `${JSON.stringify({
    name: 'nd-dsh-managed-runtime',
    private: true,
    description: 'ND-managed published DeepSeek Harness runtime.',
  }, null, 2)}\n`, 'utf8')
}

console.log(`Installing ${packageSpec} from the official npm registry...`)
await runNpmInstall(packageSpec, requiredPeerSpec)

const installedManifestPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const installedBinPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const requiredPeerPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-group', 'lib', 'index.js')
if (!existsSync(installedManifestPath) || !existsSync(installedBinPath) || !existsSync(requiredPeerPath)) {
  throw new Error('The published DSH package installed without its launcher. Remove the managed runtime and retry.')
}
const installedManifest = JSON.parse(await fs.readFile(installedManifestPath, 'utf8'))
const version = typeof installedManifest.version === 'string' ? installedManifest.version : 'unknown'
if (version === 'unknown') throw new Error('The published DSH package has no version metadata.')

const codexAdapterSpec = `@deepseek-ai/dsh-subagent-codex@${version}`
console.log(`Installing ND's official DSH engine adapter ${codexAdapterSpec}...`)
await runNpmInstall(codexAdapterSpec)
const codexAdapterPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex', 'lib', 'index.js')
if (!existsSync(codexAdapterPath)) throw new Error('The official DSH Codex adapter installed without its runtime entry.')

console.log(`DSH package installed at version ${version}.`)
console.log('Restart ND-DSH to launch the updated published runtime.')

async function runNpmInstall(...packageSpecs) {
  const npm = resolveNpmInvocation([
  'install',
  '--prefix', runtimeRoot,
  '--save-exact',
  '--no-audit',
  '--no-fund',
  '--loglevel=info',
    ...packageSpecs,
  ])
  await run(npm.command, npm.args, projectRoot)
}

function assertSafeRuntimeRoot(path) {
  const parsed = parse(path)
  if (path === parsed.root || path === projectRoot) {
    throw new Error(`Refusing unsafe managed runtime path: ${path}`)
  }
}

function resolveNpmInvocation(args) {
  if (process.platform !== 'win32') return { command: 'npm', args }

  const candidates = [
    process.env.ND_DSH_NPM_CLI,
    ...(process.env.PATH ?? '').split(';').map(directory => join(directory.replace(/^"|"$/g, ''), 'node_modules/npm/bin/npm-cli.js')),
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs/node_modules/npm/bin/npm-cli.js') : undefined,
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'nodejs/node_modules/npm/bin/npm-cli.js') : undefined,
  ]
  const npmCli = candidates.find(candidate => candidate && existsSync(candidate))
  if (!npmCli) throw new Error('npm was not found. Install Node.js with npm, then retry from ND.')
  return { command: process.execPath, args: [npmCli, ...args] }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('close', code => code === 0
      ? resolvePromise()
      : reject(new Error(`npm install exited with code ${String(code)}.`)))
  })
}
