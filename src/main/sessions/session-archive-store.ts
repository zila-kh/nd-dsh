import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

interface SessionArchiveSnapshot {
  version: 1
  archived: Record<string, number>
}

const EMPTY: SessionArchiveSnapshot = { version: 1, archived: {} }

/**
 * ND-side chat archival. The pinned runtime has no archive concept, so the
 * desktop keeps its own per-session flag in userData and annotates session
 * listings with it; session data itself stays untouched in the runtime.
 */
export class SessionArchiveStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: SessionArchiveSnapshot = structuredClone(EMPTY)

  constructor(private readonly filePath: string) {}

  /** Every archived session id across workspaces (ids are globally unique). */
  async archivedIds(): Promise<Set<string>> {
    await this.load()
    return new Set(Object.keys(this.value.archived))
  }

  /** Archive or unarchive one session; resolves with the refreshed id list. */
  async setArchived(sessionId: string, archived: boolean): Promise<string[]> {
    const id = cleanSessionId(sessionId)
    await this.load()
    if (archived) this.value.archived[id] = Date.now()
    else delete this.value.archived[id]
    await this.save()
    return Object.keys(this.value.archived)
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
      if (!parsed || typeof parsed !== 'object') throw new Error('session archive file is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || !record.archived || typeof record.archived !== 'object' || Array.isArray(record.archived)) {
        throw new Error('session archive file has an unsupported schema')
      }
      const archived: Record<string, number> = {}
      for (const [sessionId, archivedAt] of Object.entries(record.archived as Record<string, unknown>)) {
        if (!sessionId.trim() || typeof archivedAt !== 'number' || !Number.isFinite(archivedAt)) continue
        archived[sessionId.trim()] = archivedAt
      }
      this.value = { version: 1, archived }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable chat archive state; sessions will appear unarchived until retoggled:', error)
      }
      this.value = structuredClone(EMPTY)
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    const snapshot = structuredClone(this.value)
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

function cleanSessionId(value: string): string {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > 256) throw new Error('Session id must be a short non-empty string')
  return cleaned
}
