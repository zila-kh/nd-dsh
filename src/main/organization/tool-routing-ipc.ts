import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { TOOL_ROUTING_IPC, type ToolRoutingSettings } from '../../shared/tool-routing.js'
import { ToolRoutingService } from './tool-routing-service.js'
import type { DecisionSupportService } from './decision-support.js'
import type { CoreClient } from '../core/core-client.js'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

export function registerToolRoutingIpc(
  window: BrowserWindow,
  decisionSupport?: DecisionSupportService,
  core?: Pick<CoreClient, 'request'>,
): { service: ToolRoutingService; dispose: () => void } {
  const channels: string[] = []
  const root = join(app.getPath('userData'), 'tool-routing')
  const service = new ToolRoutingService(join(root, 'settings.json'), decisionSupport, core)

  const handle = (channel: string, listener: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Rejected Tool Routing IPC from untrusted renderer')
      }
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  handle(TOOL_ROUTING_IPC.state, () => service.state())
  handle(TOOL_ROUTING_IPC.updateSettings, (_event, settings) => service.updateSettings(settings as ToolRoutingSettings))
  handle(TOOL_ROUTING_IPC.routeTools, (_event, taskText) => service.routeTools({ taskTitle: String(taskText) }))

  return {
    service,
    dispose: () => {
      for (const channel of channels) ipcMain.removeHandler(channel)
    },
  }
}
