import { contextBridge, ipcRenderer } from 'electron'
import { ORGANIZATION_IPC, type OrganizationDesktopApi, type OrganizationMutation, type OrganizationSnapshot, type ProjectRuntimeStatus } from '../shared/organization.js'

const api: OrganizationDesktopApi = {
  state: () => ipcRenderer.invoke(ORGANIZATION_IPC.state),
  mutate: (mutation) => ipcRenderer.invoke(ORGANIZATION_IPC.mutate, mutation),
  planProject: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.planProject, projectId),
  runTask: (taskId) => ipcRenderer.invoke(ORGANIZATION_IPC.runTask, taskId),
  reviewTask: (taskId) => ipcRenderer.invoke(ORGANIZATION_IPC.reviewTask, taskId),
  runNext: (projectId) => ipcRenderer.invoke(ORGANIZATION_IPC.runNext, projectId),
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

contextBridge.exposeInMainWorld('ndDshOrganization', api)
