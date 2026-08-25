import { useEffect, useState } from 'react'
import type { WorkspaceState } from '../../../shared/contracts'
import type { OrganizationSnapshot } from '../../../shared/organization'
import { OrganizationControlCenter } from './OrganizationControlCenter'
import { OrganizationDashboard as OrganizationDashboardLegacy } from './OrganizationDashboardLegacy'
import { OrganizationStrategyCenter } from './OrganizationStrategyCenter'

interface Props {
  workspace: WorkspaceState | null
  onOpenDeepSeek(): void
  onError(message: string): void
}

type CompanyView = 'workspace' | 'operations' | 'strategy'

export function OrganizationDashboard(props: Props) {
  const [view, setView] = useState<CompanyView>('workspace')
  const [state, setState] = useState<OrganizationSnapshot | null>(null)

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state()
      .then((next) => { if (mounted) setState(next) })
      .catch((cause) => props.onError(errorMessage(cause)))
    const off = window.ndDshOrganization.onChanged((next) => {
      if (mounted) setState(next)
    })
    return () => {
      mounted = false
      off()
    }
  }, [props.onError])

  const company = state?.companies.find((item) => item.id === state.activeCompanyId) ?? state?.companies[0]
  const project = state?.projects.find((item) => item.id === state.activeProjectId && item.companyId === company?.id)
  const agents = state?.agents
    .filter((agent) => agent.companyId === company?.id)
    .map((agent) => ({ id: agent.id, name: agent.name })) ?? []

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-soft bg-sidebar px-3">
        <div className="min-w-0">
          <strong className="block truncate text-sm">{company?.name ?? 'AI Company'}</strong>
          <span className="block truncate text-[10px] text-faint">{project?.name ?? 'Company-wide'} · software delivery operating system</span>
        </div>
        <div className="flex items-center rounded-md border border-border-strong bg-secondary p-0.5">
          <button type="button" className={viewButton(view === 'workspace')} onClick={() => setView('workspace')}>Company Workspace</button>
          <button type="button" className={viewButton(view === 'operations')} onClick={() => setView('operations')}>Operations</button>
          <button type="button" className={viewButton(view === 'strategy')} onClick={() => setView('strategy')}>Strategy</button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {view === 'workspace' ? (
          <OrganizationDashboardLegacy {...props} />
        ) : company ? (
          <div className="h-full overflow-auto p-[14px]">
            {view === 'operations' ? (
              <OrganizationControlCenter
                companyId={company.id}
                {...(project ? { projectId: project.id } : {})}
                agents={agents}
                onError={props.onError}
              />
            ) : (
              <OrganizationStrategyCenter
                companyId={company.id}
                {...(project ? { projectId: project.id } : {})}
                agents={agents}
                onError={props.onError}
              />
            )}
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
            Create a company first, then use Operations and Strategy to manage verified autonomous delivery.
          </div>
        )}
      </div>
    </div>
  )
}

function viewButton(active: boolean): string {
  return active
    ? 'h-7 rounded-[5px] bg-background px-2.5 text-xs font-medium text-foreground shadow-sm'
    : 'h-7 rounded-[5px] px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
