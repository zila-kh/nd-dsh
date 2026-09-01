import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingEngineDescriptor } from '../../shared/contracts.js'
import { buildCodingEngineCatalog, ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import { codexBinPath, dshPatchPath, harnessCliBinPath, harnessRoot, presetSourceDir } from '../app-paths.js'
import type { CapabilityAssignmentStore } from '../capabilities/capability-assignment-store.js'

/**
 * ND control-plane registry for executable coding engines plus durable
 * per-employee routing. Organization workflow code consumes this abstraction,
 * never vendor package paths or product-specific protocol details.
 *
 * Assignments live in the shared capability store so engines, memory, and
 * context resolve through one mechanism; this class keeps the engine-shaped
 * surface the renderer and orchestrator already use.
 */
export class CodingEngineRegistry {
  constructor(private readonly assignmentsStore: CapabilityAssignmentStore) {}

  list(): CodingEngineDescriptor[] {
    const harnessReady = existsSync(harnessCliBinPath())
      && existsSync(dshPatchPath())
      && existsSync(presetSourceDir())
    const root = harnessRoot()
    const codexReady = harnessReady && [
      join(root, 'packages/subagent/subagent-codex/lib/index.js'),
      join(root, 'node_modules/@deepseek-ai/dsh-subagent-codex/lib/index.js'),
    ].some((entry) => existsSync(entry))
    // The direct engine needs only the pinned Codex CLI payload; it does not
    // depend on the ND runtime bootstrap.
    const codexCliReady = codexBinPath() !== undefined
    return buildCodingEngineCatalog({ harnessReady, codexReady, codexCliReady })
  }

  /** Legacy view: agent id → engine id for agents explicitly off the default. */
  async assignments(): Promise<Record<string, string>> {
    const snapshot = await this.assignmentsStore.all()
    const agents: Record<string, string> = {}
    for (const [agentId, kinds] of Object.entries(snapshot.agents)) {
      if (kinds.engine) agents[agentId] = kinds.engine
    }
    return agents
  }

  async assignedEngine(agentId: string | undefined): Promise<string> {
    if (!agentId?.trim()) return ND_HARNESS_ENGINE_ID
    return this.assignmentsStore.resolve('engine', { type: 'agent', id: agentId })
  }

  async assign(agentId: string, engineId: string): Promise<Record<string, string>> {
    const descriptor = this.list().find((engine) => engine.id === engineId)
    if (!descriptor) throw new Error(`Unknown coding engine: ${engineId}`)
    if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is unavailable`)
    await this.assignmentsStore.assign('agent', agentId, 'engine', engineId)
    return this.assignments()
  }

  assertAvailable(engineId: string): CodingEngineDescriptor {
    const descriptor = this.list().find((engine) => engine.id === engineId)
    if (!descriptor) throw new Error(`Unknown coding engine: ${engineId}`)
    if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is unavailable`)
    return descriptor
  }

  async resetToHarness(agentId: string): Promise<Record<string, string>> {
    await this.assignmentsStore.assign('agent', agentId, 'engine', ND_HARNESS_ENGINE_ID)
    return this.assignments()
  }
}
