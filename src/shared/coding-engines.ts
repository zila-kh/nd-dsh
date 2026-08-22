import type { CodingEngineDescriptor } from './contracts.js'

export const ND_HARNESS_ENGINE_ID = 'nd-harness'
export const CODEX_ENGINE_ID = 'codex'

export interface CodingEngineAvailability {
  harnessReady: boolean
  codexReady: boolean
}

/**
 * Product-owned engine catalog. Runtime probes decide availability; the
 * descriptors themselves stay independent from Electron and vendor packages.
 */
export function buildCodingEngineCatalog(availability: CodingEngineAvailability): CodingEngineDescriptor[] {
  const harnessReason = availability.harnessReady
    ? undefined
    : 'ND runtime is not bootstrapped. Run the product bootstrap before starting agents.'
  const codexReason = availability.harnessReady
    ? availability.codexReady
      ? undefined
      : 'The pinned Codex adapter is not built. Run the product bootstrap to install its platform payload.'
    : 'Codex delegation depends on the ND runtime bootstrap.'

  return [
    {
      id: ND_HARNESS_ENGINE_ID,
      name: 'ND Harness',
      integration: 'primary',
      available: availability.harnessReady,
      description: 'Primary ND coding runtime with durable sessions, workspace tools, browser control, skills, MCP, approvals, and provider-neutral model routing.',
      ...(harnessReason ? { unavailableReason: harnessReason } : {}),
      capabilities: {
        workspace: true,
        filesystem: true,
        shell: true,
        browser: true,
        skills: true,
        mcp: true,
        modelProviderRouting: true,
        humanApprovals: true,
        streaming: true,
        persistentSessions: true,
      },
    },
    {
      id: CODEX_ENGINE_ID,
      name: 'Codex CLI',
      integration: 'delegated',
      available: availability.codexReady,
      description: 'Official Codex app-server exposed as a one-shot coding engine through the pinned ND Harness adapter. Authentication and model configuration remain native to Codex.',
      ...(codexReason ? { unavailableReason: codexReason } : {}),
      capabilities: {
        workspace: true,
        filesystem: true,
        shell: true,
        browser: false,
        skills: false,
        mcp: false,
        modelProviderRouting: false,
        humanApprovals: false,
        streaming: false,
        persistentSessions: false,
      },
    },
  ]
}
