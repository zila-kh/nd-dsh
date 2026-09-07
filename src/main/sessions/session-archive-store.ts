import type { SkillSuggestion } from '../../shared/skill-catalog.js'
import { messageText } from '../../shared/chat-events.js'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

interface SessionArchiveSnapshot {
  version: 1
  archived: Record<string, number>
  messages?: Record<string, { original: string; skill: SkillSuggestion }>
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

  async rememberSkillMessage(sessionId: string, wire: string, original: string, skill: SkillSuggestion): Promise<void> {
    await this.load()
    this.value.messages ??= {}
    this.value.messages[this.messageKey(sessionId, wire)] = { original, skill }
    await this.save()
  }

  private messageKey(sessionId: string, text: string): string {
    return createHash('sha256').update(JSON.stringify([sessionId, text])).digest('hex')
  }

  /** Exact submitted-wire lookup only: never parse or strip historical envelopes. */
  async restoreSkillMessages<T>(sessionId: string, value: T): Promise<T> {
    await this.load()
    const visit = (item: unknown): unknown => {
      if (Array.isArray(item)) return item.map(visit)
      if (!item || typeof item !== 'object') return item
      const record = item as Record<string, unknown>
      if (record.type === 'user/message' && record.data && typeof record.data === 'object') {
        const data = record.data as Record<string, unknown>
        const text = messageText(data.message)
        const saved = text === undefined ? undefined : this.value.messages?.[this.messageKey(sessionId, text)]
        if (saved) return { ...record, data: { ...data, message: saved.original, skillMention: saved.skill } }
      }
      return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]))
    }
    return visit(value) as T
  }

  /** Every archived session id across workspaces (ids are globally unique). */
  async archivedIds(): Promise<Set<string>> {
    await this.load()
    return new Set(Object.keys(this.value.archived))
  }

  /** Archive or unarchive one session; resolves with the refreshed id list. */
  async setArchived(sessionId: string, archived: boolean): Promise<string[]> {
    return this.setArchivedMany([sessionId], archived)
  }

  /** Archive or unarchive several sessions with one atomic persistence pass. */
  async setArchivedMany(sessionIds: string[], archived: boolean): Promise<string[]> {
    if (!Array.isArray(sessionIds)) throw new Error('Session ids must be a list')
    const ids = [...new Set(sessionIds.map(cleanSessionId))]
    await this.load()
    if (ids.length === 0) return Object.keys(this.value.archived)
    if (archived) {
      const archivedAt = Date.now()
      for (const id of ids) this.value.archived[id] = archivedAt
    } else {
      for (const id of ids) delete this.value.archived[id]
    }
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
      this.value = { version: 1, archived, ...(record.messages && typeof record.messages === 'object' && !Array.isArray(record.messages) ? { messages: record.messages as NonNullable<SessionArchiveSnapshot['messages']> } : {}) }
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
