import type { CodingEngineDescriptor } from './contracts.js'

export const OPENCODE_CLI_ENGINE_ID = 'opencode-cli'
export const GOOSE_CLI_ENGINE_ID = 'goose-cli'
export const JCODE_CLI_ENGINE_ID = 'jcode-cli'
export const HERMES_CLI_ENGINE_ID = 'hermes-cli'
export const MINIMAX_CLI_ENGINE_ID = 'minimax-cli'

export interface ExtraCodingEngineAvailability {
  opencodeCliReady: boolean
  gooseCliReady: boolean
  jcodeCliReady: boolean
  hermesCliReady: boolean
  minimaxCliReady: boolean
}

const workspaceCapabilities = {
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
} as const

function unavailable(ready: boolean, message: string): string | undefined {
  return ready ? undefined : message
}

/** Additional user-installed engines kept outside the core catalog so adding a CLI never changes ND task data shapes. */
export function buildExtraCodingEngineCatalog(availability: ExtraCodingEngineAvailability): CodingEngineDescriptor[] {
  const opencodeReason = unavailable(
    availability.opencodeCliReady,
    'The OpenCode CLI is not installed. Install OpenCode or point ND_DSH_OPENCODE_BINARY at the binary.',
  )
  const gooseReason = unavailable(
    availability.gooseCliReady,
    'The goose CLI is not installed. Install goose from the Agentic AI Foundation release or point ND_DSH_GOOSE_BINARY at the binary.',
  )
  const jcodeReason = unavailable(
    availability.jcodeCliReady,
    'The JCode CLI is not installed. Install it from https://jcode.sh or point ND_DSH_JCODE_BINARY at the binary.',
  )
  const hermesReason = unavailable(
    availability.hermesCliReady,
    'The Hermes Agent CLI is not installed. Install Hermes Agent or point ND_DSH_HERMES_BINARY at the binary.',
  )
  const minimaxReason = unavailable(
    availability.minimaxCliReady,
    'The MiniMax CLI (mmx) is not installed. Install mmx-cli or point ND_DSH_MINIMAX_BINARY at the binary.',
  )

  return [
    {
      id: OPENCODE_CLI_ENGINE_ID,
      name: 'OpenCode CLI',
      integration: 'primary',
      available: availability.opencodeCliReady,
      description: 'OpenCode managed directly by ND through its headless JSON event stream. Native OpenCode authentication, provider selection, project rules, and explicit deny rules remain authoritative.',
      ...(opencodeReason ? { unavailableReason: opencodeReason } : {}),
      capabilities: { ...workspaceCapabilities },
      workerInstructions: '\nExecution engine: OpenCode CLI (direct, managed by ND).\nWork only inside the provided project workspace. ND uses OpenCode headless JSON mode and auto-approves requests that OpenCode has not explicitly denied, so keep every tool call scoped to the task and workspace. Run meaningful validation before declaring completion. If native authentication, provider setup, permission rules, or execution fails, report the blocker and do not invent completion.\n',
    },
    {
      id: GOOSE_CLI_ENGINE_ID,
      name: 'Goose CLI',
      integration: 'primary',
      available: availability.gooseCliReady,
      description: 'Agentic AI Foundation goose managed directly by ND through its headless stream-json run mode with native sessions and provider configuration.',
      ...(gooseReason ? { unavailableReason: gooseReason } : {}),
      capabilities: { ...workspaceCapabilities },
      workerInstructions: '\nExecution engine: Goose CLI (direct, managed by ND).\nImplement the requested work inside the provided workspace using goose\'s native developer tools. Keep changes task-scoped, avoid unrelated external extensions, and validate the result before reporting completion. Native goose provider, extension, and security configuration remains authoritative.\n',
    },
    {
      id: JCODE_CLI_ENGINE_ID,
      name: 'JCode CLI',
      integration: 'primary',
      available: availability.jcodeCliReady,
      description: 'JCode managed directly by ND through its documented wrapper-oriented NDJSON run contract, with native provider/model selection and session continuity.',
      ...(jcodeReason ? { unavailableReason: jcodeReason } : {}),
      capabilities: { ...workspaceCapabilities },
      workerInstructions: '\nExecution engine: JCode CLI (direct, managed by ND).\nImplement and validate the requested changes inside the provided project workspace. ND invokes JCode in quiet wrapper mode with update/self-development side effects disabled; native authentication, provider, model, tool policy, and project AGENTS.md remain authoritative.\n',
    },
    {
      id: HERMES_CLI_ENGINE_ID,
      name: 'Hermes CLI',
      integration: 'primary',
      available: availability.hermesCliReady,
      description: 'Nous Research Hermes Agent managed directly by ND through its documented one-shot stream-json interface with native session resume and tool events.',
      ...(hermesReason ? { unavailableReason: hermesReason } : {}),
      capabilities: { ...workspaceCapabilities },
      workerInstructions: '\nExecution engine: Hermes Agent CLI (direct, managed by ND).\nImplement the requested work inside the provided project workspace, respecting Hermes\' native safety and tool configuration. ND does not bypass dangerous-command approvals for Hermes. If a headless permission, authentication, provider, or tool-policy restriction blocks the task, report it clearly instead of retrying unsafely.\n',
    },
    {
      id: MINIMAX_CLI_ENGINE_ID,
      name: 'MiniMax CLI',
      integration: 'primary',
      available: availability.minimaxCliReady,
      description: 'MiniMax mmx text CLI exposed as an interactive model-backed chat engine. mmx itself is not a coding harness, so ND does not claim filesystem, shell, workspace execution, or organization-worker support for it.',
      ...(minimaxReason ? { unavailableReason: minimaxReason } : {}),
      capabilities: {
        workspace: false,
        filesystem: false,
        shell: false,
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
