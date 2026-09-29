import type { OrganizationControlMutation, OrganizationControlSnapshot } from '../../shared/organization-control.js'
import type { OrganizationMutation, OrganizationSnapshot } from '../../shared/organization.js'
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

      const state = await deps.store.state()
      if (trigger.agentId && !state.agents.some((item) => item.id === trigger.agentId && item.companyId === trigger.companyId)) {
        throw new Error('Trigger agent is no longer available')
      }
      const title = `${trigger.title} · ${new Date(activity.createdAt).toISOString().slice(0, 16)}`
      await deps.store.mutate({
        type: 'task.create',
        companyId: trigger.companyId,
        projectId: trigger.projectId,
        title,
        description: `${trigger.prompt}\n\nTriggered by ${activity.type}: ${activity.message}`,
        ...(trigger.agentId ? { assignedAgentId: trigger.agentId } : {}),
      })
      await deps.strategy.recordTriggerFire(trigger.id, activity.id, 'success', `Created task "${title}".`)
    } catch (error) {
      await deps.strategy.recordTriggerFire(trigger.id, activity.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }
}
