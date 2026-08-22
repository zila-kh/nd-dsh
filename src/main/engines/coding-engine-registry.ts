import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingEngineDescriptor } from '../../shared/contracts.js'
import { buildCodingEngineCatalog } from '../../shared/coding-engines.js'
import { dshPatchPath, harnessCliBinPath, harnessRoot, presetSourceDir } from '../app-paths.js'

/**
 * Main-process capability probe for coding engines owned by the ND control
 * plane. No organization code depends on vendor package paths directly.
 */
export class CodingEngineRegistry {
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
}
