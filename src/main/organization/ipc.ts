import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ORGANIZATION_IPC, type OrganizationMutation, type OrganizationSnapshot } from '../../shared/organization.js'
import type { ProjectRuntimeService } from '../workspace/project-runtime.js'
import type { ProjectWorkspaceCoordinator } from '../workspace/project-workspace-coordinator.js'
import type { OrganizationOrchestrator } from './orchestrator.js'
import type { OrganizationStore } from './store.js'

const MUTATIONS = new Set([
  'company.create', 'company.update', 'company.activate', 'project.create', 'project.update', 'project.activate',
  'team.create', 'role.create', 'agent.create', 'skill.create', 'workflow.create', 'goal.create', 'task.create',
  'task.update', 'memory.add', 'policy.set',
])

export function registerOrganizationIpc(
  window: BrowserWindow,
  store: OrganizationStore,
  orchestrator: OrganizationOrchestrator,
  projectWorkspace: ProjectWorkspaceCoordinator,
  projectRuntime?: ProjectRuntimeService,
): () => void {
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
  handle(ORGANIZATION_IPC.mutate, async (_event, value) => {
    const mutation = asMutation(value)
    await projectWorkspace.assertCanMutate(mutation)
    const state = await store.mutate(mutation)
    await projectWorkspace.afterOrganizationMutation(mutation, state)
    const projectId = autopilotProjectId(mutation, state)
    if (projectId) {
      try {
        await orchestrator.runNext(projectId, false)
        return store.state()
      } catch (error) {
        console.warn('Organization autopilot did not start:', error instanceof Error ? error.message : String(error))
      }
    }
    return state
  })
  handle(ORGANIZATION_IPC.planProject, (_event, value) => orchestrator.planProject(asId(value, 'Project id')))
  handle(ORGANIZATION_IPC.runTask, (_event, value) => orchestrator.runTask(asId(value, 'Task id')))
  handle(ORGANIZATION_IPC.reviewTask, (_event, value) => orchestrator.reviewTask(asId(value, 'Task id')))
  handle(ORGANIZATION_IPC.runNext, (_event, value) => orchestrator.runNext(value === undefined || value === null ? undefined : asId(value, 'Project id')))

  // Project dev-server lifecycle: validate → start → health → open browser.
  if (projectRuntime) {
    handle(ORGANIZATION_IPC.runtimeState, (_event, value) => projectRuntime.status(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStart, (_event, value) => projectRuntime.start(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStop, (_event, value) => projectRuntime.stop(asId(value, 'Project id')))
  }

  return () => { for (const channel of channels) ipcMain.removeHandler(channel) }
}

function autopilotProjectId(mutation: OrganizationMutation, state: OrganizationSnapshot): string | undefined {
  let companyId: string | undefined
  let projectId: string | undefined

  if (mutation.type === 'project.create') {
    companyId = mutation.companyId
    projectId = state.activeProjectId
  } else if (mutation.type === 'company.update' && mutation.patch.autonomyLevel === 4) {
    companyId = mutation.id
    projectId = state.activeProjectId && state.projects.some((item) => item.id === state.activeProjectId && item.companyId === companyId)
      ? state.activeProjectId
      : state.projects.find((item) => item.companyId === companyId && item.status !== 'completed' && item.status !== 'archived')?.id
  }

  if (!companyId || !projectId) return undefined
  const company = state.companies.find((item) => item.id === companyId)
  if (company?.autonomyLevel !== 4) return undefined
  const project = state.projects.find((item) => item.id === projectId)
  if (!project || project.status === 'completed' || project.status === 'archived') return undefined
  return project.id
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
