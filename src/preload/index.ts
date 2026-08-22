import './organization.js'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopApi } from '../shared/contracts.js'

const api: DesktopApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  providers: {
    list: () => ipcRenderer.invoke(IPC.providersList),
    save: (providers) => ipcRenderer.invoke(IPC.providersSave, providers),
    setApiKey: (providerId, apiKey) => ipcRenderer.invoke(IPC.providersSetApiKey, providerId, apiKey),
    clearApiKey: (providerId) => ipcRenderer.invoke(IPC.providersClearApiKey, providerId),
    ping: (providerId, force) => ipcRenderer.invoke(IPC.providersPing, providerId, force),
  },
  engines: {
    list: () => ipcRenderer.invoke(IPC.enginesList),
    assignments: () => ipcRenderer.invoke(IPC.enginesAssignments),
    assign: (agentId, engineId) => ipcRenderer.invoke(IPC.enginesAssign, agentId, engineId),
  },
  capture: {
    inspectApp: (copyToClipboard) => ipcRenderer.invoke(IPC.captureInspectApp, copyToClipboard),
    inspectElement: () => ipcRenderer.invoke(IPC.captureInspectElement),
    stageElement: (element, targetTitle) => ipcRenderer.invoke(IPC.captureStageElement, element, targetTitle),
    elementAttachments: () => ipcRenderer.invoke(IPC.captureElementAttachments),
    removeElement: (id) => ipcRenderer.invoke(IPC.captureRemoveElement, id),
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
    setInspectMode: (enabled) => ipcRenderer.invoke(IPC.browserSetInspectMode, enabled),
    clearSelection: () => ipcRenderer.invoke(IPC.browserClearSelection),
    setAnnotationMode: (enabled) => ipcRenderer.invoke(IPC.browserSetAnnotationMode, enabled),
    clearAnnotation: () => ipcRenderer.invoke(IPC.browserClearAnnotation),
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
    setRoot: (path) => ipcRenderer.invoke(IPC.workspaceSetRoot, path),
    list: (relativePath) => ipcRenderer.invoke(IPC.workspaceList, relativePath),
    read: (relativePath) => ipcRenderer.invoke(IPC.workspaceRead, relativePath),
    suggest: (query) => ipcRenderer.invoke(IPC.workspaceSuggest, query),
  },
  harness: {
    status: () => ipcRenderer.invoke(IPC.harnessStatus),
    run: (prompt, options) => ipcRenderer.invoke(IPC.harnessRun, prompt, options),
    stop: () => ipcRenderer.invoke(IPC.harnessStop),
    getPermissionMode: () => ipcRenderer.invoke(IPC.harnessPermissionGet),
    setPermissionMode: (mode) => ipcRenderer.invoke(IPC.harnessPermissionSet, mode),
    onStatus: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on(IPC.harnessStatusEvent, handler)
      return () => ipcRenderer.removeListener(IPC.harnessStatusEvent, handler)
    },
  },
  dsh: {
    rpc: (method, payload) => ipcRenderer.invoke(IPC.dshRpc, method, payload),
    respond: (rpcId, value) => ipcRenderer.invoke(IPC.dshRespond, rpcId, value),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, frame: Parameters<typeof listener>[0]) => listener(frame)
      ipcRenderer.on(IPC.dshEvent, handler)
      return () => ipcRenderer.removeListener(IPC.dshEvent, handler)
    },
  },
  surface: {
    state: () => ipcRenderer.invoke(IPC.surfaceState),
    set: (surface) => ipcRenderer.invoke(IPC.surfaceSet, surface),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.surfaceChangedEvent, handler)
      return () => ipcRenderer.removeListener(IPC.surfaceChangedEvent, handler)
    },
  },
  dshView: {
    setBounds: (bounds) => ipcRenderer.invoke(IPC.dshViewSetBounds, bounds),
    setVisible: (visible) => ipcRenderer.invoke(IPC.dshViewSetVisible, visible),
    reload: () => ipcRenderer.invoke(IPC.dshViewReload),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.dshViewStateEvent, handler)
      return () => ipcRenderer.removeListener(IPC.dshViewStateEvent, handler)
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
