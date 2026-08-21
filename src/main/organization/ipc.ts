import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ORGANIZATION_IPC, type OrganizationMutation } from '../../shared/organization.js'
import type { OrganizationOrchestrator } from './orchestrator.js'
import type { OrganizationStore } from './store.js'

const MUTATIONS = new Set([
  'company.create', 'company.update', 'company.activate', 'project.create', 'project.update', 'project.activate',
  'team.create', 'role.create', 'agent.create', 'skill.create', 'workflow.create', 'goal.create', 'task.create',
  'task.update', 'memory.add', 'policy.set',
])

export function registerOrganizationIpc(window: BrowserWindow, store: OrganizationStore, orchestrator: OrganizationOrchestrator): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (event, ...args) => {
      assertTrusted(event, window)
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  handle(ORGANIZATION_IPC.state, () => store.state())
  handle(ORGANIZATION_IPC.mutate, (_event, value) => store.mutate(asMutation(value)))
  handle(ORGANIZATION_IPC.planProject, (_event, value) => orchestrator.planProject(asId(value, 'Project id')))
  handle(ORGANIZATION_IPC.runTask, (_event, value) => orchestrator.runTask(asId(value, 'Task id')))
  handle(ORGANIZATION_IPC.reviewTask, (_event, value) => orchestrator.reviewTask(asId(value, 'Task id')))
  handle(ORGANIZATION_IPC.runNext, (_event, value) => orchestrator.runNext(value === undefined || value === null ? undefined : asId(value, 'Project id')))

  return () => { for (const channel of channels) ipcMain.removeHandler(channel) }
}

function assertTrusted(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Rejected organization IPC from an untrusted renderer frame')
}

function asMutation(value: unknown): OrganizationMutation {
  if (!value || typeof value !== 'object') throw new Error('Organization mutation must be an object')
  const type = (value as Record<string, unknown>).type
  if (typeof type !== 'string' || !MUTATIONS.has(type)) throw new Error('Unsupported organization mutation')
  return value as OrganizationMutation
}

function asId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`${label} must be a short non-empty string`)
  return value.trim()
}
