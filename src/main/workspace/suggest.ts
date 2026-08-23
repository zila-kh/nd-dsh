import type { WorkspaceSuggestion } from '../../shared/contracts.js'

/** Directories that are never useful as chat mentions and dwarf the index. */
const SUGGEST_SKIPPED_NAMES = new Set([
  '.git', 'node_modules', 'out', 'dist', 'build', 'coverage', 'vendor', '.dsh', '.sessions', '.agents',
])

export const SUGGEST_INDEX_MAX_ENTRIES = 10_000
export const SUGGEST_RESULT_LIMIT = 50

export interface SuggestionDirent {
  name: string
  isDirectory(): boolean
  isFile(): boolean
  isSymbolicLink(): boolean
}

/**
 * Bounded breadth-first walk of the workspace for mention suggestions.
 * `readdir` receives a workspace-relative directory path ('' is the root) and
 * resolves it itself, so this walker stays independent of path semantics.
 * Skips generated/dependency directories and symlinked entries; keeps at most
 * SUGGEST_INDEX_MAX_ENTRIES entries so huge trees stay responsive.
 */
export async function collectSuggestionIndex(
  readdir: (relativeDirectory: string) => Promise<SuggestionDirent[]>,
  limit = SUGGEST_INDEX_MAX_ENTRIES,
): Promise<WorkspaceSuggestion[]> {
  const entries: WorkspaceSuggestion[] = []
  const queue: string[] = ['']
  while (queue.length > 0 && entries.length < limit) {
    const directory = queue.shift()
    if (directory === undefined) break
    let children
    try {
      children = await readdir(directory)
    } catch {
      continue
    }
    const subdirectories: string[] = []
    for (const child of children) {
      if (entries.length >= limit) break
      if (SUGGEST_SKIPPED_NAMES.has(child.name) || child.isSymbolicLink()) continue
      const relativePath = directory ? `${directory}/${child.name}` : child.name
      if (child.isFile()) {
        entries.push({ relativePath, kind: 'file' })
      } else if (child.isDirectory()) {
        entries.push({ relativePath, kind: 'directory' })
        subdirectories.push(relativePath)
      }
    }
    queue.push(...subdirectories)
  }
  return entries
}

/**
 * Ranks index entries against the @-mention query. Basename hits outrank deep
 * path hits; prefix hits outrank substring hits; files outrank directories on
 * ties so the common case floats first.
 */
export function rankFileSuggestions(entries: WorkspaceSuggestion[], query: string, limit = SUGGEST_RESULT_LIMIT): WorkspaceSuggestion[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return entries
      .slice()
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .slice(0, limit)
  }
  const scored: Array<{ entry: WorkspaceSuggestion; score: number }> = []
  for (const entry of entries) {
    const path = entry.relativePath.toLowerCase()
    if (!path.includes(needle)) continue
    const base = basename(entry.relativePath).toLowerCase()
    let score = 3
    if (base === needle) score = 0
    else if (base.startsWith(needle)) score = 1
    else if (path.startsWith(needle)) score = 2
    if (entry.kind === 'directory') score += 1
    scored.push({ entry, score })
  }
  return scored
    .sort((left, right) => left.score - right.score || left.entry.relativePath.localeCompare(right.entry.relativePath))
    .slice(0, limit)
    .map((item) => item.entry)
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}
