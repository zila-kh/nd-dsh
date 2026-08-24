import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import type { SavedWorkspace, WorkspaceRegistryView } from '../../shared/contracts.js'

const MAX_ITEMS = 24
const MAX_ROOT_LENGTH = 4_096

/**
 * Durable ND-owned list of pinned workspaces behind the sidebar Workspaces
 * panel. The currently open root is always a member (seeded at startup and on
 * every pick/setRoot), so the active pointer stays truthful even when the user
 * only ever switches through Settings.
 */
export class WorkspaceRegistry {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private items: SavedWorkspace[] = []
  private activeId: string | undefined

  constructor(private readonly filePath: string) {}

  /** Read-only view; safe before the first mutation because it never writes. */
  async list(): Promise<WorkspaceRegistryView> {
    await this.load()
    return this.view()
  }

  get(id: string): SavedWorkspace | undefined {
    return this.items.find((item) => item.id === id)
  }

  /**
   * Find a previously selected folder whose legacy escaped form exactly
   * matches a persisted project path. This narrowly repairs a Windows path
   * that was typed through an escape-processing input bridge (for example
   * `\\todo` becoming a tab plus `odo`); it never guesses a new folder.
   */
  async findLegacyEscapedRoot(path: string): Promise<string | undefined> {
    await this.load()
    return this.items.find((item) => legacyEscapedWorkspacePath(item.root) === path)?.root
  }

  /**
   * Startup migration: make sure the root the app booted with is pinned and
   * active so the sidebar is never empty after upgrading from the
   * single-workspace build.
   */
  async ensureActive(root: string): Promise<WorkspaceRegistryView> {
    await this.load()
    const existing = this.findByRoot(root)
    if (!existing) {
      const entry: SavedWorkspace = {
        id: randomUUID(),
        root: resolve(root),
        name: basename(root) || root,
        addedAt: Date.now(),
        lastOpenedAt: Date.now(),
      }
      this.items.unshift(entry)
      this.evictOverflow()
      this.activeId = entry.id
      await this.save()
      return this.view()
    }
    if (this.activeId !== existing.id) {
      this.activeId = existing.id
      await this.save()
    }
    return this.view()
  }

  /** Pin a folder without switching to it. Idempotent per resolved root. */
  async add(root: string): Promise<WorkspaceRegistryView> {
    await this.load()
    const candidate = resolve(this.assertRoot(root))
    let stats
    try {
      stats = await fs.stat(candidate)
    } catch {
      throw new Error('The selected workspace folder does not exist')
    }
    if (!stats.isDirectory()) throw new Error('The selected path is not a directory')
    if (!this.findByRoot(candidate)) {
      this.items.unshift({
        id: randomUUID(),
        root: candidate,
        name: basename(candidate) || candidate,
        addedAt: Date.now(),
      })
      this.evictOverflow()
      await this.save()
    }
    return this.view()
  }

  async remove(id: string): Promise<WorkspaceRegistryView> {
    await this.load()
    const index = this.items.findIndex((item) => item.id === id)
    if (index >= 0) {
      this.items.splice(index, 1)
      if (this.activeId === id) this.activeId = undefined
      await this.save()
    }
    return this.view()
  }

  async markOpened(id: string): Promise<WorkspaceRegistryView> {
    await this.load()
    const entry = this.items.find((item) => item.id === id)
    if (!entry) throw new Error('Unknown saved workspace')
    entry.lastOpenedAt = Date.now()
    this.activeId = entry.id
    await this.save()
    return this.view()
  }

  /**
   * Register-and-open used by the pick/setRoot flows: pins the newly opened
   * root if needed and points the active marker at it.
   */
  async openRoot(root: string): Promise<WorkspaceRegistryView> {
    await this.load()
    const candidate = resolve(this.assertRoot(root))
    let entry = this.findByRoot(candidate)
    if (!entry) {
      entry = {
        id: randomUUID(),
        root: candidate,
        name: basename(candidate) || candidate,
        addedAt: Date.now(),
      }
      this.items.unshift(entry)
      this.evictOverflow()
    }
    entry.lastOpenedAt = Date.now()
    this.activeId = entry.id
    await this.save()
    return this.view()
  }

