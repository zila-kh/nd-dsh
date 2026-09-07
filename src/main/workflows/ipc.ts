import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import {
  WORKFLOW_PLUGINS_IPC,
  type WorkflowPluginInstallSource,
} from '../../shared/workflow-plugins.js'
import type { WorkflowService } from './workflow-service.js'

/**
 * Workflow plugin surface. The renderer can install reviewed packages,
 * detect/bind mirror mode, refresh, and read projected state — it can never
 * supply a filesystem root, repository URL command, or engine identity.
 */
export function registerWorkflowIpc(
  window: BrowserWindow,
  service: WorkflowService,
): () => void {
  const channels = Object.values(WORKFLOW_PLUGINS_IPC).filter((channel) => channel !== WORKFLOW_PLUGINS_IPC.changedEvent)
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, window)
      return listener(event, ...args)
    })
  }

  handle(WORKFLOW_PLUGINS_IPC.list, () => service.state())
  handle(WORKFLOW_PLUGINS_IPC.install, (_event, source) => service.install(asInstallSource(source)))
  handle(WORKFLOW_PLUGINS_IPC.remove, (_event, pluginId) => service.remove(asId(pluginId, 'Plugin id')))
  handle(WORKFLOW_PLUGINS_IPC.detect, (_event, companyId, projectId, pluginId) =>
    service.detect(asId(companyId, 'Company id'), asId(projectId, 'Project id'), optionalId(pluginId)))
  handle(WORKFLOW_PLUGINS_IPC.enable, (_event, companyId, projectId, pluginId) =>
    service.enable(asId(companyId, 'Company id'), asId(projectId, 'Project id'), asId(pluginId, 'Plugin id')))
  handle(WORKFLOW_PLUGINS_IPC.disable, (_event, companyId, projectId, pluginId) =>
    service.disable(asId(companyId, 'Company id'), asId(projectId, 'Project id'), optionalId(pluginId)))
  handle(WORKFLOW_PLUGINS_IPC.refresh, (_event, companyId, projectId) =>
    service.refresh(asId(companyId, 'Company id'), asId(projectId, 'Project id')))
  handle(WORKFLOW_PLUGINS_IPC.snapshot, (_event, companyId, projectId) =>
    service.projectView(asId(companyId, 'Company id'), asId(projectId, 'Project id')))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected workflow plugin IPC from an untrusted renderer frame')
  }
}

function asInstallSource(value: unknown): WorkflowPluginInstallSource {
  if (!value || typeof value !== 'object') throw new Error('Workflow plugin install source is required')
  const record = value as Record<string, unknown>
  if (record.kind === 'local') {
    if (typeof record.path !== 'string' || !record.path.trim()) throw new Error('Plugin bundle path is required')
    return { kind: 'local', path: record.path.trim() }
  }
  if (record.kind === 'git') {
    if (typeof record.url !== 'string' || !record.url.trim()) throw new Error('Repository URL is required')
    return {
      kind: 'git',
      url: record.url.trim(),
      ...(typeof record.ref === 'string' && record.ref.trim() ? { ref: record.ref.trim() } : {}),
    }
  }
  throw new Error('Unsupported workflow plugin install source')
}

function asId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} cannot be empty`)
  if (value.length > 128) throw new Error(`${label} exceeds 128 characters`)
  return value.trim()
}

function optionalId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return asId(value, 'Plugin id')
}
