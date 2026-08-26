export type TokenSaverMode = 'off' | 'automatic' | 'advanced'

export type TokenSaverOptimizerId = 'nd-native' | 'rtk' | 'caveman'

export interface TokenSaverExternalAppState {
  id: string
  name: string
  detected: boolean
  supported: boolean
  enabled: boolean
  support: 'full' | 'limited' | 'unsupported'
  detail?: string
}

export interface TokenSaverSettings {
  version: 1
  /** Built-in ND optimization. Independent from external app integration. */
  ndEnabled: boolean
  mode: TokenSaverMode
  /** External integration is explicitly opt-in and defaults false. */
  externalEnabled: boolean
  externalApps: Record<string, boolean>
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

export interface TokenSaverState {
  settings: TokenSaverSettings
  counters: TokenSaverCounters
  externalApps: TokenSaverExternalAppState[]
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
}

export const TOKEN_SAVER_IPC = {
  state: 'token-saver:state',
  updateSettings: 'token-saver:update-settings',
  resetCounters: 'token-saver:reset-counters',
  detectExternalApps: 'token-saver:detect-external-apps',
  changedEvent: 'token-saver:changed',
} as const

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
