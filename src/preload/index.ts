import './design.js'
import './organization.js'
import { contextBridge, ipcRenderer } from 'electron'
import { CAPABILITIES_IPC, type CapabilityAssignmentSnapshot, type CapabilityKind, type CapabilitySubjectType } from '../shared/capabilities.js'
import { IPC, type DesktopApi, type ModelProvider } from '../shared/contracts.js'

const api: DesktopApi = {
  app: { info: () => ipcRenderer.invoke(IPC.appInfo) },
  capabilities: {
    providers: () => ipcRenderer.invoke(CAPABILITIES_IPC.providers),
    assignments: () => ipcRenderer.invoke(CAPABILITIES_IPC.assignments),
    assign: (subjectType: CapabilitySubjectType, subjectId: string, kind: CapabilityKind, providerId: string) =>
      ipcRenderer.invoke(CAPABILITIES_IPC.assign, subjectType, subjectId, kind, providerId) as Promise<CapabilityAssignmentSnapshot>,
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, assignments: CapabilityAssignmentSnapshot) => listener(assignments)
      ipcRenderer.on(CAPABILITIES_IPC.changedEvent, handler)
      return () => ipcRenderer.removeListener(CAPABILITIES_IPC.changedEvent, handler)
    },
    statuses: () => ipcRenderer.invoke(CAPABILITIES_IPC.statuses),
    checkSetup: (providerId: string) => ipcRenderer.invoke(CAPABILITIES_IPC.checkSetup, providerId),
    setup: (providerId: string, values: Record<string, string>) => ipcRenderer.invoke(CAPABILITIES_IPC.setup, providerId, values),
    verify: (providerId: string) => ipcRenderer.invoke(CAPABILITIES_IPC.verify, providerId),
    setEnabled: (providerId: string, enabled: boolean) => ipcRenderer.invoke(CAPABILITIES_IPC.setEnabled, providerId, enabled),
    onStatusChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, statuses: Parameters<typeof listener>[0]) => listener(statuses)
      ipcRenderer.on(CAPABILITIES_IPC.statusChangedEvent, handler)
      return () => ipcRenderer.removeListener(CAPABILITIES_IPC.statusChangedEvent, handler)
    },
  },
  window: {
    setFloatMode: (enabled) => ipcRenderer.invoke(IPC.windowSetFloatMode, enabled),
    resizeFloatWindow: (width, height) => ipcRenderer.invoke(IPC.windowResizeFloatWindow, width, height),
    moveFloatWindow: (deltaX, deltaY) => ipcRenderer.invoke(IPC.windowMoveFloatWindow, deltaX, deltaY),
    onFloatMode: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => listener(enabled)
      ipcRenderer.on(IPC.windowFloatModeEvent, handler)
      return () => ipcRenderer.removeListener(IPC.windowFloatModeEvent, handler)
    },
  },
  providers: {
    list: () => ipcRenderer.invoke(IPC.providersList),
    save: (providers) => ipcRenderer.invoke(IPC.providersSave, providers),
    setApiKey: (providerId, apiKey) => ipcRenderer.invoke(IPC.providersSetApiKey, providerId, apiKey),
    clearApiKey: (providerId) => ipcRenderer.invoke(IPC.providersClearApiKey, providerId),
    ping: (providerId, force) => ipcRenderer.invoke(IPC.providersPing, providerId, force),
    testCompletion: (providerId) => ipcRenderer.invoke(IPC.providersTestCompletion, providerId),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, providers: ModelProvider[]) => listener(providers)
      ipcRenderer.on(IPC.providersChangedEvent, handler)
      return () => ipcRenderer.removeListener(IPC.providersChangedEvent, handler)
    },
  },
  engines: {
    list: () => ipcRenderer.invoke(IPC.enginesList),
    assignments: () => ipcRenderer.invoke(IPC.enginesAssignments),
    assign: (agentId, engineId) => ipcRenderer.invoke(IPC.enginesAssign, agentId, engineId),
    sessions: () => ipcRenderer.invoke(IPC.enginesSessions),
    transcript: (sessionId) => ipcRenderer.invoke(IPC.enginesTranscript, sessionId),
  },
  sessions: {
    setArchived: (sessionId, archived) => ipcRenderer.invoke(IPC.sessionsSetArchived, sessionId, archived),
  },
  capture: {
    inspectApp: (copyToClipboard, scope) => ipcRenderer.invoke(IPC.captureInspectApp, copyToClipboard, scope),
    inspectElement: (scope) => ipcRenderer.invoke(IPC.captureInspectElement, scope),
    stageElement: (element, targetTitle, pickId) => ipcRenderer.invoke(IPC.captureStageElement, element, targetTitle, pickId),
    elementAttachments: () => ipcRenderer.invoke(IPC.captureElementAttachments),
    removeElement: (id) => ipcRenderer.invoke(IPC.captureRemoveElement, id),
    copyElementContext: (pickId) => ipcRenderer.invoke(IPC.captureCopyElementContext, pickId),
    copyElementShot: (pickId) => ipcRenderer.invoke(IPC.captureCopyElementShot, pickId),
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
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.workspaceStateEvent, handler)
      return () => ipcRenderer.removeListener(IPC.workspaceStateEvent, handler)
    },
    registry: () => ipcRenderer.invoke(IPC.workspaceRegistry),
    addSaved: () => ipcRenderer.invoke(IPC.workspaceAddSaved),
    removeSaved: (id) => ipcRenderer.invoke(IPC.workspaceRemoveSaved, id),
    openSaved: (id) => ipcRenderer.invoke(IPC.workspaceOpenSaved, id),
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
  git: {
    state: () => ipcRenderer.invoke(IPC.gitState),
    refresh: () => ipcRenderer.invoke(IPC.gitRefresh),
    stage: (relativePaths) => ipcRenderer.invoke(IPC.gitStage, relativePaths),
    unstage: (relativePaths) => ipcRenderer.invoke(IPC.gitUnstage, relativePaths),
    discard: (relativePaths) => ipcRenderer.invoke(IPC.gitDiscard, relativePaths),
    commit: (message) => ipcRenderer.invoke(IPC.gitCommit, message),
    diff: (relativePath, staged) => ipcRenderer.invoke(IPC.gitDiff, relativePath, staged),
    checkout: (branch) => ipcRenderer.invoke(IPC.gitCheckout, branch),
    createBranch: (name) => ipcRenderer.invoke(IPC.gitCreateBranch, name),
    push: () => ipcRenderer.invoke(IPC.gitPush),
    pull: () => ipcRenderer.invoke(IPC.gitPull),
    fetch: () => ipcRenderer.invoke(IPC.gitFetch),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.gitStateEvent, handler)
      return () => ipcRenderer.removeListener(IPC.gitStateEvent, handler)
    },
  },
  qa: {
    state: () => ipcRenderer.invoke(IPC.qaState),
    run: (suite) => ipcRenderer.invoke(IPC.qaRun, suite),
    stop: () => ipcRenderer.invoke(IPC.qaStop),
    onState: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC.qaStateEvent, handler)
      return () => ipcRenderer.removeListener(IPC.qaStateEvent, handler)
    },
    onOutput: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: Parameters<typeof listener>[0]) => listener(chunk)
      ipcRenderer.on(IPC.qaOutputEvent, handler)
      return () => ipcRenderer.removeListener(IPC.qaOutputEvent, handler)
    },
  },
}

contextBridge.exposeInMainWorld('ndDsh', api)
