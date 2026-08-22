/**
 * Shared per-filetype accent palette (nd-ide-inspired) used by the explorer
 * tree, editor tabs, and the chat mention menu so file colors read the same
 * everywhere in the app.
 */
export const FOLDER_ACCENT = '#f59e0b'
export const SKILL_ACCENT = '#a78bfa'
export const DEFAULT_FILE_ACCENT = '#94a3b8'

const EXTENSION_ACCENTS: Record<string, string> = {
  ts: '#60a5fa', tsx: '#60a5fa',
  js: '#eab308', jsx: '#eab308', mjs: '#eab308', cjs: '#eab308',
  json: '#fbbf24',
  md: '#38bdf8', mdx: '#38bdf8',
  css: '#818cf8', scss: '#818cf8',
  html: '#f87171',
  yml: '#34d399', yaml: '#34d399', toml: '#34d399',
  rs: '#fb923c',
  py: '#4ade80',
  sh: '#86efac', ps1: '#86efac',
  png: '#2dd4bf', jpg: '#2dd4bf', jpeg: '#2dd4bf', gif: '#2dd4bf', svg: '#2dd4bf', webp: '#2dd4bf', ico: '#2dd4bf',
}

/** Lowercase extension of the path's basename ('' when it has none). */
export function fileExtensionOf(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = separator === -1 ? path : path.slice(separator + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Accent color for a file path based on its extension. */
export function fileAccent(path: string): string {
  return EXTENSION_ACCENTS[fileExtensionOf(path)] ?? DEFAULT_FILE_ACCENT
}
