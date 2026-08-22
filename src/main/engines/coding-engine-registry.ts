import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingEngineDescriptor } from '../../shared/contracts.js'
import { buildCodingEngineCatalog, ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import { dshPatchPath, harnessCliBinPath, harnessRoot, presetSourceDir } from '../app-paths.js'
import type { EngineAssignmentStore } from './engine-assignment-store.js'

/**
 * ND control-plane registry for executable coding engines plus durable
 * per-employee routing. Organization workflow code consumes this abstraction,
 * never vendor package paths or product-specific protocol details.
 */
export class CodingEngineRegistry {
  constructor(private readonly assignmentsStore: EngineAssignmentStore) {}

  list(): CodingEngineDescriptor[] {
    const harnessReady = existsSync(harnessCliBinPath())
      && existsSync(dshPatchPath())
      && existsSync(presetSourceDir())
    const codexReady = harnessReady && existsSync(join(
      harnessRoot(),
      'packages/subagent/subagent-codex/lib/index.js',
    ))
    return buildCodingEngineCatalog({ harnessReady, codexReady })
  }

  assignments(): Promise<Record<string, string>> {
    return this.assignmentsStore.all()
  }

  assignedEngine(agentId: string | undefined): Promise<string> {
    return this.assignmentsStore.engineFor(agentId)
  }

  async assign(agentId: string, engineId: string): Promise<Record<string, string>> {
    const descriptor = this.list().find((engine) => engine.id === engineId)
    if (!descriptor) throw new Error(`Unknown coding engine: ${engineId}`)
    if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is unavailable`)
    return this.assignmentsStore.assign(agentId, engineId)
  }

  assertAvailable(engineId: string): CodingEngineDescriptor {
    const descriptor = this.list().find((engine) => engine.id === engineId)
    if (!descriptor) throw new Error(`Unknown coding engine: ${engineId}`)
    if (!descriptor.available) throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is unavailable`)
    return descriptor
  }

  async resetToHarness(agentId: string): Promise<Record<string, string>> {
    return this.assignmentsStore.assign(agentId, ND_HARNESS_ENGINE_ID)
  }
}
