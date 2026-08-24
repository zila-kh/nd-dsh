import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import type { CapabilityAssignmentSnapshot, CapabilityKind, CapabilitySubjectType } from '../../shared/capabilities.js'
import { CAPABILITY_KINDS, DEFAULT_CAPABILITY_PROVIDER } from '../../shared/capabilities.js'

const EMPTY: CapabilityAssignmentSnapshot = { version: 1, agents: {}, roles: {}, teams: {} }

/** Subject reference for resolution: an agent id plus its optional role/team for fallback. */
export interface CapabilitySubjectRef {
  type: CapabilitySubjectType
  /** Required for 'agent'; ignored otherwise. */
  id?: string
  role?: string
  team?: string
}

/**
 * Durable ND-owned routing from organization subjects (agents, roles, teams)
 * to capability providers. Sparse by design: a missing key means "use the
 * kind's default provider", so re-assigning the default deletes the entry.
 *
 * Migrates the legacy engine-only `engine-assignments.json` on first load;
 * the old file is left untouched and new writes go to the capability file.
 */
export class CapabilityAssignmentStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: CapabilityAssignmentSnapshot = structuredClone(EMPTY)

  constructor(private readonly filePath: string) {}

  async all(): Promise<CapabilityAssignmentSnapshot> {
    await this.load()
    return structuredClone(this.value)
  }

  /** Provider for one subject; precedence agent → role → team → kind default. */
  async resolve(kind: CapabilityKind, subject: CapabilitySubjectRef): Promise<string> {
    await this.load()
    const direct = subject.type === 'agent' && subject.id ? this.value.agents[subject.id]?.[kind] : undefined
    if (direct) return direct
    const role = subject.role ? this.value.roles[subject.role]?.[kind] : undefined
    if (role) return role
    const team = subject.team ? this.value.teams[subject.team]?.[kind] : undefined
    if (team) return team
    return DEFAULT_CAPABILITY_PROVIDER[kind]
  }

  async assign(subjectType: CapabilitySubjectType, subjectId: string, kind: CapabilityKind, providerId: string): Promise<CapabilityAssignmentSnapshot> {
    const subject = cleanId(subjectId, `${subjectType} id`)
    const provider = cleanId(providerId, 'Provider id')
    await this.load()
    const map = this.value[subjectType === 'agent' ? 'agents' : subjectType === 'role' ? 'roles' : 'teams']
    if (provider === DEFAULT_CAPABILITY_PROVIDER[kind]) {
      const entry = map[subject]
      if (entry) {
        delete entry[kind]
        if (Object.keys(entry).length === 0) delete map[subject]
      }
    } else {
      map[subject] = { ...map[subject], [kind]: provider }
    }
    await this.save()
    return structuredClone(this.value)
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
      if (!parsed || typeof parsed !== 'object') throw new Error('capability assignment file is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1) throw new Error('capability assignment file has an unsupported schema')
      const maps: Record<'agents' | 'roles' | 'teams', Record<string, Partial<Record<CapabilityKind, string>>>> = { agents: {}, roles: {}, teams: {} }
      for (const subjectType of ['agents', 'roles', 'teams'] as const) {
        const source = record[subjectType]
        const target = maps[subjectType]
        if (source === undefined) continue
        if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`capability assignment field ${subjectType} must be an object`)
        for (const [subjectId, kinds] of Object.entries(source as Record<string, unknown>)) {
          if (!kinds || typeof kinds !== 'object' || Array.isArray(kinds)) continue
          const entry: Partial<Record<CapabilityKind, string>> = {}
          for (const kind of CAPABILITY_KINDS) {
            const value = (kinds as Record<string, unknown>)[kind]
            if (typeof value === 'string' && value.trim()) entry[kind] = value.trim()
          }
          if (Object.keys(entry).length > 0 && subjectId.trim()) target[subjectId.trim()] = entry
        }
      }
      this.value = { version: 1, agents: maps.agents, roles: maps.roles, teams: maps.teams }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable capability assignments; default providers will be used until reassigned:', error)
        this.value = structuredClone(EMPTY)
      } else {
        this.value = await this.migrateLegacyEngineAssignments()
      }
    }
    this.loaded = true
  }

  /** Adopt the pre-capability per-agent engine routing so upgrades keep their assignments. */
  private async migrateLegacyEngineAssignments(): Promise<CapabilityAssignmentSnapshot> {
    const legacyPath = this.filePath.replace(/capability-assignments\.json$/, 'engine-assignments.json')
    if (legacyPath === this.filePath) return structuredClone(EMPTY)
    try {
      const parsed = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as unknown
      const record = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).agents : undefined)
      if (!record || typeof record !== 'object' || Array.isArray(record)) return structuredClone(EMPTY)
      const agents: Record<string, Partial<Record<CapabilityKind, string>>> = {}
      for (const [agentId, engineId] of Object.entries(record as Record<string, unknown>)) {
        if (typeof engineId !== 'string' || !agentId.trim() || !engineId.trim() || engineId === DEFAULT_CAPABILITY_PROVIDER.engine) continue
        agents[agentId.trim()] = { engine: engineId.trim() }
      }
      return { version: 1, agents, roles: {}, teams: {} }
    } catch {
      return structuredClone(EMPTY)
    }
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

function cleanId(value: string, label: string): string {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > 256) throw new Error(`${label} must be a short non-empty string`)
  return cleaned
}
