export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type AgentBrowserState = 'binding' | 'ready' | 'unavailable'

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  visible: boolean
  cdpPort: number
  targetId?: string
  agentBrowser: AgentBrowserState
  agentBrowserError?: string
}

export interface WorkspaceEntry {
  name: string
  relativePath: string
  kind: 'file' | 'directory'
}

export interface WorkspaceState {
  root: string
  name: string
}

export interface WorkspaceFile {
  relativePath: string
  content: string
  truncated: boolean
}

export type HarnessState = 'stopped' | 'starting' | 'ready' | 'running' | 'error'

export interface HarnessStatus {
  state: HarnessState
  sourceReady: boolean
  apiKeyPresent: boolean
  provider: string
  model: string
  sessionId?: string
  url?: string
  port?: number
  error?: string
}

export interface HarnessRunResult {
  sessionId: string
  messageId?: string
}

export type CodingEngineIntegration = 'primary' | 'delegated'

export interface CodingEngineCapabilities {
  workspace: boolean
  filesystem: boolean
  shell: boolean
  browser: boolean
  skills: boolean
  mcp: boolean
  modelProviderRouting: boolean
  humanApprovals: boolean
  streaming: boolean
  persistentSessions: boolean
}

export interface CodingEngineDescriptor {
  id: string
  name: string
  integration: CodingEngineIntegration
  available: boolean
  description: string
  unavailableReason?: string
  capabilities: CodingEngineCapabilities
}

export type DshSurface = 'dsh' | 'workbench'

export interface DshViewState {
  ready: boolean
  loading: boolean
  title: string
  visible: boolean
  url?: string
  port?: number
}

