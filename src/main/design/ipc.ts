import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { BrowserBounds } from '../../shared/contracts.js'
import { DESIGN_IPC } from '../../shared/design.js'
import type { DesignService } from './design-service.js'
import type { NdPencilController } from './openpencil-controller.js'

export function registerDesignIpc(window: BrowserWindow, design: DesignService, ndPencil: NdPencilController): () => void {
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
  handle(DESIGN_IPC.previewHtml, (_event, value) => design.previewHtml(asPath(value, 'Template path')))
  handle(DESIGN_IPC.startDevPreview, () => design.startDevPreview())
  handle(DESIGN_IPC.stopPreview, () => design.stopPreview())
  handle(DESIGN_IPC.freeformState, () => ndPencil.state())
  handle(DESIGN_IPC.freeformSetBounds, (_event, value) => ndPencil.setBounds(asBounds(value)))
  handle(DESIGN_IPC.freeformSetVisible, (_event, value) => ndPencil.setVisible(Boolean(value)))
  handle(DESIGN_IPC.freeformOpen, (_event, value) => ndPencil.open(asPath(value, 'Freeform path')))
  handle(DESIGN_IPC.freeformCreate, (_event, value) => ndPencil.create(asPath(value, 'Freeform path')))
  handle(DESIGN_IPC.freeformSave, () => ndPencil.save())
  handle(DESIGN_IPC.freeformClose, () => ndPencil.close())

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrusted(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected design IPC from an untrusted renderer frame')
  }
}

function asPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) throw new Error(`${label} must be a short non-empty string`)
  return value.trim()
}

function asBounds(value: unknown): BrowserBounds {
  if (!value || typeof value !== 'object') throw new Error('Freeform bounds are required')
  const record = value as Record<string, unknown>
  const read = (key: keyof BrowserBounds): number => {
    const number = Number(record[key])
    if (!Number.isFinite(number) || number < 0 || number > 100_000) throw new Error(`${key} must be a finite non-negative number`)
    return number
  }
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}
