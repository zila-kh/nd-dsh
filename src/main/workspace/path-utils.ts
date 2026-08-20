import { resolve, sep } from 'node:path'

export function resolveInside(root: string, relativePath = '.'): string {
  const resolvedRoot = resolve(root)
  const candidate = resolve(resolvedRoot, relativePath)
  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes the selected workspace')
  }
  return candidate
}
