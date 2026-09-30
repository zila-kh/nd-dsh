export interface LocalRuntimeSettings {
  version: 1
  alwaysOn: boolean
  startAtLogin: boolean
}

export interface LocalRuntimeState {
  settings: LocalRuntimeSettings
  startedAt: number
  background: boolean
  startAtLoginSupported: boolean
  startAtLoginApplied: boolean
  lastSchedulerTickAt?: number
  lastHeartbeatTickAt?: number
  lastEventTickAt?: number
}

export interface LocalRuntimeDesktopApi {
  state(): Promise<LocalRuntimeState>
  update(patch: Partial<Pick<LocalRuntimeSettings, 'alwaysOn' | 'startAtLogin'>>): Promise<LocalRuntimeState>
  onChanged(listener: (state: LocalRuntimeState) => void): () => void
}

export const LOCAL_RUNTIME_IPC = {
  state: 'local-runtime:state',
  update: 'local-runtime:update',
  changed: 'local-runtime:changed',
} as const
