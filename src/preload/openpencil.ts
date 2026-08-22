import { contextBridge, ipcRenderer } from 'electron'
import { OPENPENCIL_HOST_IPC } from '../shared/design.js'

interface OpenPencilHostApi {
  postMessage(payload: string): void
  onMessage(listener: (payload: string) => void): () => void
}

const api: OpenPencilHostApi = {
  postMessage: (payload) => {
    if (typeof payload !== 'string' || payload.length > 16 * 1024 * 1024) return
    ipcRenderer.send(OPENPENCIL_HOST_IPC.pageMessage, payload)
  },
  onMessage: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload === 'string') listener(payload)
    }
    ipcRenderer.on(OPENPENCIL_HOST_IPC.hostMessage, handler)
    return () => ipcRenderer.removeListener(OPENPENCIL_HOST_IPC.hostMessage, handler)
  },
}

contextBridge.exposeInMainWorld('ndOpenPencilHost', api)
