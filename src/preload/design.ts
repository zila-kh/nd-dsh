import { contextBridge, ipcRenderer } from 'electron'
import { DESIGN_IPC, type DesignDesktopApi } from '../shared/design.js'

const api: DesignDesktopApi = {
  state: () => ipcRenderer.invoke(DESIGN_IPC.state),
  refresh: () => ipcRenderer.invoke(DESIGN_IPC.refresh),
  previewHtml: (path) => ipcRenderer.invoke(DESIGN_IPC.previewHtml, path),
  startDevPreview: () => ipcRenderer.invoke(DESIGN_IPC.startDevPreview),
  stopPreview: () => ipcRenderer.invoke(DESIGN_IPC.stopPreview),
}

contextBridge.exposeInMainWorld('ndDshDesign', api)
