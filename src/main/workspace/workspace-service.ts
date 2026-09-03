import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { WorkspaceEntry, WorkspaceFile, WorkspaceState, WorkspaceSuggestion } from '../../shared/contracts.js'
import { resolveInside } from './path-utils.js'
import { collectSuggestionIndex, rankFileSuggestions } from './suggest.js'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_DIRECTORY_ENTRIES = 500
const SKIPPED_NAMES = new Set(['.git', 'node_modules', 'out', 'dist', '.dsh', '.sessions'])
const SUGGEST_INDEX_TTL_MS = 30_000

interface SuggestIndexCache {
  root: string
  at: number
  entries: WorkspaceSuggestion[]
}

type WorkspaceContext = Omit<WorkspaceState, 'root' | 'name'>

export class WorkspaceService {
  private root: string
  private suggestIndex: SuggestIndexCache | null = null
  private context: WorkspaceContext = { binding: 'standalone' }
  private onStateChanged?: ((state: WorkspaceState) => void) | undefined

  constructor(initialRoot: string) {
    this.root = resolve(initialRoot)
  }

  state(): WorkspaceState {
    return { root: this.root, name: basename(this.root) || this.root, ...this.context }
  }

  setStateListener(listener: ((state: WorkspaceState) => void) | undefined): void {
    this.onStateChanged = listener
    listener?.(this.state())
  }

  setContext(context: WorkspaceContext): WorkspaceState {
    this.context = { ...context }
    this.emitState()
    return this.state()
  }

  /** Whether the selected project has a usable folder for agent work. */
  isUsable(): boolean {
    return this.context.binding !== 'unlinked' && this.context.binding !== 'missing'
  }

  /** Fail closed instead of allowing a caller to use a stale previous root. */
  assertUsable(): void {
    this.assertWorkspaceAvailable()
  }

  async pick(): Promise<WorkspaceState> {
    const result = await dialog.showOpenDialog({
      title: 'Open workspace',
      defaultPath: this.root,
      properties: ['openDirectory', 'createDirectory'],
    })
    const selected = result.filePaths[0]
    if (!result.canceled && selected) {
      this.root = resolve(selected)
      this.emitState()
    }
    return this.state()
  }

  async setRoot(path: string): Promise<WorkspaceState> {
    const candidate = resolve(path)
    const stats = await fs.stat(candidate)
    if (!stats.isDirectory()) throw new Error('The selected path is not a directory')
    this.root = candidate
    this.emitState()
    return this.state()
  }

  async list(relativePath = '.'): Promise<WorkspaceEntry[]> {
    this.assertWorkspaceAvailable()
    const absolute = await this.resolveExisting(relativePath)
    const stats = await fs.stat(absolute)
    if (!stats.isDirectory()) throw new Error('The selected path is not a directory')
    const entries = await fs.readdir(absolute, { withFileTypes: true })
    return entries
      .filter((entry) =>
        !SKIPPED_NAMES.has(entry.name)
        && !entry.isSymbolicLink()
        && (entry.isDirectory() || entry.isFile()),
      )
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => ({
        name: entry.name,
        relativePath: relativePath === '.' ? entry.name : join(relativePath, entry.name),
        kind: entry.isDirectory() ? 'directory' : 'file',
      }))
  }

  async read(relativePath: string): Promise<WorkspaceFile> {
    this.assertWorkspaceAvailable()
    const absolute = await this.resolveExisting(relativePath)
    const stats = await fs.stat(absolute)
    if (!stats.isFile()) throw new Error('The selected path is not a file')

    const handle = await fs.open(absolute, 'r')
    try {
      const bytesToRead = Math.min(stats.size, MAX_FILE_BYTES)
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
      return {
        relativePath,
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        truncated: stats.size > MAX_FILE_BYTES,
      }
    } finally {
      await handle.close()
    }
  }

  /**
   * @-mention lookup over a bounded workspace index. The index is rebuilt at
   * most every SUGGEST_INDEX_TTL_MS and whenever the root changes, so typing
   * stays cheap on large trees.
   */
  async suggest(query: string): Promise<WorkspaceSuggestion[]> {
    this.assertWorkspaceAvailable()
    const trimmed = query.trim().slice(0, 256)
    const entries = await this.suggestEntries()
    return rankFileSuggestions(entries, trimmed)
  }

  private async suggestEntries(): Promise<WorkspaceSuggestion[]> {
    const now = Date.now()
    if (this.suggestIndex && this.suggestIndex.root === this.root && now - this.suggestIndex.at < SUGGEST_INDEX_TTL_MS) {
      return this.suggestIndex.entries
    }
    const root = this.root
    const entries = await collectSuggestionIndex(async (relativeDirectory) => {
      const absolute = relativeDirectory ? join(root, relativeDirectory) : root
      const items = await fs.readdir(absolute, { withFileTypes: true })
      return items.map((item) => ({
        name: item.name,
        isDirectory: () => item.isDirectory(),
        isFile: () => item.isFile(),
        isSymbolicLink: () => item.isSymbolicLink(),
      }))
    })
    this.suggestIndex = { root, at: now, entries }
    return entries
  }

  private assertWorkspaceAvailable(): void {
    if (this.context.binding === 'unlinked') throw new Error('The active project has no workspace linked. Select a workspace for this project first.')
    if (this.context.binding === 'missing') throw new Error(this.context.warning ?? 'The active project workspace is unavailable. Relocate the project workspace first.')
  }

  private emitState(): void {
    this.onStateChanged?.(this.state())
  }

  private async resolveExisting(relativePath: string): Promise<string> {
    const candidate = resolveInside(this.root, relativePath)
    const candidateStats = await fs.lstat(candidate)
    if (candidateStats.isSymbolicLink()) throw new Error('Symbolic links are not exposed by the workspace API')

    const [realRoot, realCandidate] = await Promise.all([
      fs.realpath(this.root),
      fs.realpath(candidate),
    ])
    resolveInside(realRoot, relative(realRoot, realCandidate))
    return realCandidate
  }
}
