import { contextBridge, ipcRenderer } from 'electron'
import { LOCAL_RUNTIME_IPC, type LocalRuntimeDesktopApi, type LocalRuntimeState } from '../shared/local-runtime.js'

const api: LocalRuntimeDesktopApi = {
  state: () => ipcRenderer.invoke(LOCAL_RUNTIME_IPC.state),
  update: (patch) => ipcRenderer.invoke(LOCAL_RUNTIME_IPC.update, patch),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: LocalRuntimeState) => listener(state)
    ipcRenderer.on(LOCAL_RUNTIME_IPC.changed, handler)
    return () => ipcRenderer.removeListener(LOCAL_RUNTIME_IPC.changed, handler)
  },
}

contextBridge.exposeInMainWorld('ndDshLocalRuntime', api)
