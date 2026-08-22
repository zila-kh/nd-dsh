import { contextBridge, ipcRenderer } from 'electron'
import { ND_PENCIL_HOST_IPC } from '../shared/design.js'

interface NdPencilHostApi {
  postMessage(payload: string): void
  onMessage(listener: (payload: string) => void): () => void
}

const api: NdPencilHostApi = {
  postMessage: (payload) => {
    if (typeof payload !== 'string' || payload.length > 16 * 1024 * 1024) return
    ipcRenderer.send(ND_PENCIL_HOST_IPC.pageMessage, payload)
  },
  onMessage: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload === 'string') listener(payload)
    }
    ipcRenderer.on(ND_PENCIL_HOST_IPC.hostMessage, handler)
    return () => ipcRenderer.removeListener(ND_PENCIL_HOST_IPC.hostMessage, handler)
  },
}

contextBridge.exposeInMainWorld('ndPencilHost', api)
