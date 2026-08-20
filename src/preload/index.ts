import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopApi } from '../shared/contracts.js'

const api: DesktopApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
  },
  browser: {
    state: () => ipcRenderer.invoke(IPC.browserState),
    setBounds: (bounds) => ipcRenderer.invoke(IPC.browserSetBounds, bounds),
    setVisible: (visible) => ipcRenderer.invoke(IPC.browserSetVisible, visible),
    navigate: (url) => ipcRenderer.invoke(IPC.browserNavigate, url),
    back: () => ipcRenderer.invoke(IPC.browserBack),
    forward: () => ipcRenderer.invoke(IPC.browserForward),
    reload: () => ipcRenderer.invoke(IPC.browserReload),
    snapshot: () => ipcRenderer.invoke(IPC.browserSnapshot),
    openExternal: (url) => ipcRenderer.invoke(IPC.browserOpenExternal, url),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.browserStateEvent, handler)
      return () => ipcRenderer.removeListener(IPC.browserStateEvent, handler)
    },
  },
  workspace: {
    state: () => ipcRenderer.invoke(IPC.workspaceState),
    pick: () => ipcRenderer.invoke(IPC.workspacePick),
    list: (relativePath) => ipcRenderer.invoke(IPC.workspaceList, relativePath),
    read: (relativePath) => ipcRenderer.invoke(IPC.workspaceRead, relativePath),
  },
  harness: {
    status: () => ipcRenderer.invoke(IPC.harnessStatus),
    run: (prompt) => ipcRenderer.invoke(IPC.harnessRun, prompt),
    stop: () => ipcRenderer.invoke(IPC.harnessStop),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on(IPC.harnessStatusEvent, handler)
      return () => ipcRenderer.removeListener(IPC.harnessStatusEvent, handler)
    },
    onNotification: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, notification: Parameters<typeof listener>[0]) => listener(notification)
      ipcRenderer.on(IPC.harnessNotificationEvent, handler)
      return () => ipcRenderer.removeListener(IPC.harnessNotificationEvent, handler)
    },
  },
  theme: {
    state: () => ipcRenderer.invoke(IPC.themeState),
    set: (mode) => ipcRenderer.invoke(IPC.themeSet, mode),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.themeChangedEvent, handler)
      return () => ipcRenderer.removeListener(IPC.themeChangedEvent, handler)
    },
  },
}

contextBridge.exposeInMainWorld('ndDsh', api)
