import type { BrowserState, DshSurface, HarnessStatus, WorkspaceState } from '../../../shared/contracts'

export function StatusBar({ browser, harness, workspace, surface }: {
  browser: BrowserState | null
  harness: HarnessStatus | null
  workspace: WorkspaceState | null
  surface: DshSurface
}) {
  const browserLabel = browser?.loading ? 'browser loading' : browser?.url ? 'browser ready' : 'browser idle'
  const gatewayPort = harness?.port
  return (
    <footer className="status-bar">
      <div><span className="status-branch">ND</span><span>{workspace ? 'workspace open' : 'no workspace'}</span><span>{browserLabel}</span></div>
      <div>
        <span>{workspace?.name ?? 'No workspace'}</span>
        <span>CDP :{browser?.cdpPort ?? 9222}</span>
        <span>{browser?.agentBrowser === 'ready' ? 'browser linked' : browser?.agentBrowser ?? 'binding'}</span>
        {gatewayPort ? <span>gateway :{gatewayPort}</span> : null}
        <span>{harness?.state ?? 'stopped'}</span>
        <span>{surface === 'dsh' ? 'DeepSeek UI' : 'ND-DSH workbench'}</span>
      </div>
    </footer>
  )
}
