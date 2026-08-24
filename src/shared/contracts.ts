export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type UiSourceConfidence = 'exact' | 'mapped' | 'framework' | 'inferred'

export interface UiSourceLocation {
  file: string
  line: number
  column?: number
  confidence: UiSourceConfidence
}

export interface UiReactInfo {
  component?: string
  hierarchy: string[]
  source?: UiSourceLocation
}

export interface UiCssDeclaration {
  name: string
  value: string
  important?: boolean
  source?: UiSourceLocation
}

export interface UiCssRule {
  selector: string
  origin: string
  declarations: UiCssDeclaration[]
  source?: UiSourceLocation
  sourceUrl?: string
  sourceMapUrl?: string
}

export interface UiTarget {
  id: string
  runtime: 'web'
  capturedAt: number
  url: string
  tagName: string
  text: string
  selector: string
  outerHtml: string
  attributes: Record<string, string>
  bounds: BrowserBounds
  computedStyle: Record<string, string>
  matchedCssRules: UiCssRule[]
  source?: UiSourceLocation
  react?: UiReactInfo
}

export interface UiAnnotationPoint {
  x: number
  y: number
}

export type UiAnnotationMarkKind = 'freehand' | 'rectangle' | 'point'

export interface UiAnnotationMark {
  kind: UiAnnotationMarkKind
  points: UiAnnotationPoint[]
  bounds: BrowserBounds
}

export interface UiAnnotationElementReference {
  selector: string
  tagName: string
  text: string
  bounds: BrowserBounds
  source?: UiSourceLocation
  react?: UiReactInfo
}

export interface UiAnnotation {
  id: string
  runtime: 'web'
  capturedAt: number
  url: string
  viewport: { width: number; height: number }
  marks: UiAnnotationMark[]
  elements: UiAnnotationElementReference[]
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
  inspectMode?: boolean
  selectedTarget?: UiTarget
  annotationMode?: boolean
  annotation?: UiAnnotation
}

export interface WorkspaceEntry {
  name: string
  relativePath: string
  kind: 'file' | 'directory'
}

export type WorkspaceBinding = 'standalone' | 'project' | 'unlinked' | 'missing'

export interface WorkspaceState {
  root: string
  name: string
  binding?: WorkspaceBinding
  companyId?: string
  companyName?: string
  projectId?: string
  projectName?: string
  projectWorkspacePath?: string
  warning?: string
}

/** One pinned workspace in the persisted sidebar registry. */
export interface SavedWorkspace {
  id: string
  root: string
  name: string
  addedAt: number
  lastOpenedAt?: number
}

export interface WorkspaceRegistryView {
  version: 1
  activeId?: string
  items: SavedWorkspace[]
}

/** Result of opening a saved workspace: the new root state plus the refreshed registry. */
export interface WorkspaceOpenResult {
  state: WorkspaceState
  registry: WorkspaceRegistryView
}

export interface WorkspaceFile {
  relativePath: string
  content: string
  truncated: boolean
}

export interface WorkspaceSuggestion {
  relativePath: string
  kind: 'file' | 'directory'
}

/** One changed path from `git status --porcelain -z`: x = index status, y = worktree status. Derived from microsoft/vscode extensions/git (MIT). */
export interface GitFileChange {
  path: string
  originalPath?: string | undefined
  x: string
  y: string
}

export interface GitCommitInfo {
  hash: string
  message: string
  authorName: string
  authorEmail: string
  date: string
}

export interface GitBranch {
  name: string
  current: boolean
  upstream?: string | undefined
  ahead?: number | undefined
  behind?: number | undefined
}

