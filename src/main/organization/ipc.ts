import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import {
  ORGANIZATION_CONTROL_IPC,
  type OrganizationControlAction,
  type OrganizationControlMutation,
} from '../../shared/organization-control.js'
import { ORGANIZATION_IPC, type OrganizationMutation, type OrganizationSnapshot } from '../../shared/organization.js'
import {
  ORGANIZATION_STRATEGY_IPC,
  type OrganizationStrategyMutation,
} from '../../shared/organization-strategy.js'
import type { ProjectRuntimeService } from '../workspace/project-runtime.js'
import type { ProjectWorkspaceCoordinator } from '../workspace/project-workspace-coordinator.js'
import { OrganizationControlPlane } from './control-plane.js'
import type { OrganizationOrchestrator } from './orchestrator.js'
import { materializeOrganizationSignal } from './signal-materializer.js'
import { OrganizationStrategyPlane } from './strategy-plane.js'
import type { OrganizationStore } from './store.js'

const MUTATIONS = new Set([
  'company.create', 'company.update', 'company.activate', 'project.create', 'project.update', 'project.activate',
  'team.create', 'role.create', 'agent.create', 'skill.create', 'workflow.create', 'goal.create', 'task.create',
  'task.update', 'memory.add', 'policy.set',
])
const CONTROL_MUTATIONS = new Set([
  'human-action.add', 'human-action.resolve', 'signal.add', 'signal.triage', 'budget.set', 'feedback.add',
])
const STRATEGY_MUTATIONS = new Set([
  'anchor.add', 'anchor.update', 'knowledge.add', 'knowledge.update', 'schedule.add', 'schedule.update', 'action.record',
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
  const strategy = new OrganizationStrategyPlane(join(app.getPath('userData'), 'organization-strategy.json'), store)
  control.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ORGANIZATION_CONTROL_IPC.changed, state)
  })
  strategy.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ORGANIZATION_STRATEGY_IPC.changed, state)
  })

  // Guard the orchestrator itself instead of only guarding renderer IPC. The
  // orchestrator calls its public methods for autonomy-3/4 continuation, so
  // wrapping them here makes later automatic turns obey the same gates,
  // budgets, leases and evidence ledger as user-started work.
  const restoreOrchestrator = guardOrchestrator(orchestrator, store, control)

  // Organization runs finish on engine event streams, outside renderer IPC.
  // Reconcile independently so evidence, typed results, leases and quotas never
  // depend on a screen being open or a user requesting status.
  const reconcileTimer = setInterval(() => {
    void reconcileControlState(store, control).catch((error) => console.warn('Organization control reconciliation failed:', error instanceof Error ? error.message : String(error)))
  }, 1_500)
  reconcileTimer.unref()

  // Recurring company intent is only a wake-up mechanism. Every due tick still
  // passes through OrganizationControlPlane.shouldRun() and the guarded
  // orchestrator, so a timer never becomes an independent authority source.
  let scheduleBusy = false
  const scheduleTimer = setInterval(() => {
    if (scheduleBusy) return
    scheduleBusy = true
    void runDueSchedules(strategy, control, orchestrator)
      .catch((error) => console.warn('Organization scheduled work failed:', error instanceof Error ? error.message : String(error)))
      .finally(() => { scheduleBusy = false })
  }, 15_000)
  scheduleTimer.unref()

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

  handle(ORGANIZATION_CONTROL_IPC.state, () => control.state())
  handle(ORGANIZATION_CONTROL_IPC.mutate, async (_event, value) => {
    const mutation = asControlMutation(value)
    if (mutation.type === 'signal.triage') {
      const before = await control.state()
      const signal = before.signals.find((item) => item.id === mutation.id)
      if (!signal) throw new Error('Signal not found')
      await materializeOrganizationSignal(store, signal, mutation.disposition)
      let next = await control.mutate(mutation)
      if (mutation.disposition === 'ask-human') {
        next = await control.mutate({
          type: 'human-action.add',
          companyId: signal.companyId,
          ...(signal.projectId ? { projectId: signal.projectId } : {}),
          kind: 'action',
          title: signal.title,
          question: signal.summary,
        })
      } else if (mutation.disposition === 'objective') {
        await strategy.mutate({
          type: 'anchor.add', companyId: signal.companyId,
          ...(signal.projectId ? { projectId: signal.projectId } : {}),
          title: signal.title, outcome: signal.summary, priority: 'high', sourceSignalId: signal.id,
        })
      } else if (mutation.disposition === 'evidence') {
        await strategy.mutate({
          type: 'knowledge.add', companyId: signal.companyId,
          ...(signal.projectId ? { projectId: signal.projectId } : {}),
          kind: 'feedback', title: signal.title, content: signal.summary, source: 'evidence', sourceRef: `signal:${signal.id}`,
        })
      }
      return next
    }
    return control.mutate(mutation)
  })
  handle(ORGANIZATION_CONTROL_IPC.management, (_event, value) => control.management(value === undefined || value === null ? undefined : asId(value, 'Project id')))
  handle(ORGANIZATION_CONTROL_IPC.shouldRun, (_event, projectValue, actionValue, taskValue) => {
    const projectId = projectValue === undefined || projectValue === null ? undefined : asId(projectValue, 'Project id')
    const taskId = taskValue === undefined || taskValue === null ? undefined : asId(taskValue, 'Task id')
    return control.shouldRun(projectId, asControlAction(actionValue), taskId)
  })
  handle(ORGANIZATION_CONTROL_IPC.verifyEvidence, (_event, value) => control.verifyEvidence(asId(value, 'Task id')))

  handle(ORGANIZATION_STRATEGY_IPC.state, () => strategy.state())
  handle(ORGANIZATION_STRATEGY_IPC.mutate, (_event, value) => strategy.mutate(asStrategyMutation(value)))
  handle(ORGANIZATION_STRATEGY_IPC.projection, async (_event, value) => {
    const projectId = value === undefined || value === null ? undefined : asId(value, 'Project id')
    return strategy.projection(projectId, await control.state())
  })

  // Project dev-server lifecycle: validate → start → health → open browser.
  if (projectRuntime) {
    handle(ORGANIZATION_IPC.runtimeState, (_event, value) => projectRuntime.status(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStart, (_event, value) => projectRuntime.start(asId(value, 'Project id')))
    handle(ORGANIZATION_IPC.runtimeStop, (_event, value) => projectRuntime.stop(asId(value, 'Project id')))
  }

  return () => {
    clearInterval(reconcileTimer)
    clearInterval(scheduleTimer)
    restoreOrchestrator()
    control.setOnChanged(undefined)
    strategy.setOnChanged(undefined)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

async function runDueSchedules(
  strategy: OrganizationStrategyPlane,
  control: OrganizationControlPlane,
  orchestrator: OrganizationOrchestrator,
): Promise<void> {
  for (const candidate of await strategy.dueSchedules()) {
    const schedule = await strategy.beginSchedule(candidate.id)
    if (!schedule) continue
    try {
      const decision = await control.shouldRun(schedule.projectId, 'workflow.continue')
      if (decision.route !== 'ready') {
        await strategy.finishSchedule(schedule.id, 'skipped', decision.reason)
        await strategy.mutate({
          type: 'action.record', companyId: schedule.companyId, projectId: schedule.projectId,
          action: 'workflow.continue', target: `schedule:${schedule.id}`, scope: schedule.projectId,
          risk: 'low', externality: 'internal', destructiveLevel: 'none', decision: 'deny', reason: decision.reason,
        })
        continue
      }
      const receipt = await orchestrator.runNext(schedule.projectId, false)
      const detail = receipt ? `Dispatched ${receipt.kind} run ${receipt.runId}.` : 'No runnable work was available.'
      await strategy.finishSchedule(schedule.id, 'success', detail)
      await strategy.mutate({
        type: 'action.record', companyId: schedule.companyId, projectId: schedule.projectId,
        action: 'workflow.continue', target: `schedule:${schedule.id}`, scope: schedule.projectId,
        risk: 'low', externality: 'internal', destructiveLevel: 'none', decision: 'allow', reason: 'Scheduled company continuation passed current ND control gates.', result: detail,
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await strategy.finishSchedule(schedule.id, 'failed', detail)
      await strategy.mutate({
        type: 'action.record', companyId: schedule.companyId, projectId: schedule.projectId,
        action: 'workflow.continue', target: `schedule:${schedule.id}`, scope: schedule.projectId,
        risk: 'low', externality: 'internal', destructiveLevel: 'none', decision: 'deny', reason: 'Scheduled continuation failed closed.', result: detail,
      })
    }
  }
}

function guardOrchestrator(
  orchestrator: OrganizationOrchestrator,
  store: OrganizationStore,
  control: OrganizationControlPlane,
): () => void {
  const planProject = orchestrator.planProject.bind(orchestrator)
  const runTask = orchestrator.runTask.bind(orchestrator)
  const reviewTask = orchestrator.reviewTask.bind(orchestrator)
  const runNext = orchestrator.runNext.bind(orchestrator)

  orchestrator.planProject = async (projectId: string, explicit = true) => {
    await control.assertRunnable(projectId, 'internal.plan')
    const result = await planProject(projectId, explicit)
    await control.noteDispatch(result)
    return result
  }
  orchestrator.runTask = async (taskId: string, explicit = true) => {
    const context = await store.taskContext(taskId)
    await control.assertRunnable(context.project.id, 'task.execute', taskId)
    const result = await runTask(taskId, explicit)
    await control.noteDispatch(result)
    return result
  }
  orchestrator.reviewTask = async (taskId: string, explicit = true) => {
    const context = await store.taskContext(taskId)
    await control.assertRunnable(context.project.id, 'task.review', taskId)
    const result = await reviewTask(taskId, explicit)
    await control.noteDispatch(result)
    return result
  }
  orchestrator.runNext = async (projectId?: string, explicit = true) => {
    const state = await store.state()
    const resolvedProjectId = projectId ?? state.activeProjectId
    if (!resolvedProjectId) throw new Error('No active project')
    await assertProjectCompletionEvidence(store, control, resolvedProjectId)
    await control.assertRunnable(resolvedProjectId, 'workflow.continue')
    const result = await runNext(projectId, explicit)
    if (result) await control.noteDispatch(result)
    return result
  }

  return () => {
    orchestrator.planProject = planProject
    orchestrator.runTask = runTask
    orchestrator.reviewTask = reviewTask
    orchestrator.runNext = runNext
  }
}

async function reconcileControlState(store: OrganizationStore, control: OrganizationControlPlane): Promise<void> {
  await control.state()
  const organization = await store.state()
  for (const project of organization.projects) {
    await assertProjectCompletionEvidence(store, control, project.id, false)
  }
}

/**
 * A task that reached `completed` through a reviewer is not allowed to unlock
 * successor work when its exact worktree receipt is stale or unavailable.
 * Pre-existing completed tasks without a control receipt are left untouched so
 * upgrading ND does not retroactively invalidate old project history.
 */
async function assertProjectCompletionEvidence(
  store: OrganizationStore,
  control: OrganizationControlPlane,
  projectId: string,
  throwOnFailure = true,
): Promise<void> {
  const [organization, controlState] = await Promise.all([store.state(), control.state()])
  for (const task of organization.tasks.filter((item) => item.projectId === projectId && item.status === 'completed')) {
    const receipt = controlState.evidence.find((item) => item.taskId === task.id)
    if (!receipt || receipt.status === 'verified') continue
    if (receipt.status === 'pending_review') {
      const verified = await control.verifyEvidence(task.id)
      if (verified?.status === 'verified') continue
    }
    const current = (await control.state()).evidence.find((item) => item.taskId === task.id)
    if (!current || current.status === 'verified') continue
    await store.mutate({ type: 'task.update', id: task.id, patch: { status: 'blocked' } })
    if (throwOnFailure) {
      throw new Error(`Task ${task.title} cannot advance: independent-review evidence is ${current.status}. Re-review the exact current workspace.`)
    }
  }
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

function asStrategyMutation(value: unknown): OrganizationStrategyMutation {
  if (!value || typeof value !== 'object') throw new Error('Organization strategy mutation must be an object')
  const type = (value as Record<string, unknown>).type
  if (typeof type !== 'string' || !STRATEGY_MUTATIONS.has(type)) throw new Error('Unsupported organization strategy mutation')
  return value as OrganizationStrategyMutation
}

function asControlAction(value: unknown): OrganizationControlAction {
  if (typeof value !== 'string' || !CONTROL_ACTIONS.has(value as OrganizationControlAction)) throw new Error('Unsupported organization control action')
  return value as OrganizationControlAction
}

function asId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(`${label} must be a short non-empty string`)
  return value.trim()
}
