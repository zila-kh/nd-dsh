import { promises as fs } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Exclude only native Office payloads, keeping upstream plugin metadata intact. */
export async function officeEngineDirectories(runtimeRoot) {
  const found = []
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (entry.name.startsWith('libreoffice-kit-') && directory.endsWith(join('node_modules', '@deepseek-ai'))) {
        found.push(path)
      } else {
        await walk(path)
      }
    }
  }
  await walk(resolve(runtimeRoot))
  return found
}

export async function removeOfficeEngines(runtimeRoot) {
  const root = resolve(runtimeRoot)
  const paths = await officeEngineDirectories(root)
  // Resolve every deletion target before the first mutation. Never follow an
  // unexpected staging junction into a source checkout or another directory.
  const realRoot = await fs.realpath(root)
  for (const path of paths) {
    const inside = relative(realRoot, await fs.realpath(path))
    if (!inside || inside.startsWith('..') || resolve(realRoot, inside) !== resolve(path)) {
      throw new Error(`Office engine deletion is outside release staging: ${path}`)
    }
  }
  for (const path of paths) await fs.rm(path, { recursive: true, force: true })
  return paths.length
}

export async function assertNoOfficeEngines(runtimeRoot) {
  const paths = await officeEngineDirectories(runtimeRoot)
  if (paths.length) throw new Error(`Release must not bundle native Office engines: ${paths.join(', ')}`)
}