export interface GitStatusSnapshot {
  root: string
  /** Worktree root of the containing repository, or null when the workspace is not inside a Git repository. */
  repoRoot: string | null
  branch: string | null
  ahead: number
  behind: number
  heads: GitCommitInfo[]
  branches: GitBranch[]
  staged: GitFileChange[]
  unstaged: GitFileChange[]
  untracked: GitFileChange[]
  conflicts: GitFileChange[]
  remotes: string[]
  timestamp: number
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

export interface HarnessRunImage {
  data: string
  mediaType: string
  name: string
}

export interface HarnessRunOptions {
  sessionId?: string
  engineId?: string
  provider?: string
  model?: string
  image?: HarnessRunImage
}

/** ND-managed non-harness chat session surfaced alongside gateway sessions. */
export interface EngineSessionSummary {
  sessionId: string
  engineId: string
  title: string
  cwd?: string
  createdAt: number
  updatedAt: number
  running: boolean
  /** ND-side archival flag, resolved from the desktop archive store. */
  archived?: boolean
}

/** Replayed session events for a non-harness chat session. */
export interface EngineSessionTranscript {
  sessionId: string
  engineId: string
  events: SessionEventEnvelope[]
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
  /** Engine-owned execution guidance injected into organization worker prompts. */
  workerInstructions?: string
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
  /** ND-side archival flag; the pinned runtime list is annotated by the main process. */
  archived?: boolean
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

/** Result of a real HTTP probe against a provider's server. */
export interface ProviderPingResult {
  providerId: string
  /** ok = server answered; auth = answered but rejected the credential; unreachable = no answer. */
  state: 'ok' | 'auth' | 'unreachable'
  latencyMs?: number
  status?: number
  hasApiKey: boolean
  at: number
}

/**
 * Which app the titlebar inspect buttons aim at: 'external' targets another
 * application (screen capture, loopback CDP picker); 'self' targets this
 * ND-DSH window (window capture, in-renderer picker).
 */
export type InspectScope = 'external' | 'self'

/** Cross-app inspect: a screen capture bridged into the ND chat session. */
export interface AppInspectResult {
  sessionId: string
  messageId?: string
  copiedToClipboard: boolean
  width: number
  height: number
  displayLabel: string
}

/** Element picked in an external Electron app via the injected CDP inspector. */
export interface ExternalElementPickView {
  tag: string
  id?: string
  classes?: string[]
  role?: string
  ariaLabel?: string
  text?: string
  attributes?: string[]
  html?: string
  box: { x: number; y: number; width: number; height: number }
  url?: string
  pageTitle?: string
  /** CSS path from the document root to the element (id/position based). */
  selector?: string
  /** Key computed styles captured at pick time. */
  styles?: Record<string, string>
  /** Best-effort dev-build source location, e.g. "src/App.tsx:42". */
  source?: string
}

/** One pick round from the crosshair button; the renderer offers Add-to-chat. */
export interface ExternalElementPickResult {
  outcome: 'picked' | 'canceled' | 'unreachable'
  message?: string
  element?: ExternalElementPickView
  targetTitle?: string
  shortName?: string
  hover?: string
  /** Id of this pick in the main-process store; enables context/screenshot copy. */
  pickId?: string
  /** Whether a cropped element screenshot was captured for this pick. */
  hasShot?: boolean
}

/** A staged element chip waiting in the composer for the next prompt. */
export interface ExternalElementAttachmentView {
  id: string
  shortName: string
  hover: string
}

/**
 * QA targets. `script:<name>` runs a check detected in the user's project
 * package.json; `unit`/`e2e` are ND-DSH's own developer suites (Settings).
 */
export type QaSuiteId = 'unit' | 'e2e' | `script:${string}`

/** `project` suites belong to the user's workspace; `internal` suites test ND-DSH itself. */
export type QaSuiteKind = 'project' | 'internal'

export type QaRunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'unavailable'

export interface QaSuiteState {
  id: QaSuiteId
  kind: QaSuiteKind
  label: string
  /** Plain-language sentence describing what the check verifies. */
  description: string
  runner: string
  command: string
  status: QaRunStatus
  lastExitCode?: number
  lastDurationMs?: number
  lastFinishedAt?: number
  /** Shown when a check cannot run at all (e.g. Node.js missing on this computer). */
  notice?: string
}

export interface QaState {
  suites: QaSuiteState[]
  activeRun: QaSuiteId | null
}

/** One decoded stdout/stderr chunk streamed from a running suite. */
export interface QaOutputChunk {
  suite: QaSuiteId
  stream: 'stdout' | 'stderr'
  text: string
}

export interface DesktopApi {
  app: {
    info(): Promise<AppInfo>
  }
  /** Pluggable capability providers (engine/memory/context) and subject routing. */
  capabilities: {
    providers(): Promise<import('./capabilities.js').CapabilityDescriptor[]>
    assignments(): Promise<import('./capabilities.js').CapabilityAssignmentSnapshot>
    assign(subjectType: import('./capabilities.js').CapabilitySubjectType, subjectId: string, kind: import('./capabilities.js').CapabilityKind, providerId: string): Promise<import('./capabilities.js').CapabilityAssignmentSnapshot>
    onChanged(listener: (assignments: import('./capabilities.js').CapabilityAssignmentSnapshot) => void): () => void
    statuses(): Promise<Record<string, import('./capabilities.js').CapabilityProviderStatus>>
    verify(providerId: string): Promise<Record<string, import('./capabilities.js').CapabilityProviderStatus>>
    setEnabled(providerId: string, enabled: boolean): Promise<Record<string, import('./capabilities.js').CapabilityProviderStatus>>
    onStatusChanged(listener: (statuses: Record<string, import('./capabilities.js').CapabilityProviderStatus>) => void): () => void
  }
  providers: {
    list(): Promise<ModelProvider[]>
    save(providers: ModelProvider[]): Promise<ModelProvider[]>
    setApiKey(providerId: string, apiKey: string): Promise<ModelProvider[]>
    clearApiKey(providerId: string): Promise<ModelProvider[]>
    ping(providerId: string, force?: boolean): Promise<ProviderPingResult>
    onChanged(listener: (providers: ModelProvider[]) => void): () => void
  }
  engines: {
    list(): Promise<CodingEngineDescriptor[]>
    assignments(): Promise<Record<string, string>>
    assign(agentId: string, engineId: string): Promise<Record<string, string>>
    sessions(): Promise<EngineSessionSummary[]>
    transcript(sessionId: string): Promise<EngineSessionTranscript>
  }
  sessions: {
    /** Archive or unarchive any chat thread (harness or engine-backed); resolves with the refreshed archived id list. */
    setArchived(sessionId: string, archived: boolean): Promise<string[]>
  }
  capture: {
    inspectApp(copyToClipboard: boolean, scope?: InspectScope): Promise<AppInspectResult>
    inspectElement(scope?: InspectScope): Promise<ExternalElementPickResult>
    stageElement(element: ExternalElementPickView, targetTitle: string, pickId?: string): Promise<ExternalElementAttachmentView[]>
    elementAttachments(): Promise<ExternalElementAttachmentView[]>
    removeElement(id: string): Promise<ExternalElementAttachmentView[]>
    /** Copy the full agent-ready context block for a stored pick to the clipboard. */
    copyElementContext(pickId: string): Promise<boolean>
    /** Copy the cropped element screenshot (if captured) to the clipboard. */
    copyElementShot(pickId: string): Promise<boolean>
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
    setInspectMode?(enabled: boolean): Promise<BrowserState>
    clearSelection?(): Promise<BrowserState>
    setAnnotationMode?(enabled: boolean): Promise<BrowserState>
    clearAnnotation?(): Promise<BrowserState>
    openExternal(url: string): Promise<void>
    onState(listener: (state: BrowserState) => void): () => void
  }
  workspace: {
    state(): Promise<WorkspaceState>
    pick(): Promise<WorkspaceState>
    setRoot(path: string): Promise<WorkspaceState>
    list(relativePath?: string): Promise<WorkspaceEntry[]>
    read(relativePath: string): Promise<WorkspaceFile>
    suggest(query: string): Promise<WorkspaceSuggestion[]>
    onState(listener: (state: WorkspaceState) => void): () => void
    registry(): Promise<WorkspaceRegistryView>
    addSaved(): Promise<WorkspaceRegistryView>
    removeSaved(id: string): Promise<WorkspaceRegistryView>
    openSaved(id: string): Promise<WorkspaceOpenResult>
  }
  harness: {
    status(): Promise<HarnessStatus>
    run(prompt: string, options?: HarnessRunOptions): Promise<HarnessRunResult>
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
  git: {
    state(): Promise<GitStatusSnapshot>
    refresh(): Promise<GitStatusSnapshot>
    stage(relativePaths: string[]): Promise<GitStatusSnapshot>
    unstage(relativePaths: string[]): Promise<GitStatusSnapshot>
    discard(relativePaths: string[]): Promise<GitStatusSnapshot>
    commit(message: string): Promise<GitStatusSnapshot>
    diff(relativePath: string, staged?: boolean): Promise<string>
    checkout(branch: string): Promise<GitStatusSnapshot>
    createBranch(name: string): Promise<GitStatusSnapshot>
    push(): Promise<GitStatusSnapshot>
    pull(): Promise<GitStatusSnapshot>
    fetch(): Promise<GitStatusSnapshot>
    onState(listener: (state: GitStatusSnapshot) => void): () => void
  }
  qa: {
    state(): Promise<QaState>
    run(suite: QaSuiteId): Promise<QaState>
    stop(): Promise<QaState>
    onState(listener: (state: QaState) => void): () => void
    onOutput(listener: (chunk: QaOutputChunk) => void): () => void
  }
  window?: {
    setFloatMode(enabled: boolean): Promise<{ float: boolean }>
    resizeFloatWindow(width: number, height: number): Promise<void>
    moveFloatWindow(deltaX: number, deltaY: number): Promise<void>
    onFloatMode?(listener: (enabled: boolean) => void): () => void
  }
}

export const IPC = {
  appInfo: 'app:info',
  windowSetFloatMode: 'window:set-float-mode',
  windowResizeFloatWindow: 'window:resize-float-window',
  windowMoveFloatWindow: 'window:move-float-window',
  windowFloatModeEvent: 'window:float-mode-event',
  browserState: 'browser:state',
  browserSetBounds: 'browser:set-bounds',
  browserSetVisible: 'browser:set-visible',
  browserNavigate: 'browser:navigate',
  browserBack: 'browser:back',
  browserForward: 'browser:forward',
  browserReload: 'browser:reload',
  browserSnapshot: 'browser:snapshot',
  browserSetInspectMode: 'browser:set-inspect-mode',
  browserClearSelection: 'browser:clear-selection',
  browserSetAnnotationMode: 'browser:set-annotation-mode',
  browserClearAnnotation: 'browser:clear-annotation',
  browserOpenExternal: 'browser:open-external',
  browserStateEvent: 'browser:state-event',
  workspaceState: 'workspace:state',
  workspacePick: 'workspace:pick',
  workspaceSetRoot: 'workspace:set-root',
  workspaceList: 'workspace:list',
  workspaceRead: 'workspace:read',
  workspaceSuggest: 'workspace:suggest',
  workspaceStateEvent: 'workspace:state-event',
  workspaceRegistry: 'workspace:registry',
  workspaceAddSaved: 'workspace:add-saved',
  workspaceRemoveSaved: 'workspace:remove-saved',
  workspaceOpenSaved: 'workspace:open-saved',
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
  providersChangedEvent: 'providers:changed',
  providersSetApiKey: 'providers:set-api-key',
  providersClearApiKey: 'providers:clear-api-key',
  providersPing: 'providers:ping',
  enginesList: 'engines:list',
  enginesAssignments: 'engines:assignments',
  enginesAssign: 'engines:assign',
  enginesSessions: 'engines:sessions',
  enginesTranscript: 'engines:transcript',
  sessionsSetArchived: 'sessions:set-archived',
  captureInspectApp: 'capture:inspect-app',
  captureInspectElement: 'capture:inspect-element',
  captureStageElement: 'capture:stage-element',
  captureElementAttachments: 'capture:element-attachments',
  captureRemoveElement: 'capture:remove-element',
  captureCopyElementContext: 'capture:copy-element-context',
  captureCopyElementShot: 'capture:copy-element-shot',
  gitState: 'git:state',
  gitRefresh: 'git:refresh',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitDiff: 'git:diff',
  gitCheckout: 'git:checkout',
  gitCreateBranch: 'git:create-branch',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitFetch: 'git:fetch',
  gitStateEvent: 'git:state-event',
  qaState: 'qa:state',
  qaRun: 'qa:run',
  qaStop: 'qa:stop',
  qaStateEvent: 'qa:state-event',
  qaOutputEvent: 'qa:output-event',
} as const
