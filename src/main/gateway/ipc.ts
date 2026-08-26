import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ND_GATEWAY_IPC, type NdGatewayAppId, type NdGatewayConnectInput, type NdGatewayMode } from '../../shared/gateway.js'
import type { ProviderStore } from '../providers.js'
import type { TokenSaverService } from '../token-saver/token-saver-service.js'
import { NdGatewayService } from './gateway-service.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

export function registerNdGatewayIpc(window: BrowserWindow, providers: () => ProviderStore, tokenSaver: TokenSaverService): () => void {
  const service = new NdGatewayService(providers, tokenSaver)
  const channels: string[] = []
  const handle = (channel: string, listener: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Rejected ND Gateway IPC from untrusted renderer')
      }
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  service.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ND_GATEWAY_IPC.changedEvent, state)
  })
  handle(ND_GATEWAY_IPC.state, () => service.state())
  handle(ND_GATEWAY_IPC.connect, (_event, value) => service.connect(readConnectInput(value)))
  handle(ND_GATEWAY_IPC.disconnect, (_event, appId) => service.disconnect(readAppId(appId)))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    service.setOnChanged(undefined)
    void service.close()
  }
}

function readConnectInput(value: unknown): NdGatewayConnectInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid ND Gateway connection request')
  const row = value as Record<string, unknown>
  return {
    appId: readAppId(row.appId),
    mode: readMode(row.mode),
    providerId: text(row.providerId, 'Provider id'),
  }
}

function readAppId(value: unknown): NdGatewayAppId {
  if (value === 'chatgpt') return value
  throw new Error('Unsupported external app')
}

function readMode(value: unknown): NdGatewayMode {
  if (value === 'llm-only' || value === 'nd-enhanced' || value === 'full-nd') return value
  throw new Error('Unsupported ND Gateway mode')
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const result = value.trim()
  if (!result || result.length > 256) throw new Error(`${label} is invalid`)
  return result
}
