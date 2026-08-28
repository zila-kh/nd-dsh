import { contextBridge, ipcRenderer } from 'electron'
import {
  ORGANIZATION_CONTROL_IPC,
  type OrganizationControlDesktopApi,
  type OrganizationControlSnapshot,
} from '../shared/organization-control.js'
import { ORGANIZATION_IPC, type OrganizationDesktopApi, type ProjectRuntimeStatus } from '../shared/organization.js'
import {
  ORGANIZATION_STRATEGY_IPC,
  type OrganizationStrategyDesktopApi,
  type OrganizationStrategySnapshot,
} from '../shared/organization-strategy.js'

const api: OrganizationDesktopApi = {
  state: () => ipcRenderer.invoke(ORGANIZATION_IPC.state),
  mutate: (mutation) => ipcRenderer.invoke(ORGANIZATION_IPC.mutate, mutation),
  planProject: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.planProject, projectId),
  runTask: (taskId) => ipcRenderer.invoke(ORGANIZATION_IPC.runTask, taskId),
  reviewTask: (taskId) => ipcRenderer.invoke(ORGANIZATION_IPC.reviewTask, taskId),
  runNext: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.runNext, projectId),
  cancelRun: (runId) => ipcRenderer.invoke(ORGANIZATION_IPC.cancelRun, runId),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
    ipcRenderer.on(ORGANIZATION_IPC.changed, handler)
    return () => ipcRenderer.removeListener(ORGANIZATION_IPC.changed, handler)
  },
  projectRuntime: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.runtimeState, projectId),
  startProjectRuntime: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.runtimeStart, projectId),
  stopProjectRuntime: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.runtimeStop, projectId),
  onRuntimeChanged: (listener: (status: ProjectRuntimeStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ProjectRuntimeStatus) => listener(status)
    ipcRenderer.on(ORGANIZATION_IPC.runtimeChanged, handler)
    return () => ipcRenderer.removeListener(ORGANIZATION_IPC.runtimeChanged, handler)
  },
}

const controlApi: OrganizationControlDesktopApi = {
  state: () => ipcRenderer.invoke(ORGANIZATION_CONTROL_IPC.state),
  mutate: (mutation) => ipcRenderer.invoke(ORGANIZATION_CONTROL_IPC.mutate, mutation),
  management: (projectId) => ipcRenderer.invoke(ORGANIZATION_CONTROL_IPC.management, projectId),
  shouldRun: (projectId, action, taskId) => ipcRenderer.invoke(ORGANIZATION_CONTROL_IPC.shouldRun, projectId, action, taskId),
  verifyEvidence: (taskId) => ipcRenderer.invoke(ORGANIZATION_CONTROL_IPC.verifyEvidence, taskId),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OrganizationControlSnapshot) => listener(state)
    ipcRenderer.on(ORGANIZATION_CONTROL_IPC.changed, handler)
    return () => ipcRenderer.removeListener(ORGANIZATION_CONTROL_IPC.changed, handler)
  },
}

const strategyApi: OrganizationStrategyDesktopApi = {
  state: () => ipcRenderer.invoke(ORGANIZATION_STRATEGY_IPC.state),
  mutate: (mutation) => ipcRenderer.invoke(ORGANIZATION_STRATEGY_IPC.mutate, mutation),
  projection: (projectId) => ipcRenderer.invoke(ORGANIZATION_STRATEGY_IPC.projection, projectId),
  onChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OrganizationStrategySnapshot) => listener(state)
    ipcRenderer.on(ORGANIZATION_STRATEGY_IPC.changed, handler)
    return () => ipcRenderer.removeListener(ORGANIZATION_STRATEGY_IPC.changed, handler)
  },
}

contextBridge.exposeInMainWorld('ndDshOrganization', api)
contextBridge.exposeInMainWorld('ndDshControl', controlApi)
contextBridge.exposeInMainWorld('ndDshStrategy', strategyApi)
