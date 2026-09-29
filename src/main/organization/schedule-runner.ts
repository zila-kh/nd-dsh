import type { OrganizationMutation, OrganizationRunReceipt, OrganizationSnapshot } from '../../shared/organization.js'
import type { OrganizationCompanySchedule, OrganizationStrategyMutation } from '../../shared/organization-strategy.js'
import type { OrganizationControlAction, OrganizationTurnDecision } from '../../shared/organization-control.js'

/** A held or failed run retries this soon (never later than its own interval). */
const SCHEDULE_RETRY_MS = 15 * 60_000

export interface ScheduleRunnerDeps {
  strategy: {
    dueSchedules(): Promise<OrganizationCompanySchedule[]>
    beginSchedule(id: string): Promise<OrganizationCompanySchedule | null>
    finishSchedule(id: string, outcome: 'success' | 'skipped' | 'failed', detail: string): Promise<void>
    releaseSchedule(id: string, outcome: 'success' | 'skipped' | 'failed', detail: string, retryInMs: number): Promise<void>
    mutate(mutation: OrganizationStrategyMutation): Promise<unknown>
  }
  control: { shouldRun(projectId: string | undefined, action: OrganizationControlAction): Promise<OrganizationTurnDecision> }
  store: { state(): Promise<OrganizationSnapshot>; mutate(mutation: OrganizationMutation): Promise<OrganizationSnapshot> }
  orchestrator: { runNext(projectId?: string, explicit?: boolean): Promise<OrganizationRunReceipt | null> }
  now?: () => number
}

/**
 * A company schedule is recurring work, like a recurring ticket: each due run
 * puts one task titled after the schedule on the project board (unless the last
 * one is still open), then lets autopilot start it when the company allows
 * autonomous execution. Below autonomy 3 the task waits for a human, which is
 * still visible, useful work rather than a silent no-op.
 */
export async function runDueSchedules(deps: ScheduleRunnerDeps): Promise<void> {
  const now = deps.now ?? Date.now
  for (const candidate of await deps.strategy.dueSchedules()) {
    const schedule = await deps.strategy.beginSchedule(candidate.id)
    if (!schedule) continue
    const audit = (decision: 'allow' | 'deny', reason: string, result?: string): Promise<unknown> => deps.strategy.mutate({
      type: 'action.record', companyId: schedule.companyId, projectId: schedule.projectId,
      action: 'workflow.continue', target: `schedule:${schedule.id}`, scope: schedule.projectId,
      risk: 'low', externality: 'internal', destructiveLevel: 'none', decision, reason,
      ...(result ? { result } : {}),
    })
    try {
      const decision = await deps.control.shouldRun(schedule.projectId, 'workflow.continue')
      if (decision.route !== 'ready') {
        await deps.strategy.releaseSchedule(schedule.id, 'skipped', decision.reason, SCHEDULE_RETRY_MS)
        await audit('deny', decision.reason)
        continue
      }

      const state = await deps.store.state()
      const project = state.projects.find((item) => item.id === schedule.projectId)
      const company = state.companies.find((item) => item.id === schedule.companyId)
      if (!project || !company) throw new Error('Scheduled project no longer exists')
      const open = state.tasks.find((task) => task.sourceScheduleId === schedule.id && task.status !== 'completed')
      let created: string | undefined
      if (!open) {
        const title = `${schedule.title} · ${new Date(now()).toISOString().slice(0, 10)}`
        await deps.store.mutate({
          type: 'task.create', companyId: company.id, projectId: project.id, title,
          description: `Recurring work from the company schedule "${schedule.title}" (every ${formatInterval(schedule.intervalMinutes)}).`,
          sourceScheduleId: schedule.id,
        })
        created = title
      }

      const parts = [created ? `Created task "${created}".` : `Task "${open!.title}" from the previous run is still open.`]
      if (company.autonomyLevel >= 3) {
        const receipt = await deps.orchestrator.runNext(schedule.projectId, false)
        parts.push(receipt ? `Dispatched ${receipt.kind} run ${receipt.runId}.` : 'No runnable work was available yet.')
      } else {
        parts.push('It is waiting on the board for a human to start it; raise the company to autonomy 3 to let schedules start work.')
      }
      const detail = parts.join(' ')
      await deps.strategy.finishSchedule(schedule.id, 'success', detail)
      await audit('allow', 'Scheduled company work passed current ND control gates.', detail)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      await deps.strategy.releaseSchedule(schedule.id, 'failed', detail, SCHEDULE_RETRY_MS)
      await audit('deny', 'Scheduled company work failed closed.', detail)
    }
  }
}

function formatInterval(minutes: number): string {
  if (minutes % (60 * 24 * 7) === 0) return `${minutes / (60 * 24 * 7)} week(s)`
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} day(s)`
  if (minutes % 60 === 0) return `${minutes / 60} hour(s)`
  return `${minutes} minute(s)`
}
