import type { CodingEngineDescriptor } from './contracts.js'

export const ND_HARNESS_ENGINE_ID = 'nd-harness'
export const CODEX_ENGINE_ID = 'codex'
export const CODEX_CLI_ENGINE_ID = 'codex-cli'
export const ANTIGRAVITY_ENGINE_ID = 'antigravity'

export interface CodingEngineAvailability {
  harnessReady: boolean
  codexReady: boolean
  codexCliReady: boolean
  antigravityReady: boolean
}

/**
 * Product-owned engine catalog. Runtime probes decide availability; the
 * descriptors themselves stay independent from Electron and vendor packages.
 *
 * `workerInstructions` carries engine-specific execution guidance for
 * organization workers so workflow code never branches on engine ids.
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
  const codexCliReason = availability.codexCliReady
    ? undefined
    : 'The pinned Codex CLI payload is not installed. Run the product bootstrap to install it.'
  const antigravityReason = availability.antigravityReady
    ? undefined
    : 'The Antigravity CLI (agy) is not installed. Install it from https://antigravity.google or point ND_DSH_ANTIGRAVITY_BINARY at the binary.'

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
      workerInstructions: '\nExecution engine: ND Harness. Work directly in the project workspace using the available ND tools.\n',
    },
    {
      id: CODEX_ENGINE_ID,
      name: 'Codex (delegated)',
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
      workerInstructions: '\nExecution engine: Codex CLI (delegated through the ND runtime).\nYou MUST delegate the implementation to the subagent_codex tool as one self-contained task that includes the project objective, task description, acceptance criteria, and relevant review feedback. Do not implement the requested code changes yourself before that delegation. After Codex returns, inspect the actual workspace, run appropriate validation with your ND tools, and report an evidence-based result. If Codex authentication, project trust, sandbox policy, or execution fails, report the blocker clearly and do not invent completion.\n',
    },
    {
      id: CODEX_CLI_ENGINE_ID,
      name: 'Codex CLI',
      integration: 'primary',
      available: availability.codexCliReady,
      description: 'Official Codex app-server managed directly by ND: streamed chat threads, approval prompts, and workspace-scoped unattended runs. Authentication and model configuration remain native to Codex.',
      ...(codexCliReason ? { unavailableReason: codexCliReason } : {}),
      capabilities: {
        workspace: true,
        filesystem: true,
        shell: true,
        browser: false,
        skills: false,
        mcp: false,
        modelProviderRouting: false,
        humanApprovals: true,
        streaming: true,
        persistentSessions: false,
      },
      workerInstructions: '\nExecution engine: Codex CLI (direct, managed by ND).\nImplement the requested changes yourself with your native Codex tools inside the provided project workspace. Inspect before editing, stay inside the workspace sandbox, and run meaningful validation before declaring the task complete. If authentication, project trust, sandbox policy, or execution fails, report the blocker clearly and do not invent completion.\n',
    },
    {
      id: ANTIGRAVITY_ENGINE_ID,
      name: 'Antigravity CLI',
      integration: 'primary',
      available: availability.antigravityReady,
      description: 'Google Antigravity CLI (agy) managed directly by ND: streamed multi-turn conversations over the stream-json wires with native Google-account authentication. Model configuration and headless permission policy remain native to Antigravity.',
      ...(antigravityReason ? { unavailableReason: antigravityReason } : {}),
      capabilities: {
        workspace: true,
        filesystem: true,
        shell: true,
        browser: false,
        skills: false,
        mcp: false,
        modelProviderRouting: false,
        humanApprovals: false,
        streaming: true,
        persistentSessions: false,
      },
      workerInstructions: '\nExecution engine: Antigravity CLI (direct, managed by ND).\nImplement the requested changes yourself with your native Antigravity tools inside the provided project workspace. The session is headless: tools the user has not allow-listed in the Antigravity CLI settings are auto-denied, so report permission denials clearly instead of retrying or inventing completion. Do not use Antigravity browser tools; ND owns browser control. If authentication or execution fails, report the blocker clearly and do not invent completion.\n',
    },
  ]
}
