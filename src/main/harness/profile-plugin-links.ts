import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Entry packages ND's patch overlay inserts that are absent from the pinned
 * Harness bundles' dependency closure. Upstream maintains the flat module
 * fallback `$DSH_HOME/profiles/node_modules` only for its own closure, so an
 * inserted entry would be unresolvable from the profile directory at boot and
 * crash the whole runtime. One link per inserted package keeps boot working
 * without patching the vendored core.
 */
const INSERTED_ENTRY_PACKAGES = [
  { name: '@deepseek-ai/dsh-mcp-client', vendoredPath: 'packages/mcp/mcp-client' },
  { name: '@deepseek-ai/dsh-subagent-codex', vendoredPath: 'packages/subagent/subagent-codex' },
] as const

/**
 * Ensure every ND-inserted entry package is resolvable from any harness
 * profile via the flat module fallback. Idempotent: correct links are kept,
 * stale or moved ones are re-pointed; missing vendored packages are skipped.
 */
export function ensureProfilePluginLinks(dshHome: string, harnessRootDirectory: string): void {
  for (const inserted of INSERTED_ENTRY_PACKAGES) {
    const target = packageTarget(harnessRootDirectory, inserted)
    if (!existsSync(join(target, 'package.json'))) continue
    ensureLink(join(dshHome, 'profiles', 'node_modules', ...inserted.name.split('/')), target)
  }
}

function ensureLink(link: string, target: string): void {
  if (!sameTarget(link, target)) removeLink(link)
  mkdirSync(dirname(link), { recursive: true })
  try {
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    // A racing creator produced the same link; correct is correct.
  }
}

function packageTarget(root: string, inserted: typeof INSERTED_ENTRY_PACKAGES[number]): string {
  const source = join(root, inserted.vendoredPath)
  if (existsSync(join(source, 'package.json'))) return source
  return join(root, 'node_modules', ...inserted.name.split('/'))
}

function sameTarget(link: string, target: string): boolean {
  try {
    return realpathSync(link) === realpathSync(target)
  } catch {
    return false
  }
}

function removeLink(link: string): void {
  try {
    if (!lstatSync(link).isSymbolicLink()) throw new Error(`refusing to replace non-link ${link}`)
    unlinkSync(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
