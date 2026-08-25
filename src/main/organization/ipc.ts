import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import {
  ORGANIZATION_CONTROL_IPC,
  type OrganizationControlAction,
  type OrganizationControlMutation,
} from '../../shared/organization-control.js'
import { ORGANIZATION_IPC, type OrganizationMutation, type OrganizationRunReceipt, type OrganizationSnapshot } from '../../shared/organization.js'
import type { ProjectRuntimeService } from '../workspace/project-runtime.js'
import type { ProjectWorkspaceCoordinator } from '../workspace/project-workspace-coordinator.js'
import { OrganizationControlPlane } from './control-plane.js'
import type { OrganizationOrchestrator } from './orchestrator.js'
import type { OrganizationStore } from './store.js'

const MUTATIONS = new Set([
  'company.create', 'company.update', 'company.activate', 'project.create', 'project.update', 'project.activate',
  'team.create', 'role.create', 'agent.create', 'skill.create', 'workflow.create', 'goal.create', 'task.create',
  'task.update', 'memory.add', 'policy.set',
])
const CONTROL_MUTATIONS = new Set([
  'human-action.add', 'human-action.resolve', 'signal.add', 'signal.triage', 'budget.set', 'feedback.add',
])
const CONTROL_ACTIONS = new Set<OrganizationControlAction>(['internal.plan', 'task.execute', 'task.review', 'workflow.continue'])

export function registerOrganizationIpc(
  window: BrowserWindow,
  store: OrganizationStore,
  orchestrator: OrganizationOrchestrator,
  projectWorkspace: ProjectWorkspaceCoordinator,
  projectRuntime?: ProjectRuntimeService,
): () => void {
  const channels: string[] = []
  const control = new OrganizationControlPlane(join(app.getPath('userData'), 'organization-control.json'), store)
  control.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ORGANIZATION_CONTROL_IPC.changed, state)
  })

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
        await control.assertRunnable(projectId, 'workflow.continue')
        const receipt = await orchestrator.runNext(projectId, false)
        if (receipt) await control.noteDispatch(receipt)
        return store.state()
      } catch (error) {
        console.warn('Organization autopilot did not start:', error instanceof Error ? error.message : String(error))
      }
    }
    return state
  })
  handle(ORGANIZATION_IPC.planProject, async (_event, value) => {
    const projectId = asId(value, 'Project id')
    await control.assertRunnable(projectId, 'internal.plan')
    return track(control, await orchestrator.planProject(projectId))
  })
  handle(ORGANIZATION_IPC.runTask, async (_event, value) => {
    const taskId = asId(value, 'Task id')
    const context = await store.taskContext(taskId)
    await control.assertRunnable(context.project.id, 'task.execute', taskId)
    return track(control, await orchestrator.runTask(taskId))
  })
  handle(ORGANIZATION_IPC.reviewTask, async (_event, value) => {
    const taskId = asId(value, 'Task id')
    const context = await store.taskContext(taskId)
    await control.assertRunnable(context.project.id, 'task.review', taskId)
    return track(control, await orchestrator.reviewTask(taskId))
  })
  handle(ORGANIZATION_IPC.runNext, async (_event, value) => {
    const projectId = value === undefined || value === null ? undefined : asId(value, 'Project id')
    await control.assertRunnable(projectId, 'workflow.continue')
    const receipt = await orchestrator.runNext(projectId)
    if (receipt) await control.noteDispatch(receipt)
    return receipt
  })

  handle(ORGANIZATION_CONTROL_IPC.state, () => control.state())
  handle(ORGANIZATION_CONTROL_IPC.mutate, (_event, value) => control.mutate(asControlMutation(value)))
  handle(ORGANIZATION_CONTROL_IPC.management, (_event, value) => control.management(value === undefined || value === null ? undefined : asId(value, 'Project id')))
  handle(ORGANIZATION_CONTROL_IPC.shouldRun, (_event, projectValue, actionValue, taskValue) => {
    const projectId = projectValue === undefined || projectValue === null ? undefined : asId(projectValue, 'Project id')
    const taskId = taskValue === undefined || taskValue === null ? undefined : asId(taskValue, 'Task id')
    return control.shouldRun(projectId, asControlAction(actionValue), taskId)
  })
  handle(ORGANIZATION_CONTROL_IPC.verifyEvidence, (_event, value) => control.verifyEvidence(asId(value, 'Task id')))

  // Project dev-server lifecycle: validate → start → health → open browser.
  if (projectRuntime) {
    handle(ORGANIZATION_IPC.runtimeState, (_event, value) => projectRuntime.status(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStart, (_event, value) => projectRuntime.start(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStop, (_event, value) => projectRuntime.stop(asId(value, 'Project id')))
  }

  return () => {
    control.setOnChanged(undefined)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

async function track(control: OrganizationControlPlane, receipt: OrganizationRunReceipt): Promise<OrganizationRunReceipt> {
  await control.noteDispatch(receipt)
  return receipt
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

function asControlMutation(value: unknown): OrganizationControlMutation {
  if (!value || typeof value !== 'object') throw new Error('Organization control mutation must be an object')
  const type = (value as Record<string, unknown>).type
  if (typeof type !== 'string' || !CONTROL_MUTATIONS.has(type)) throw new Error('Unsupported organization control mutation')
  return value as OrganizationControlMutation
}

function asControlAction(value: unknown): OrganizationControlAction {
  if (typeof value !== 'string' || !CONTROL_ACTIONS.has(value as OrganizationControlAction)) throw new Error('Unsupported organization control action')
  return value as OrganizationControlAction
}

function asId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`${label} must be a short non-empty string`)
  return value.trim()
}
