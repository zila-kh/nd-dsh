import type { OrganizationControlMutation, OrganizationControlSnapshot, OrganizationTurnDecision } from '../../shared/organization-control.js'
import type { OrganizationMutation, OrganizationRunReceipt, OrganizationSnapshot } from '../../shared/organization.js'
import type { OrganizationAutomationTrigger } from '../../shared/organization-strategy.js'

interface TriggerFiring {
  trigger: OrganizationAutomationTrigger
  activity: OrganizationSnapshot['activity'][number]
}

export interface EventTriggerRunnerDeps {
  strategy: {
    pendingTriggerFirings(): Promise<TriggerFiring[]>
    recordTriggerFire(triggerId: string, activityId: string, outcome: 'success' | 'skipped' | 'failed', detail: string): Promise<void>
  }
  store: {
    state(): Promise<OrganizationSnapshot>
    mutate(mutation: OrganizationMutation): Promise<OrganizationSnapshot>
  }
  control: {
    state(): Promise<OrganizationControlSnapshot>
    mutate(mutation: OrganizationControlMutation): Promise<OrganizationControlSnapshot>
    shouldRun(projectId: string | undefined, action: 'task.execute', taskId?: string): Promise<OrganizationTurnDecision>
  }
  orchestrator: {
    runTask(taskId: string, explicit?: boolean): Promise<OrganizationRunReceipt>
  }
}

export async function runEventTriggers(deps: EventTriggerRunnerDeps): Promise<void> {
  for (const { trigger, activity } of await deps.strategy.pendingTriggerFirings()) {
    try {
      if (trigger.action === 'signal') {
        const control = await deps.control.state()
        const source = `trigger:${trigger.id}`
        const exists = control.signals.some((item) => item.source === source && item.summary.includes(activity.id) && item.status === 'new')
        if (!exists) {
          await deps.control.mutate({
            type: 'signal.add',
            companyId: trigger.companyId,
            projectId: trigger.projectId,
            source,
            title: trigger.title,
            summary: `${trigger.prompt}\nSource event ${activity.type} (${activity.id}): ${activity.message}`,
            confidence: 1,
          })
        }
        await deps.strategy.recordTriggerFire(trigger.id, activity.id, 'success', 'Created governed signal from organization event.')
        continue
      }

      let state = await deps.store.state()
      const company = state.companies.find((item) => item.id === trigger.companyId)
      if (!company) throw new Error('Trigger company no longer exists')
      if (trigger.agentId && !state.agents.some((item) => item.id === trigger.agentId && item.companyId === trigger.companyId)) {
        throw new Error('Trigger agent is no longer available')
      }

      let triggeredTask = state.tasks.find((item) => item.sourceTriggerId === trigger.id && item.sourceActivityId === activity.id)
      const reused = Boolean(triggeredTask)
      const title = triggeredTask?.title ?? `${trigger.title} · ${new Date(activity.createdAt).toISOString().slice(0, 16)}`
      if (!triggeredTask) {
        state = await deps.store.mutate({
          type: 'task.create',
          companyId: trigger.companyId,
          projectId: trigger.projectId,
          title,
          description: `${trigger.prompt}\n\nTriggered by ${activity.type}: ${activity.message}`,
          sourceTriggerId: trigger.id,
          sourceActivityId: activity.id,
          ...(trigger.agentId ? { assignedAgentId: trigger.agentId } : {}),
        })
        triggeredTask = state.tasks.find((item) => item.sourceTriggerId === trigger.id && item.sourceActivityId === activity.id)
      }

      if (!triggeredTask) throw new Error('Event-triggered task was not materialized')
      const parts = [reused ? `Reused crash-safe trigger task "${title}".` : `Created task "${title}".`]
      if (company.autonomyLevel >= 3) {
        if (triggeredTask.status !== 'ready') {
          parts.push(`Triggered task is ${triggeredTask.status}; ND will not auto-restart non-ready work.`)
        } else {
          const decision = await deps.control.shouldRun(trigger.projectId, 'task.execute', triggeredTask.id)
          if (decision.route === 'ready') {
            const receipt = await deps.orchestrator.runTask(triggeredTask.id, false)
            parts.push(`Dispatched ${receipt.kind} run ${receipt.runId} for the triggered task.`)
          } else {
            parts.push(`Triggered task is waiting on the board: ${decision.reason}`)
          }
        }
      } else {
        parts.push('Task is waiting for a human because company autonomy is below level 3.')
      }
      await deps.strategy.recordTriggerFire(trigger.id, activity.id, 'success', parts.join(' '))
    } catch (error) {
      await deps.strategy.recordTriggerFire(trigger.id, activity.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }
}
