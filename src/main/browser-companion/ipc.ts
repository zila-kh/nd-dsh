import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  BROWSER_COMPANION_IPC,
  type BrowserCompanionLeaseScope,
} from '../../shared/browser-companion.js'
import type { BrowserCompanionService } from './browser-companion-service.js'

export function registerBrowserCompanionIpc(
  window: BrowserWindow,
  service: BrowserCompanionService,
): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Untrusted browser companion IPC sender')
      }
      return listener(...args)
    })
    channels.push(channel)
  }

  handle(BROWSER_COMPANION_IPC.state, () => service.state())
  handle(BROWSER_COMPANION_IPC.acquireLease, (connectionId, tabId, ownerId, scope) =>
    service.acquireLease(
      stringArg(connectionId, 'connection id'),
      integerArg(tabId, 'tab id'),
      stringArg(ownerId, 'owner id'),
      scopeArg(scope),
    ))
  handle(BROWSER_COMPANION_IPC.releaseLease, (leaseId) =>
    service.releaseLease(stringArg(leaseId, 'lease id')))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function stringArg(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`Invalid ${label}`)
  return value.trim()
}

function integerArg(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`Invalid ${label}`)
  return value
}

function scopeArg(value: unknown): BrowserCompanionLeaseScope | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser lease scope')
  return value as BrowserCompanionLeaseScope
}
