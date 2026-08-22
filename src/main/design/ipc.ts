import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { DESIGN_IPC } from '../../shared/design.js'
import type { DesignService } from './design-service.js'

export function registerDesignIpc(window: BrowserWindow, design: DesignService): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, ...args) => {
      assertTrusted(event, window)
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  handle(DESIGN_IPC.state, () => design.state())
  handle(DESIGN_IPC.refresh, () => design.refresh())
  handle(DESIGN_IPC.previewHtml, (_event, value) => design.previewHtml(asPath(value)))
  handle(DESIGN_IPC.stopPreview, () => design.stopPreview())

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrusted(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected design IPC from an untrusted renderer frame')
  }
}

function asPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) throw new Error('Template path must be a short non-empty string')
  return value.trim()
}
