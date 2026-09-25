export type ToolRoutingMode = 'off' | 'shadow' | 'assist' | 'enforce'

export type ToolRouterProvider = 'auto' | 'laya' | 'jev' | 'deterministic'

export type ToolDomain = 'core' | 'code' | 'git' | 'terminal' | 'browser' | 'planning' | 'custom'

export interface ToolRoutingSettings {
  version: 1
  /** Overall tool routing operating mode. */
  mode: ToolRoutingMode
  /** Routing intelligence provider: auto cascade, laya only, jev only, or deterministic only. */
  provider: ToolRouterProvider
  /** Minimum confidence threshold required to filter tool catalog. Default 0.78. */
  confidenceThreshold: number
  /** Minimum number of tools to expose to the agent. Default 3. */
  minTools: number
  /** Keep safe/core tools (read, search, verify) always available. Default true. */
  alwaysAvailableCoreTools: boolean
  /** Fall back to full tool catalog on router error or unconfident cascade. Default true. */
  failOpen: boolean
  /** Record routing decisions in the activity journal/log. Default true. */
  showRoutingInLog: boolean
  /** Allow projects to override tool routing configuration. Default true. */
  perProjectOverride: boolean
  /** Allow agents/workflows to override tool routing configuration. Default true. */
  perAgentOverride: boolean
}

export function defaultToolRoutingSettings(): ToolRoutingSettings {
  return {
    version: 1,
    mode: 'shadow',
    provider: 'auto',
    confidenceThreshold: 0.78,
    minTools: 3,
    alwaysAvailableCoreTools: true,
    failOpen: true,
    showRoutingInLog: true,
    perProjectOverride: true,
    perAgentOverride: true,
  }
}

export interface ToolSchema {
  name: string
  description: string
  domain: ToolDomain
  parameters?: Record<string, unknown>
}

export const CORE_SAFE_TOOL_NAMES = [
  'read_file',
  'search_workspace',
  'verification_status',
] as const

/**
 * Standard ND-DSH tool catalog (24 tools representing full company OS capabilities).
 */
export const STANDARD_TOOL_CATALOG: ToolSchema[] = [
  // Core / Inspection
  { name: 'read_file', description: 'Read file contents from workspace with bounded output.', domain: 'core', parameters: { path: 'string', offset: 'number', limit: 'number' } },
  { name: 'search_workspace', description: 'Perform bounded ripgrep search for string or regex across workspace files.', domain: 'core', parameters: { pattern: 'string', regex: 'boolean' } },
  { name: 'verification_status', description: 'Query status and evidence of configured machine verification checks.', domain: 'core', parameters: { taskId: 'string' } },
  { name: 'list_directory', description: 'List entries in a directory relative to workspace root.', domain: 'code', parameters: { path: 'string', recursive: 'boolean' } },
  { name: 'file_outline', description: 'Extract code symbols, classes, functions, and interfaces.', domain: 'code', parameters: { path: 'string' } },
  { name: 'write_file', description: 'Write or overwrite a file inside the task workspace.', domain: 'code', parameters: { path: 'string', content: 'string' } },
  { name: 'edit_file', description: 'Apply atomic line-based or patch edits to a file in workspace.', domain: 'code', parameters: { path: 'string', edits: 'array' } },
  { name: 'ast_grep', description: 'Perform semantic syntax tree pattern searches across project source code.', domain: 'code', parameters: { pattern: 'string', language: 'string' } },

  // Git / SCM
  { name: 'git_status', description: 'Get porcelain Git status of the workspace or active worktree.', domain: 'git', parameters: { scope: 'string' } },
  { name: 'git_diff', description: 'Inspect unstaged or staged git diff of the current task worktree.', domain: 'git', parameters: { cached: 'boolean', path: 'string' } },
  { name: 'git_log', description: 'Query recent git commit history with bounded entries.', domain: 'git', parameters: { limit: 'number' } },
  { name: 'git_commit', description: 'Create a local task commit with author and message.', domain: 'git', parameters: { message: 'string' } },
  { name: 'git_branch', description: 'List or inspect local task branches.', domain: 'git', parameters: { all: 'boolean' } },
  { name: 'git_checkout', description: 'Switch branch or restore file state in worktree.', domain: 'git', parameters: { target: 'string' } },

  // Terminal / Execution
  { name: 'terminal_run', description: 'Execute a command in an isolated managed terminal process.', domain: 'terminal', parameters: { command: 'string', timeoutMs: 'number' } },
  { name: 'terminal_output', description: 'Retrieve buffered output from a running managed terminal session.', domain: 'terminal', parameters: { terminalId: 'string' } },
  { name: 'terminal_kill', description: 'Terminate an active managed terminal session.', domain: 'terminal', parameters: { terminalId: 'string' } },
  { name: 'test_runner', description: 'Trigger the project test runner and return structured failure diagnostics.', domain: 'terminal', parameters: { suite: 'string' } },

  // Browser Platform
  { name: 'browser_navigate', description: 'Navigate active embedded WebContentsView to a local or verified URL.', domain: 'browser', parameters: { url: 'string' } },
  { name: 'browser_snapshot', description: 'Capture semantic accessibility tree and visible snapshot of page.', domain: 'browser', parameters: { depth: 'number' } },
  { name: 'browser_click', description: 'Simulate user click on DOM element by selector or coordinate.', domain: 'browser', parameters: { selector: 'string' } },
  { name: 'browser_type', description: 'Input text into a focused form input element.', domain: 'browser', parameters: { text: 'string' } },
  { name: 'browser_evaluate', description: 'Evaluate an isolated read-only JavaScript expression in page context.', domain: 'browser', parameters: { expression: 'string' } },
  { name: 'browser_network', description: 'Inspect recent network requests and responses made by the browser page.', domain: 'browser', parameters: { filter: 'string' } },
]

