export const ND_CORE_PROTOCOL_VERSION = 1
export const ND_CORE_MAX_FRAME_BYTES = 8 * 1024 * 1024

export interface NdCoreHealth {
  protocolVersion: number
  binaryVersion: string
  platform: string
  arch: string
  capabilities: string[]
  processCount: number
  terminalCount: number
}

export interface NdCoreError {
  code: string
  message: string
}

export interface NdCoreEventFrame<T = unknown> {
  version: number
  kind: 'event'
  event: string
  resourceId?: string
  seq?: number
  priority: string
  data: T
}

export interface NdCoreResponseFrame<T = unknown> {
  version: number
  kind: 'response'
  id: string
  result?: T
  error?: NdCoreError
}
