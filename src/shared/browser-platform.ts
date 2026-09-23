export type BrowserTargetKind = 'builtin' | 'companion'
export type BrowserSelectionMode = 'auto' | 'target' | 'tab'

export interface BrowserTargetCapabilities {
  tabs: boolean
  semanticDom: boolean
  screenshots: boolean
  downloads: boolean
  uploads: boolean
  history: boolean
  credentials: boolean
  extensions: boolean
  siteTools: boolean
  backgroundControl: boolean
}

export interface BrowserTargetDescriptor {
  id: string
  kind: BrowserTargetKind
  label: string
  profileId: string
  profileLabel: string
  connected: boolean
  visible: boolean
  capabilities: BrowserTargetCapabilities
}

export interface BrowserTabDescriptor {
  id: string
  targetId: string
  profileId: string
  nativeTabId?: number
  title: string
  url: string
  origin?: string
  active: boolean
  visible: boolean
  loading?: boolean
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface BrowserSelection {
  mode: BrowserSelectionMode
  targetId?: string
  tabId?: string
}

export interface BrowserExecutionScope {
  sessionId?: string
  companyId?: string
  projectId?: string
  taskId?: string
  runId?: string
}

export interface BrowserTabLease {
  id: string
  ownerId: string
  targetId: string
  profileId: string
  tabId: string
  scope?: BrowserExecutionScope
  acquiredAt: number
}

export type BrowserNormalizedAction =
  | 'browser.read'
  | 'browser.navigate'
  | 'browser.interact'
  | 'browser.history'
  | 'browser.extension.manage'
  | 'credential.use'
  | 'file.download'
  | 'file.upload'
  | 'external.publish'
  | 'production.deploy'
  | 'money.spend'
  | 'data.destructive'

export interface BrowserActionEnvelope {
  id: string
  action: BrowserNormalizedAction
  operation: string
  targetId: string
  profileId: string
  tabId?: string
  origin?: string
  scope?: BrowserExecutionScope
  destructive?: boolean
  externality?: 'internal' | 'external'
  createdAt: number
}

export interface BrowserApprovalRequest {
  id: string
  action: BrowserNormalizedAction
  operation: string
  targetId: string
  tabId?: string
  origin?: string
  companyId: string
  projectId: string
  taskId?: string
  runId: string
  sessionId: string
  createdAt: number
  expiresAt: number
}

export interface BrowserActionReceipt {
  id: string
  actionId: string
  action: BrowserNormalizedAction
  operation: string
  targetId: string
  profileId: string
  tabId?: string
  origin?: string
  scope?: BrowserExecutionScope
  decision: 'allow' | 'deny' | 'ask-allowed' | 'ask-rejected' | 'manual'
  success: boolean
  error?: string
  createdAt: number
  completedAt: number
}

export interface BrowserDownloadRecord {
  id: string
  targetId: string
  tabId?: string
  url: string
  origin?: string
  filename: string
  path?: string
  receivedBytes: number
  totalBytes: number
  state: 'starting' | 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  startedAt: number
  completedAt?: number
}

export interface BrowserHistoryEntry {
  id: string
  targetId: string
  tabId: string
  url: string
  title: string
  visitedAt: number
}

export interface BrowserExtensionRecord {
  id: string
  name: string
  version: string
  path: string
  enabled: boolean
  status: 'compatible' | 'limited' | 'unsupported' | 'error'
  permissions: string[]
  manifestVersion?: number
  error?: string
  installedAt: number
}

export interface BrowserCredentialSummary {
  id: string
  origin: string
  username: string
  label?: string
  createdAt: number
  updatedAt: number
}

export interface BrowserSiteToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema?: unknown
  origin?: string
  annotations?: {
    readOnlyHint?: boolean
    consequentialHint?: boolean
    untrustedContentHint?: boolean
  }
}

export interface BrowserPlatformState {
  targets: BrowserTargetDescriptor[]
  tabs: BrowserTabDescriptor[]
  selection: BrowserSelection
  leases: BrowserTabLease[]
  downloads: BrowserDownloadRecord[]
  extensions: BrowserExtensionRecord[]
  credentials: BrowserCredentialSummary[]
  approvals: BrowserApprovalRequest[]
  receipts: BrowserActionReceipt[]
}

export interface BrowserPlatformDesktopApi {
  state(): Promise<BrowserPlatformState>
  select(selection: BrowserSelection): Promise<BrowserPlatformState>
  createTab(targetId?: string, url?: string): Promise<BrowserTabDescriptor>
  activateTab(targetId: string, tabId: string): Promise<BrowserTabDescriptor>
  closeTab(targetId: string, tabId: string): Promise<boolean>
  history(targetId?: string): Promise<BrowserHistoryEntry[]>
  clearBrowserData(input: { targetId?: string; origin?: string; history?: boolean }): Promise<void>
  cancelDownload(downloadId: string): Promise<boolean>
  installExtension(): Promise<BrowserExtensionRecord | null>
  setExtensionEnabled(extensionId: string, enabled: boolean): Promise<BrowserExtensionRecord[]>
  removeExtension(extensionId: string): Promise<BrowserExtensionRecord[]>
  saveCredential(input: { origin: string; username: string; password: string; label?: string }): Promise<BrowserCredentialSummary>
  removeCredential(credentialId: string): Promise<boolean>
  resolveApproval(approvalId: string, allowed: boolean): Promise<boolean>
  onChanged(listener: (state: BrowserPlatformState) => void): () => void
}

export const BROWSER_PLATFORM_IPC = {
  state: 'browser-platform:state',
  select: 'browser-platform:select',
  createTab: 'browser-platform:create-tab',
  activateTab: 'browser-platform:activate-tab',
  closeTab: 'browser-platform:close-tab',
  history: 'browser-platform:history',
  clearData: 'browser-platform:clear-data',
  cancelDownload: 'browser-platform:cancel-download',
  installExtension: 'browser-platform:install-extension',
  extensionEnabled: 'browser-platform:extension-enabled',
  removeExtension: 'browser-platform:remove-extension',
  saveCredential: 'browser-platform:save-credential',
  removeCredential: 'browser-platform:remove-credential',
  resolveApproval: 'browser-platform:resolve-approval',
  changedEvent: 'browser-platform:changed-event',
} as const
