export type NdGatewayMode = 'llm-only' | 'nd-enhanced' | 'full-nd'
export type NdGatewayAppId = 'chatgpt' | 'codex'

export interface NdGatewayAppState {
  id: NdGatewayAppId
  name: string
  detected: boolean
  supported: boolean
  connected: boolean
  mode: NdGatewayMode
  providerId?: string
  detail: string
}

export interface NdGatewayState {
  enabled: boolean
  running: boolean
  port?: number
  endpoint?: string
  apps: NdGatewayAppState[]
}

export interface NdGatewayConnectInput {
  appId: NdGatewayAppId
  mode: NdGatewayMode
  providerId: string
}

export interface NdGatewayDesktopApi {
  state(): Promise<NdGatewayState>
  connect(input: NdGatewayConnectInput): Promise<NdGatewayState>
  disconnect(appId: NdGatewayAppId): Promise<NdGatewayState>
  onChanged(listener: (state: NdGatewayState) => void): () => void
}

export const ND_GATEWAY_IPC = {
  state: 'nd-gateway:state',
  connect: 'nd-gateway:connect',
  disconnect: 'nd-gateway:disconnect',
  changedEvent: 'nd-gateway:changed',
} as const
