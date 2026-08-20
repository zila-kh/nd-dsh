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
  error?: string
}

export interface HarnessNotification {
  method: string
  params?: unknown
}

export interface HarnessRunResult {
  sessionId: string
  finalResponse: string
  eventCount: number
  notificationCount: number
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  projectRoot: string
}

export interface DesktopApi {
  app: {
    info(): Promise<AppInfo>
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
    onState(listener: (state: BrowserState) => void): () => void
  }
  workspace: {
    state(): Promise<WorkspaceState>
    pick(): Promise<WorkspaceState>
    list(relativePath?: string): Promise<WorkspaceEntry[]>
    read(relativePath: string): Promise<WorkspaceFile>
  }
  harness: {
    status(): Promise<HarnessStatus>
    run(prompt: string): Promise<HarnessRunResult>
    stop(): Promise<HarnessStatus>
    onStatus(listener: (status: HarnessStatus) => void): () => void
    onNotification(listener: (notification: HarnessNotification) => void): () => void
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
  browserStateEvent: 'browser:state-event',
  workspaceState: 'workspace:state',
  workspacePick: 'workspace:pick',
  workspaceList: 'workspace:list',
  workspaceRead: 'workspace:read',
  harnessStatus: 'harness:status',
  harnessRun: 'harness:run',
  harnessStop: 'harness:stop',
  harnessStatusEvent: 'harness:status-event',
  harnessNotificationEvent: 'harness:notification-event',
} as const
