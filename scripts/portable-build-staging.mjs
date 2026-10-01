import { existsSync } from 'node:fs'
import { mkdir, readdir, realpath, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** NSIS's direct File /r compiler requires paths below the legacy Windows limit. */
export async function withPortableBuildStaging(root, operation) {
  const workspace = await realpath(resolve(root))
  const source = join(workspace, 'dist', 'win-unpacked')
  const parent = join(workspace, '.release')
  const staged = join(parent, 'app')
  await mkdir(parent, { recursive: true })
  if (await realpath(parent) !== parent || await realpath(join(workspace, 'dist')) !== join(workspace, 'dist') || await realpath(source) !== source) {
    throw new Error('Portable staging parents must stay inside the workspace.')
  }
  if (existsSync(staged)) throw new Error('Portable staging directory already exists; preserve it for inspection: ' + staged)
  async function check(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = join(relative, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Portable staging must not contain symbolic links.')
      if (join(staged, child).length >= 260) throw new Error('NSIS needs a shorter repository path to build: ' + child)
      if (entry.isDirectory()) await check(join(directory, entry.name), child)
    }
  }
  await check(source)
  await rename(source, staged)
  try {
    return await operation(staged)
  } finally {
    if (existsSync(source)) throw new Error('Refusing to replace a new unpacked build; original payload remains at ' + staged)
    await rename(staged, source)
  }
}
