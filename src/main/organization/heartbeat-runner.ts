import type { OrganizationControlMutation, OrganizationControlSnapshot } from '../../shared/organization-control.js'
import type { OrganizationSnapshot } from '../../shared/organization.js'
import type { OrganizationHeartbeat } from '../../shared/organization-strategy.js'

export interface HeartbeatRunnerDeps {
  strategy: {
    dueHeartbeats(): Promise<OrganizationHeartbeat[]>
    beginHeartbeat(id: string): Promise<OrganizationHeartbeat | null>
    finishHeartbeat(id: string, detail: string): Promise<void>
  }
  store: { state(): Promise<OrganizationSnapshot> }
  control: {
    state(): Promise<OrganizationControlSnapshot>
    mutate(mutation: OrganizationControlMutation): Promise<OrganizationControlSnapshot>
  }
}

export async function runDueHeartbeats(deps: HeartbeatRunnerDeps): Promise<void> {
  for (const candidate of await deps.strategy.dueHeartbeats()) {
    const heartbeat = await deps.strategy.beginHeartbeat(candidate.id)
    if (!heartbeat) continue
    try {
      const [organization, control] = await Promise.all([deps.store.state(), deps.control.state()])
      const blocked = organization.tasks.filter((item) => item.projectId === heartbeat.projectId && item.status === 'blocked')
      const failed = organization.runs.filter((item) => item.projectId === heartbeat.projectId && item.status === 'failed').slice(0, 5)
      const approvals = (organization.approvalRequests ?? []).filter((item) => item.projectId === heartbeat.projectId && item.status === 'pending')
      const openHuman = control.humanActions.filter((item) => item.projectId === heartbeat.projectId && item.status === 'open')
      const issues = [
        ...(blocked.length ? [`${blocked.length} blocked task(s)`] : []),
        ...(failed.length ? [`${failed.length} recent failed run(s)`] : []),
        ...(approvals.length ? [`${approvals.length} explicit approval(s) pending`] : []),
        ...(openHuman.length ? [`${openHuman.length} human action(s) open`] : []),
      ]
      if (!issues.length) {
        await deps.strategy.finishHeartbeat(heartbeat.id, 'Healthy: no blocked tasks, failed runs, pending approvals, or open human actions.')
        continue
      }
      const source = `heartbeat:${heartbeat.id}`
      const title = `${heartbeat.title}: attention needed`
      const existing = control.signals.some((item) => item.projectId === heartbeat.projectId && item.source === source && item.title === title && item.status === 'new')
      if (!existing) {
        await deps.control.mutate({
          type: 'signal.add',
          companyId: heartbeat.companyId,
          projectId: heartbeat.projectId,
          source,
          title,
          summary: issues.join(' · '),
          confidence: 1,
        })
      }
      await deps.strategy.finishHeartbeat(heartbeat.id, issues.join(' · '))
    } catch (error) {
      await deps.strategy.finishHeartbeat(heartbeat.id, `Heartbeat failed closed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
