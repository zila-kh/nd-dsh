import type { BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'

export function StatusBar({ browser, harness, workspace }: {
  browser: BrowserState | null
  harness: HarnessStatus | null
  workspace: WorkspaceState | null
}) {
  const browserLabel = browser?.loading ? 'browser loading' : browser?.url ? 'browser ready' : 'browser idle'
  return (
    <footer className="status-bar">
      <div><span className="status-branch">ND</span><span>{workspace ? 'workspace open' : 'no workspace'}</span><span>{browserLabel}</span></div>
      <div><span>{workspace?.name ?? 'No workspace'}</span><span>CDP :{browser?.cdpPort ?? 9222}</span><span>{browser?.agentBrowser ?? 'binding'}</span><span>{harness?.state ?? 'stopped'}</span><span>UTF-8</span><span>TypeScript</span></div>
    </footer>
  )
}
