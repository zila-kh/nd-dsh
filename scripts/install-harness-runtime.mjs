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

await installRuntime()

async function installRuntime() {
  assertSafeRuntimeRoot(runtimeRoot)
  const installedManifestPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const installedBinPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const requiredPeerPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-group', 'lib', 'index.js')
  const codexAdapterRoot = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-subagent-codex')
  const codexAdapterPath = join(codexAdapterRoot, 'lib', 'index.js')
  const installedVersion = await readVersion(installedManifestPath)

  console.log(`Checking ${packageSpec} against installed version ${installedVersion ?? '(not installed)'}...`)
  const npm = resolveNpmInvocation(['view', packageSpec, 'version', '--json', '--fetch-retries=0', '--fetch-timeout=30000'])
  const latestVersion = JSON.parse(await run(npm.command, npm.args, projectRoot, true))
  if (typeof latestVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(latestVersion)) {
    throw new Error('The npm registry returned invalid DSH version metadata. No packages were installed.')
  }
  console.log(`Latest published DSH version: ${latestVersion}.`)

  if (installedVersion === latestVersion
    && existsSync(installedBinPath)
    && existsSync(requiredPeerPath)
    && existsSync(codexAdapterPath)
    && await readVersion(join(codexAdapterRoot, 'package.json')) === latestVersion) {
    console.log(`DSH package already up to date at version ${latestVersion}. Skipping install; no restart required.`)
    return
  }

  await fs.mkdir(runtimeRoot, { recursive: true })
  const runtimeManifestPath = join(runtimeRoot, 'package.json')
  if (!existsSync(runtimeManifestPath)) {
    await fs.writeFile(runtimeManifestPath, `${JSON.stringify({
      name: 'nd-dsh-managed-runtime',
      private: true,
      description: 'ND-managed published DeepSeek Harness runtime.',
    }, null, 2)}\n`, 'utf8')
  }

  const targetSpec = `${packageName}@${latestVersion}`
  console.log(`Installing ${targetSpec} from the official npm registry...`)
  await runNpmInstall(targetSpec, requiredPeerSpec)
  if (!existsSync(installedBinPath) || !existsSync(requiredPeerPath)) {
    throw new Error('The published DSH package installed without its launcher. Remove the managed runtime and retry.')
  }
  const version = await readVersion(installedManifestPath)
  if (version !== latestVersion) throw new Error('The installed DSH version does not match the requested release.')

  const codexAdapterSpec = `@deepseek-ai/dsh-subagent-codex@${version}`
  console.log(`Installing ND's official DSH engine adapter ${codexAdapterSpec}...`)
  await runNpmInstall(codexAdapterSpec)
  if (!existsSync(codexAdapterPath) || await readVersion(join(codexAdapterRoot, 'package.json')) !== version) {
    throw new Error('The official DSH Codex adapter is incomplete or has a mismatched version.')
  }

  console.log(`DSH package installed at version ${version}.`)
  console.log('Restart ND-DSH to launch the updated published runtime.')
}

async function readVersion(path) {
  try {
    const manifest = JSON.parse(await fs.readFile(path, 'utf8'))
    return typeof manifest.version === 'string' && manifest.version ? manifest.version : undefined
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

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

function run(command, args, cwd, captureOutput = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' },
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: false,
      windowsHide: true,
    })
    let output = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', chunk => { output += chunk })
    child.once('error', reject)
    child.once('close', code => code === 0
      ? resolvePromise(output)
      : reject(new Error(`npm ${captureOutput ? 'version check' : 'install'} exited with code ${String(code)}.`)))
  })
}
