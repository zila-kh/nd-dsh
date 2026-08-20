import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { BrowserBounds } from '../shared/contracts.js'
import { IPC } from '../shared/contracts.js'
import { projectRoot } from './app-paths.js'
import type { BrowserController } from './browser/browser-controller.js'
import type { HarnessService } from './harness/harness-service.js'
import type { WorkspaceService } from './workspace/workspace-service.js'

interface IpcDependencies {
  window: BrowserWindow
  browser: BrowserController
  harness: HarnessService
  workspace: WorkspaceService
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

export function registerIpc(deps: IpcDependencies): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedSender(event, deps.window)
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    projectRoot: projectRoot(),
  }))

  handle(IPC.browserState, () => deps.browser.state())
  handle(IPC.browserSetBounds, (_event, value) => deps.browser.setBounds(asBounds(value)))
  handle(IPC.browserSetVisible, (_event, visible) => deps.browser.setVisible(Boolean(visible)))
  handle(IPC.browserNavigate, (_event, value) => deps.browser.navigate(asString(value, 'Browser URL', 8_192)))
  handle(IPC.browserBack, () => deps.browser.back())
  handle(IPC.browserForward, () => deps.browser.forward())
  handle(IPC.browserReload, () => deps.browser.reload())
  handle(IPC.browserSnapshot, () => deps.browser.snapshot())

  handle(IPC.workspaceState, () => deps.workspace.state())
  handle(IPC.workspacePick, async () => {
    await deps.harness.stop()
    return deps.workspace.pick()
  })
  handle(IPC.workspaceList, (_event, value) =>
    deps.workspace.list(value === undefined ? '.' : asString(value, 'Workspace path', 4_096)),
  )
  handle(IPC.workspaceRead, (_event, value) =>
    deps.workspace.read(asString(value, 'Workspace file path', 4_096)),
  )

  handle(IPC.harnessStatus, () => deps.harness.status())
  handle(IPC.harnessRun, (_event, value) => deps.harness.run(asString(value, 'Prompt', 100_000)))
  handle(IPC.harnessStop, () => deps.harness.stop())

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected IPC from an untrusted renderer frame')
  }
}

function asBounds(value: unknown): BrowserBounds {
  if (!value || typeof value !== 'object') throw new Error('Browser bounds are required')
  const record = value as Record<string, unknown>
  const read = (key: keyof BrowserBounds): number => {
    const number = Number(record[key])
    if (!Number.isFinite(number) || number < 0 || number > 100_000) {
      throw new Error(`${key} must be a finite non-negative number`)
    }
    return number
  }
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}

function asString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!value.trim()) throw new Error(`${label} cannot be empty`)
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength.toLocaleString()} characters`)
  return value
}
