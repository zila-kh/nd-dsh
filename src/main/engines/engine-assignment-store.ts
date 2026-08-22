import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'

interface EngineAssignmentSnapshot {
  version: 1
  agents: Record<string, string>
}

const EMPTY: EngineAssignmentSnapshot = { version: 1, agents: {} }

/** Durable ND-owned mapping from AI employee id to coding-engine route. */
export class EngineAssignmentStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: EngineAssignmentSnapshot = structuredClone(EMPTY)

  constructor(private readonly filePath: string) {}

  async all(): Promise<Record<string, string>> {
    await this.load()
    return structuredClone(this.value.agents)
  }

  async engineFor(agentId: string | undefined): Promise<string> {
    if (!agentId?.trim()) return ND_HARNESS_ENGINE_ID
    await this.load()
    return this.value.agents[agentId] ?? ND_HARNESS_ENGINE_ID
  }

  async assign(agentId: string, engineId: string): Promise<Record<string, string>> {
    const agent = cleanId(agentId, 'Agent id')
    const engine = cleanId(engineId, 'Engine id')
    await this.load()
    if (engine === ND_HARNESS_ENGINE_ID) delete this.value.agents[agent]
    else this.value.agents[agent] = engine
    await this.save()
    return structuredClone(this.value.agents)
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
      if (!parsed || typeof parsed !== 'object') throw new Error('engine assignment file is not an object')
      const record = parsed as Record<string, unknown>
      if (record.version !== 1 || !record.agents || typeof record.agents !== 'object' || Array.isArray(record.agents)) {
        throw new Error('engine assignment file has an unsupported schema')
      }
      const agents: Record<string, string> = {}
      for (const [agentId, engineId] of Object.entries(record.agents as Record<string, unknown>)) {
        if (typeof engineId !== 'string' || !agentId.trim() || !engineId.trim()) continue
        agents[agentId.trim()] = engineId.trim()
      }
      this.value = { version: 1, agents }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable coding-engine assignments; ND Harness will be used until reassigned:', error)
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

function cleanId(value: string, label: string): string {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > 256) throw new Error(`${label} must be a short non-empty string`)
  return cleaned
}