  private view(): WorkspaceRegistryView {
    return {
      version: 1,
      ...(this.activeId ? { activeId: this.activeId } : {}),
      items: structuredClone(this.items),
    }
  }

  private findByRoot(root: string): SavedWorkspace | undefined {
    const key = rootKeyFor(resolve(root))
    return this.items.find((item) => rootKeyFor(item.root) === key)
  }

  private assertRoot(root: string): string {
    const cleaned = typeof root === 'string' ? root.trim() : ''
    if (!cleaned) throw new Error('Workspace path cannot be empty')
    if (cleaned.length > MAX_ROOT_LENGTH) throw new Error(`Workspace path exceeds ${MAX_ROOT_LENGTH} characters`)
    return cleaned
  }

  /** Keep the pin list bounded by dropping the least recently used non-active entries. */
  private evictOverflow(): void {
    while (this.items.length > MAX_ITEMS) {
      let oldestIndex = -1
      let oldestRecency = Number.POSITIVE_INFINITY
      for (const [index, item] of this.items.entries()) {
        if (item.id === this.activeId) continue
        const recency = item.lastOpenedAt ?? item.addedAt
        if (recency < oldestRecency) {
          oldestRecency = recency
          oldestIndex = index
        }
      }
      if (oldestIndex < 0) break
      this.items.splice(oldestIndex, 1)
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.loadFromDisk().finally(() => { this.loadPromise = undefined })
    return this.loadPromise
  }

  private async loadFromDisk(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object') throw new Error('workspace registry file is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1) throw new Error('workspace registry file has an unsupported schema')

      const seenRoots = new Set<string>()
      const items: SavedWorkspace[] = []
      const rawItems = Array.isArray(record.items) ? record.items : []
      for (const raw of rawItems.slice(0, MAX_ITEMS)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const entry = raw as Record<string, unknown>
        const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 128) : ''
        const root = typeof entry.root === 'string' ? entry.root.trim().slice(0, MAX_ROOT_LENGTH) : ''
        if (!id || !root || seenRoots.has(rootKeyFor(root))) continue
        seenRoots.add(rootKeyFor(root))
        const addedAt = finiteNumber(entry.addedAt) ?? Date.now()
        const lastOpenedAt = finiteNumber(entry.lastOpenedAt)
        items.push({
          id,
          root,
          name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 256) : basename(root) || root,
          addedAt,
          ...(lastOpenedAt !== undefined ? { lastOpenedAt } : {}),
        })
      }
      this.items = items
      const activeId = typeof record.activeId === 'string' ? record.activeId : undefined
      this.activeId = activeId && items.some((item) => item.id === activeId) ? activeId : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable saved-workspace registry; it will be re-seeded from the current workspace:', error)
      }
      this.items = []
      this.activeId = undefined
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    const snapshot = structuredClone(this.view())
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    const write = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, serialized, 'utf8')
        await fs.rename(temp, this.filePath)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    })
    this.saveChain = write
    return write
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Workspace identity is case-insensitive only where the filesystem is. */
function rootKeyFor(root: string): string {
  return process.platform === 'win32' ? root.toLowerCase() : root
}

/** Simulates the legacy escape handling only for matching known saved roots. */
export function legacyEscapedWorkspacePath(root: string): string {
  let result = ''
  for (let index = 0; index < root.length; index += 1) {
    const character = root[index]
    if (character !== '\\' || index === root.length - 1) {
      result += character
      continue
    }
    const escaped = root[index += 1]!
    // The single-line project field historically flattened an escaped `\\n`
    // into a space before persistence; other control escapes survive as-is.
    result += escaped === 'n' ? ' '
      : escaped === 'r' ? '\r'
        : escaped === 't' ? '\t'
          : escaped === 'b' ? '\b'
            : escaped === 'f' ? '\f'
              : escaped === 'v' ? '\v'
                : escaped
  }
  return result
}
