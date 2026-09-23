export const BROWSER_COMPANION_PROTOCOL_VERSION = 1
export const BROWSER_COMPANION_NATIVE_HOST = 'com.nddsh.browser_companion'
export const ND_BROWSER_COMPANION_EXTENSION_ID = 'nd-browser-companion'

export type BrowserCompanionBrowser = 'chrome' | 'edge' | 'brave' | 'chromium'

export interface BrowserCompanionConnection {
  id: string
  installationId: string
  browser: BrowserCompanionBrowser
  profileLabel: string
  extensionVersion: string
  connected: boolean
  connectedAt: number
  lastSeenAt: number
}

export interface BrowserCompanionTab {
  id: number
  windowId: number
  title: string
  url: string
  active: boolean
  pinned?: boolean
}

export interface BrowserCompanionLeaseScope {
  companyId?: string
  projectId?: string
  taskId?: string
  runId?: string
  sessionId?: string
}

export interface BrowserTabLease {
  id: string
  connectionId: string
  tabId: number
  ownerId: string
  scope?: BrowserCompanionLeaseScope
  acquiredAt: number
}

export interface BrowserCompanionState {
  connections: BrowserCompanionConnection[]
  leases: BrowserTabLease[]
  discoveryPath: string
}

export const BROWSER_COMPANION_IPC = {
  state: 'browser-companion:state',
  acquireLease: 'browser-companion:acquire-lease',
  releaseLease: 'browser-companion:release-lease',
  changedEvent: 'browser-companion:changed-event',
} as const

export interface BrowserCompanionDesktopApi {
  state(): Promise<BrowserCompanionState>
  acquireLease(connectionId: string, tabId: number, ownerId: string, scope?: BrowserCompanionLeaseScope): Promise<BrowserTabLease>
  releaseLease(leaseId: string): Promise<boolean>
  onChanged(listener: (state: BrowserCompanionState) => void): () => void
}