/**
 * Calculates schema tokens using realistic character density (~4 characters per token).
 */
export function estimateSchemaTokens(tools: ToolSchema[]): number {
  let chars = 0
  for (const tool of tools) {
    chars += tool.name.length + 10
    chars += tool.description.length + 15
    if (tool.parameters) {
      chars += JSON.stringify(tool.parameters).length + 10
    }
  }
  return Math.ceil(chars / 4)
}

export interface ToolRoutingDecision {
  mode: ToolRoutingMode
  provider: ToolRouterProvider | string
  confidence: number
  latencyMs: number
  totalCount: number
  selectedCount: number
  selectedTools: string[]
  effectiveTools: string[]
  fullSchemaTokens: number
  selectedSchemaTokens: number
  savedSchemaTokens: number
  savingsPercent: number
  fallbackFullCatalog: boolean
  fallbackReason?: string
  taskClass?: string
}

export interface ToolRoutingMetrics {
  routingMode: ToolRoutingMode
  routingProvider: string
  confidenceThreshold: number
  failOpenEnabled: boolean
  averageFullToolCount: number
  averageSelectedToolCount: number
  averageToolReductionPercent: number
  averageFullSchemaTokens: number
  averageSelectedSchemaTokens: number
  averageSchemaTokenReductionPercent: number
  missedRequiredToolCount: number
  fullCatalogFallbacks: number
  extraTurnsCausedByRouting: number
  taskCompletionRegression: boolean
  policyAuthorityPreserved: boolean
  machineVerificationPreserved: boolean
  secretHygiene: boolean
  recommendedMode: ToolRoutingMode
}

export const TOOL_ROUTING_IPC = {
  state: 'tool-routing:state',
  updateSettings: 'tool-routing:update-settings',
  routeTools: 'tool-routing:route-tools',
  changedEvent: 'tool-routing:changed',
} as const

export interface ToolRoutingDesktopApi {
  state(): Promise<{ settings: ToolRoutingSettings; recentDecisions: ToolRoutingDecision[] }>
  updateSettings(settings: ToolRoutingSettings): Promise<ToolRoutingSettings>
  routeTools(taskText: string): Promise<ToolRoutingDecision>
}
