import { execFile } from 'node:child_process'
import { existsSync, readFileSync, promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// pnpm deploy includes dependencies, but workspace peers which are supplied by
// sibling source projects can be absent. Redistribute their upstream-published
// files, without editing the upstream manifests or copying its source modules.
export async function completeHarnessPeers(sourceRoot, outputRoot, run) {
  const packages = new Map()
  async function discover(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', '.git', 'lib', 'dist', 'target'].includes(entry.name)) continue
      const child = join(directory, entry.name)
      const manifest = await readManifest(child).catch(() => undefined)
      if (manifest?.name?.startsWith('@deepseek-ai/')) packages.set(manifest.name, child)
      else await discover(child)
    }
  }
  await discover(join(sourceRoot, 'packages'))
  await discover(join(sourceRoot, 'apps'))
  const added = []
  const temporary = await fs.mkdtemp(join(dirname(outputRoot), 'harness-peer-packs-'))
  try {
    while (true) {
      const missing = await missingHarnessDependencies(outputRoot)
      if (!missing.length) return added
      for (const name of missing) {
        const source = packages.get(name)
        if (!source) throw new Error(`Staged Harness dependency ${name} is absent and has no upstream workspace package.`)
        const destination = join(outputRoot, 'node_modules', ...name.split('/'))
        assertInside(outputRoot, destination)
        // Packing honors upstream's files/exports rules and rewrites workspace:
        // ranges; do not dereference source node_modules (which has cycles).
        await run(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', [
          'pnpm', '--dir', source, '--config.ignore-scripts=true', 'pack', '--pack-destination', temporary,
        ], sourceRoot)
        const archives = (await fs.readdir(temporary)).filter((file) => file.endsWith('.tgz'))
        if (archives.length !== 1) throw new Error(`Expected one packed upstream dependency for ${name}.`)
        await fs.mkdir(destination, { recursive: true })
        await execFileAsync('tar', ['-xzf', join(temporary, archives[0]), '--strip-components=1', '-C', destination], { windowsHide: true })
        const manifest = await readManifest(destination)
        if (manifest.name !== name) throw new Error(`Packed dependency identity mismatch for ${name}.`)
        await fs.unlink(join(temporary, archives[0]))
        added.push(name)
      }
    }
  } finally {
    assertInside(dirname(outputRoot), temporary)
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

export async function missingHarnessDependencies(outputRoot) {
  const missing = new Set()
  async function inspect(directory) {
    const manifest = await readManifest(directory)
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (manifest.peerDependenciesMeta?.[name]?.optional && !manifest.dependencies?.[name]) continue
      if (!resolveWithin(outputRoot, directory, name)) missing.add(name)
    }
    const modules = join(directory, 'node_modules')
    for (const entry of await fs.readdir(modules, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const child = join(modules, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of await fs.readdir(child, { withFileTypes: true })) {
          if (scoped.isDirectory()) await inspect(join(child, scoped.name))
        }
      } else await inspect(child)
    }
  }
  await inspect(outputRoot)
  return [...missing].sort()
}

function resolveWithin(root, from, name) {
  let directory = resolve(from)
  const boundary = resolve(root)
  // Self-references are valid only from the named package itself.
  try {
    const own = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (own.name === name) return directory
  } catch { /* handled by dependency lookup */ }
  while (true) {
    if (basename(directory) !== 'node_modules') {
      const candidate = join(directory, 'node_modules', ...name.split('/'))
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
    if (directory === boundary) return undefined
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

async function readManifest(directory) {
  return JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8'))
}

function assertInside(root, path) {
  const child = relative(resolve(root), resolve(path))
  if (!child || child.split(/[\\/]/)[0] === '..' || isAbsolute(child)) throw new Error(`Unsafe Harness staging path: ${path}`)
}
