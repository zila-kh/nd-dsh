import type { AppInfo, BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'

/**
 * Build a clipboard-safe support report. Never include raw error strings:
 * provider/browser/runtime failures routinely embed local paths, URLs, session
 * identifiers, request metadata, and occasionally credential material.
 */
export function betaDiagnostics(
  appInfo: AppInfo | null,
  workspace: WorkspaceState | null,
  harness: HarnessStatus | null,
  browser: BrowserState | null,
): string {
  const lines = [
    'ND-DSH Beta Diagnostics',
    `Captured: ${new Date().toISOString()}`,
    `App: ${appInfo ? `${appInfo.name} ${appInfo.version}` : 'unknown'}`,
    `Platform: ${appInfo?.platform ?? 'unknown'}`,
    `Runtime state: ${harness?.state ?? 'unknown'}`,
    `Runtime source ready: ${harness?.sourceReady ? 'yes' : 'no'}`,
    `Provider: ${harness?.provider || 'unknown'}`,
    `Model: ${harness?.model || 'unknown'}`,
    `Credential status: ${harness?.apiKeyRequired ? (harness.apiKeyPresent ? 'configured' : 'required-missing') : 'not-required'}`,
    `Browser bridge: ${browser?.agentBrowser ?? 'unknown'}`,
    `Browser loading: ${browser?.loading ? 'yes' : 'no'}`,
    `Workspace binding: ${workspace?.binding ?? 'unknown'}`,
    `Project linked: ${workspace?.projectId ? 'yes' : 'no'}`,
  ]
  if (harness?.error) lines.push('Runtime error: present (details redacted)')
  if (browser?.agentBrowserError) lines.push('Browser bridge error: present (details redacted)')
  lines.push('', 'Privacy: credentials, session ids, workspace paths, project names, and current browser URLs are intentionally omitted.')
  return lines.join('\n')
}
