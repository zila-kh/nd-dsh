import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  BROWSER_PLATFORM_IPC,
  type BrowserSelection,
} from '../../shared/browser-platform.js'
import type { BrowserPlatformService } from './browser-platform-service.js'

export function registerBrowserPlatformIpc(
  window: BrowserWindow,
  service: BrowserPlatformService,
): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedSender(event, window)
      return listener(...args)
    })
    channels.push(channel)
  }

  handle(BROWSER_PLATFORM_IPC.state, () => service.state())
  handle(BROWSER_PLATFORM_IPC.select, (value) => service.select(asSelection(value)))
  handle(BROWSER_PLATFORM_IPC.createTab, (targetId, url) =>
    service.createTab(optionalString(targetId, 512), optionalString(url, 16_384)))
  handle(BROWSER_PLATFORM_IPC.activateTab, (targetId, tabId) =>
    service.activateTab(asString(targetId, 'Browser target id', 512), asString(tabId, 'Browser tab id', 512)))
  handle(BROWSER_PLATFORM_IPC.closeTab, (targetId, tabId) =>
    service.closeTab(asString(targetId, 'Browser target id', 512), asString(tabId, 'Browser tab id', 512)))
  handle(BROWSER_PLATFORM_IPC.history, (targetId) => service.history(optionalString(targetId, 512)))
  handle(BROWSER_PLATFORM_IPC.clearData, (value) => {
    const input = object(value, 'Browser data clear request')
    return service.clearBrowserData({
      ...(optionalString(input.targetId, 512) ? { targetId: optionalString(input.targetId, 512) } : {}),
      ...(optionalString(input.origin, 4_096) ? { origin: optionalString(input.origin, 4_096) } : {}),
      ...(input.history === undefined ? {} : { history: Boolean(input.history) }),
    })
  })
  handle(BROWSER_PLATFORM_IPC.cancelDownload, (downloadId) =>
    service.cancelDownload(asString(downloadId, 'Download id', 512)))
  handle(BROWSER_PLATFORM_IPC.installExtension, async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Load unpacked browser extension',
      properties: ['openDirectory'],
    })
    const path = result.filePaths[0]
    return result.canceled || !path ? null : service.installExtension(path)
  })
  handle(BROWSER_PLATFORM_IPC.extensionEnabled, (extensionId, enabled) =>
    service.setExtensionEnabled(asString(extensionId, 'Extension id', 1_024), Boolean(enabled)))
  handle(BROWSER_PLATFORM_IPC.removeExtension, (extensionId) =>
    service.removeExtension(asString(extensionId, 'Extension id', 1_024)))
  handle(BROWSER_PLATFORM_IPC.saveCredential, (value) => {
    const input = object(value, 'Browser credential')
    return service.saveCredential({
      origin: asString(input.origin, 'Credential origin', 4_096),
      username: asString(input.username, 'Credential username', 512),
      password: asString(input.password, 'Credential password', 32_768, false),
      ...(optionalString(input.label, 256) ? { label: optionalString(input.label, 256) } : {}),
    })
  })
  handle(BROWSER_PLATFORM_IPC.removeCredential, (credentialId) =>
    service.removeCredential(asString(credentialId, 'Credential id', 512)))
  handle(BROWSER_PLATFORM_IPC.resolveApproval, (approvalId, allowed) =>
    service.resolveApproval(asString(approvalId, 'Browser approval id', 512), Boolean(allowed)))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected browser-platform IPC from an untrusted renderer frame')
  }
}

function asSelection(value: unknown): BrowserSelection {
  const input = object(value, 'Browser selection')
  if (input.mode !== 'auto' && input.mode !== 'target' && input.mode !== 'tab') {
    throw new Error('Browser selection mode must be auto, target, or tab')
  }
  return {
    mode: input.mode,
    ...(optionalString(input.targetId, 512) ? { targetId: optionalString(input.targetId, 512) } : {}),
    ...(optionalString(input.tabId, 512) ? { tabId: optionalString(input.tabId, 512) } : {}),
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function optionalString(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return asString(value, 'Value', max)
}

function asString(value: unknown, label: string, max: number, trim = true): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const result = trim ? value.trim() : value
  if (!result || result.length > max) throw new Error(`${label} is invalid`)
  return result
}