export interface SurfaceState {
  surface: DshSurface
  view: DshViewState
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

export interface ModelCatalogModel {
  id: string
  name?: string
  description?: string
  reasoning?: { efforts: ModelReasoningEffort[]; defaultEffort?: string }
}

export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

export interface SessionModels {
  current: { provider: string; model: string; reasoningEffort?: string }
  routable: boolean
  groups: ModelProviderGroup[]
  failures: { id: string; name: string; message: string }[]
}

export interface AgentPresetSummary {
  id: string
  name?: string
  description?: string
  order?: number
  broken?: string
}

export interface SessionEventEnvelope {
  type: string
  seq: number
  time: number
  data?: unknown
  surfaceOp?: unknown
}

export interface DshEventFrame {
  kind:
    | 'session-event'
    | 'approval-requested'
    | 'approval-resolved'
    | 'question-requested'
    | 'question-resolved'
    | 'session-status'
    | 'session-added'
    | 'session-removed'
    | 'agent-error'
    | 'stream-error'
    | 'other'
  sessionId?: string
  event?: SessionEventEnvelope
  approvalId?: string
  toolName?: string
  callId?: string
  reason?: string
  outcome?: string
  running?: boolean
  questions?: unknown
  message?: string
  rpcId?: string
  meta?: unknown
}

export interface GatewayRpcResult {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  projectRoot: string
}

export type ThemeMode = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'

export interface ThemeState {
  mode: ThemeMode
  effective: EffectiveTheme
}

export interface ProviderModel {
  id: string
  context: string
}

/**
 * Renderer-safe provider metadata. ProviderStore.list() always returns
 * `apiKey: ''`; `hasApiKey` is the only signal that an existing credential is
 * present. The non-empty key is held only by the trusted main process and the
 * temporary child-process environment used for model execution.
 */
export interface ModelProvider {
  id: string
  name: string
  enabled: boolean
  baseUrl: string
  apiFormat: string
  apiKey: string
  hasApiKey?: boolean
  models: ProviderModel[]
}

export interface DesktopApi {
  app: {
    info(): Promise<AppInfo>
  }
  providers: {
    list(): Promise<ModelProvider[]>
    save(providers: ModelProvider[]): Promise<ModelProvider[]>
    setApiKey(providerId: string, apiKey: string): Promise<ModelProvider[]>
    clearApiKey(providerId: string): Promise<ModelProvider[]>
  }
  engines: {
    list(): Promise<CodingEngineDescriptor[]>
    assignments(): Promise<Record<string, string>>
    assign(agentId: string, engineId: string): Promise<Record<string, string>>
  }
  browser: {
    state(): Promise<BrowserState>
    setBounds(bounds: BrowserBounds): Promise<void>
    setVisible(visible: boolean): Promise<void>
    navigate(url: string): Promise<BrowserState>
    back(): Promise<BrowserState>
    forward(): Promise<BrowserState>
    reload(): Promise<BrowserState>
    snapshot(): Promise<unknown>
    openExternal(url: string): Promise<void>
    onState(listener: (state: BrowserState) => void): () => void
  }
  workspace: {
    state(): Promise<WorkspaceState>
    pick(): Promise<WorkspaceState>
    setRoot(path: string): Promise<WorkspaceState>
    list(relativePath?: string): Promise<WorkspaceEntry[]>
    read(relativePath: string): Promise<WorkspaceFile>
  }
  harness: {
    status(): Promise<HarnessStatus>
    run(prompt: string, options?: { sessionId?: string }): Promise<HarnessRunResult>
    stop(): Promise<HarnessStatus>
    getPermissionMode(): Promise<string>
    setPermissionMode(mode: string): Promise<string>
    onStatus(listener: (status: HarnessStatus) => void): () => void
  }
  dsh: {
    rpc(method: string, payload?: unknown): Promise<GatewayRpcResult>
    respond(rpcId: string, value: unknown): Promise<void>
    onEvent(listener: (frame: DshEventFrame) => void): () => void
  }
  surface: {
    state(): Promise<SurfaceState>
    set(surface: DshSurface): Promise<SurfaceState>
    onChanged(listener: (state: SurfaceState) => void): () => void
  }
  dshView: {
    setBounds(bounds: BrowserBounds): Promise<void>
    setVisible(visible: boolean): Promise<void>
    reload(): Promise<void>
    onState(listener: (state: DshViewState) => void): () => void
  }
  theme: {
    state(): Promise<ThemeState>
    set(mode: ThemeMode): Promise<ThemeState>
    onChanged(listener: (state: ThemeState) => void): () => void
  }
}

export const IPC = {
  appInfo: 'app:info',
  browserState: 'browser:state',
  browserSetBounds: 'browser:set-bounds',
  browserSetVisible: 'browser:set-visible',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserSnapshot: 'browser:snapshot',
  browserOpenExternal: 'browser:open-external',
  browserStateEvent: 'browser:state-event',
  workspaceState: 'workspace:state',
  workspacePick: 'workspace:pick',
  workspaceSetRoot: 'workspace:set-root',
  workspaceList: 'workspace:list',
  workspaceRead: 'workspace:read',
  harnessStatus: 'harness:status',
  harnessRun: 'harness:run',
  harnessStop: 'harness:stop',
  harnessPermissionGet: 'harness:permission:get',
  harnessPermissionSet: 'harness:permission:set',
  harnessStatusEvent: 'harness:status-event',
  dshRpc: 'dsh:rpc',
  dshRespond: 'dsh:respond',
  dshEvent: 'dsh:event',
  surfaceState: 'surface:state',
  surfaceSet: 'surface:set',
  surfaceChangedEvent: 'surface:changed',
  dshViewSetBounds: 'dsh-view:set-bounds',
  dshViewSetVisible: 'dsh-view:set-visible',
  dshViewReload: 'dsh-view:reload',
  dshViewStateEvent: 'dsh-view:state-event',
  themeState: 'theme:state',
  themeSet: 'theme:set',
  themeChangedEvent: 'theme:changed',
  providersList: 'providers:list',
  providersSave: 'providers:save',
  providersSetApiKey: 'providers:set-api-key',
  providersClearApiKey: 'providers:clear-api-key',
  enginesList: 'engines:list',
  enginesAssignments: 'engines:assignments',
  enginesAssign: 'engines:assign',
} as const
