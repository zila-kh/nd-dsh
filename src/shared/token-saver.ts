export type TokenSaverMode = 'off' | 'automatic' | 'advanced'

export type TokenSaverOptimizerId = 'nd-native' | 'rtk' | 'caveman'
export type TokenSaverExternalAppId = 'codex' | 'antigravity'
export type TokenSaverAccountId = 'codex' | 'antigravity'

export interface TokenSaverExternalAppState {
  id: TokenSaverExternalAppId
  name: string
  detected: boolean
  supported: boolean
  enabled: boolean
  managed: boolean
  support: 'full' | 'limited' | 'unsupported'
  detail?: string
}

export interface TokenSaverAccountState {
  id: TokenSaverAccountId
  name: string
  kind: 'native' | 'oauth'
  available: boolean
  connectable: boolean
  connected: boolean
  email?: string
  expiresAt?: number
  projectId?: string
  detail?: string
}

export interface TokenSaverSettings {
  version: 1
  /** Built-in ND optimization. Independent from external app integration. */
  ndEnabled: boolean
  mode: TokenSaverMode
  /** External integration is explicitly opt-in and defaults false. */
  externalEnabled: boolean
  externalApps: Partial<Record<TokenSaverExternalAppId, boolean>>
  /** Safety switch: fall back to original content when an optimizer fails. */
  qualityProtection: boolean
}

export interface TokenSaverCounters {
  originalChars: number
  optimizedChars: number
  avoidedChars: number
  operations: number
  fallbacks: number
}

export interface TokenSaverInstallerState {
  supported: boolean
  installed: boolean
  version?: string
  codexManaged: boolean
  detail?: string
}

export interface TokenSaverState {
  settings: TokenSaverSettings
  counters: TokenSaverCounters
  externalApps: TokenSaverExternalAppState[]
  accounts: TokenSaverAccountState[]
  installer: TokenSaverInstallerState
  optimizers: Array<{
    id: TokenSaverOptimizerId
    available: boolean
    detail?: string
  }>
}

export interface TokenSaverOptimization {
  text: string
  originalChars: number
  optimizedChars: number
  avoidedChars: number
  optimizer: TokenSaverOptimizerId
  changed: boolean
  fallback: boolean
  /** Local ND recovery reference for lossy generic/tool-output compaction. */
  recoveryRef?: string
}

export const TOKEN_SAVER_IPC = {
  state: 'token-saver:state',
  updateSettings: 'token-saver:update-settings',
  resetCounters: 'token-saver:reset-counters',
  detectExternalApps: 'token-saver:detect-external-apps',
  runDemo: 'token-saver:run-demo',
  connectAccount: 'token-saver:connect-account',
  disconnectAccount: 'token-saver:disconnect-account',
  refreshAccounts: 'token-saver:refresh-accounts',
  changedEvent: 'token-saver:changed',
} as const

export interface TokenSaverDesktopApi {
  state(): Promise<TokenSaverState>
  updateSettings(settings: TokenSaverSettings): Promise<TokenSaverState>
  resetCounters(): Promise<TokenSaverState>
  detectExternalApps(): Promise<TokenSaverState>
  runDemo(): Promise<TokenSaverOptimization>
  connectAccount(id: TokenSaverAccountId): Promise<TokenSaverState>
  disconnectAccount(id: TokenSaverAccountId): Promise<TokenSaverState>
  refreshAccounts(): Promise<TokenSaverState>
  onChanged(listener: (state: TokenSaverState) => void): () => void
}

export function defaultTokenSaverSettings(): TokenSaverSettings {
  return {
    version: 1,
    ndEnabled: true,
    mode: 'automatic',
    externalEnabled: false,
    externalApps: {},
    qualityProtection: true,
  }
}

export function emptyTokenSaverCounters(): TokenSaverCounters {
  return {
    originalChars: 0,
    optimizedChars: 0,
    avoidedChars: 0,
    operations: 0,
    fallbacks: 0,
  }
}
