import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { LOCAL_RUNTIME_IPC } from '../../shared/local-runtime.js'
import type { LocalRuntimeService } from './local-runtime-service.js'

export function registerLocalRuntimeIpc(window: BrowserWindow, runtime: LocalRuntimeService): () => void {
  const handle = (channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Rejected local-runtime IPC from an untrusted renderer frame')
      }
      return listener(...args)
    })
  }

  handle(LOCAL_RUNTIME_IPC.state, () => runtime.state())
  handle(LOCAL_RUNTIME_IPC.update, (value) => {
    if (!value || typeof value !== 'object') throw new Error('Local runtime update must be an object')
    const patch = value as Record<string, unknown>
    return runtime.update({
      ...(typeof patch.alwaysOn === 'boolean' ? { alwaysOn: patch.alwaysOn } : {}),
      ...(typeof patch.startAtLogin === 'boolean' ? { startAtLogin: patch.startAtLogin } : {}),
    })
  })

  runtime.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(LOCAL_RUNTIME_IPC.changed, state)
  })

  return () => {
    runtime.setOnChanged(undefined)
    ipcMain.removeHandler(LOCAL_RUNTIME_IPC.state)
    ipcMain.removeHandler(LOCAL_RUNTIME_IPC.update)
  }
}
