import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export interface GitProvenance {
  insideWorkTree: boolean
  remote?: string
  branch?: string
  head?: string
  dirty?: boolean
}

const GIT_TIMEOUT_MS = 8_000
const GIT_MAX_OUTPUT = 64 * 1024

function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: dir, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout.toString())
    })
  })
}

/**
 * Read-only provenance for an installed plugin source: which repository and
 * revision the reviewed content came from. Provenance is recorded, never
 * trusted — installation validation is the manifest parser's job.
 */
export async function gitProvenance(dir: string): Promise<GitProvenance> {
  try {
    const inside = (await git(dir, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true'
    if (!inside) return { insideWorkTree: false }
    const provenance: GitProvenance = { insideWorkTree: true }
    try {
      const head = (await git(dir, ['rev-parse', 'HEAD'])).trim()
      if (head) provenance.head = head
    } catch { /* detached or unborn HEAD */ }
    try {
      const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      if (branch && branch !== 'HEAD') provenance.branch = branch
    } catch { /* ignore */ }
    try {
      const remote = (await git(dir, ['remote', 'get-url', 'origin'])).trim()
      if (remote) provenance.remote = remote
    } catch { /* no origin remote */ }
    try {
      const status = await git(dir, ['status', '--porcelain'])
      provenance.dirty = status.trim().length > 0
    } catch { /* ignore */ }
    return provenance
  } catch {
    return { insideWorkTree: false }
  }
}

/**
 * Clone a plugin source repository into the ND-owned cache and detach at the
 * requested ref when one is pinned. A full clone is used on purpose so any
 * reviewed commit SHA can be checked out deterministically.
 */
export async function cloneWorkflowPluginSource(url: string, ref: string | undefined, destDir: string): Promise<{ resolvedSha?: string; branch?: string }> {
  const parent = dirname(destDir)
  await fs.mkdir(parent, { recursive: true })
  await fs.rm(destDir, { recursive: true, force: true })
  // Clone from the parent directory: `git clone` creates the destination itself.
  await git(parent, ['clone', url, destDir])
  if (ref) await git(destDir, ['checkout', '--detach', ref])
  const provenance = await gitProvenance(destDir)
  return {
    ...(provenance.head ? { resolvedSha: provenance.head } : {}),
    ...(provenance.branch ? { branch: provenance.branch } : {}),
  }
}

/**
 * Locate the ND plugin manifest inside a cloned or local plugin source.
 * Known bundle layouts only; the scan is bounded so a hostile repository
 * cannot make ND walk unbounded trees.
 */
export async function locatePluginManifest(root: string): Promise<string | undefined> {
  const candidates = [
    'nd-plugin.json',
    join('nd', 'nd-plugin.json'),
    join('packages', 'agent-workflow-scrum', 'plugin', 'nd', 'nd-plugin.json'),
  ]
  for (const candidate of candidates) {
    const file = join(root, candidate)
    if (await isFile(file)) return file
  }
  // Bounded one-level scan of packages/*/plugin/nd and packages/*/plugin.
  try {
    const packagesDir = join(root, 'packages')
    for (const entry of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const candidate of [join('plugin', 'nd', 'nd-plugin.json'), join('plugin', 'nd-plugin.json'), 'nd-plugin.json']) {
        const file = join(packagesDir, entry.name, candidate)
        if (await isFile(file)) return file
      }
    }
  } catch { /* no packages directory */ }
  return undefined
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}
