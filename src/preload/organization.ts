import { contextBridge, ipcRenderer } from 'electron'
import { ORGANIZATION_IPC, type OrganizationDesktopApi } from '../shared/organization.js'

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
}

contextBridge.exposeInMainWorld('ndDshOrganization', api)
