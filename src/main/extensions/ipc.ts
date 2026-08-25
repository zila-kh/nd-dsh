import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { EXTENSIONS_IPC, type AgentExtensionManifest } from '../../shared/extensions.js'
import type { ExtensionDemoService } from './extension-demo-service.js'
import type { ExtensionRouter } from './extension-router.js'
import type { ExtensionStore } from './extension-store.js'

export function registerExtensionIpc(
  window: BrowserWindow,
  store: ExtensionStore,
  router: ExtensionRouter,
  demos: ExtensionDemoService,
): () => void {
  const channels = Object.values(EXTENSIONS_IPC).filter((channel) => channel !== EXTENSIONS_IPC.changedEvent)
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, window)
      return listener(event, ...args)
    })
  }

  handle(EXTENSIONS_IPC.list, () => store.list())
  handle(EXTENSIONS_IPC.save, (_event, value) => store.save(asManifest(value)))
  handle(EXTENSIONS_IPC.remove, (_event, id) => store.remove(asString(id, 'Extension id', 128)))
  handle(EXTENSIONS_IPC.resetDemos, () => store.resetDemos())
  handle(EXTENSIONS_IPC.preview, (_event, id) => router.preview(asString(id, 'Extension id', 128)))
  handle(EXTENSIONS_IPC.runDemo, (_event, id, engineId, providerId) => demos.run(
    asString(id, 'Extension id', 128),
    optionalString(engineId, 256),
    optionalString(providerId, 256),
  ))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected extension IPC from an untrusted renderer frame')
  }
}

function asManifest(value: unknown): AgentExtensionManifest {
  if (!value || typeof value !== 'object') throw new Error('Extension manifest is required')
  return value as AgentExtensionManifest
}

function asString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`)
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters`)
  return value.trim()
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return asString(value, 'Route id', maxLength)
}
