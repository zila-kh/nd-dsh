import { contextBridge, ipcRenderer } from 'electron'
import { DESIGN_IPC, type DesignDesktopApi } from '../shared/design.js'

const api: DesignDesktopApi = {
  state: () => ipcRenderer.invoke(DESIGN_IPC.state),
  refresh: () => ipcRenderer.invoke(DESIGN_IPC.refresh),
  previewHtml: (path) => ipcRenderer.invoke(DESIGN_IPC.previewHtml, path),
  startDevPreview: () => ipcRenderer.invoke(DESIGN_IPC.startDevPreview),
  stopPreview: () => ipcRenderer.invoke(DESIGN_IPC.stopPreview),
  freeformState: () => ipcRenderer.invoke(DESIGN_IPC.freeformState),
  freeformSetBounds: (bounds) => ipcRenderer.invoke(DESIGN_IPC.freeformSetBounds, bounds),
  freeformSetVisible: (visible) => ipcRenderer.invoke(DESIGN_IPC.freeformSetVisible, visible),
  freeformOpen: (path) => ipcRenderer.invoke(DESIGN_IPC.freeformOpen, path),
  freeformCreate: (path) => ipcRenderer.invoke(DESIGN_IPC.freeformCreate, path),
  freeformSave: () => ipcRenderer.invoke(DESIGN_IPC.freeformSave),
  freeformClose: () => ipcRenderer.invoke(DESIGN_IPC.freeformClose),
  onFreeformState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
    ipcRenderer.on(DESIGN_IPC.freeformChanged, handler)
    return () => ipcRenderer.removeListener(DESIGN_IPC.freeformChanged, handler)
  },
}

contextBridge.exposeInMainWorld('ndDshDesign', api)
