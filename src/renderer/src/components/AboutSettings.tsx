import { useEffect, useState } from 'react'
import type { AppInfo, BrowserState, HarnessStatus, WorkspaceState } from '../../../shared/contracts'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  rowDesc,
  rowPathText,
  rowStack,
  rowTitle,
  rowValueText,
} from './settings-primitives'
import { betaDiagnostics } from '../lib/beta-diagnostics'

interface AboutSettingsProps {
  workspace: WorkspaceState | null
  harness: HarnessStatus | null
  browser: BrowserState | null
  onError(message: string): void
}

/** General → About: version info and one-click beta diagnostics. */
export function AboutSettings({ workspace, harness, browser, onError }: AboutSettingsProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.ndDsh.app.info().then((info) => { if (mounted) setAppInfo(info) }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  const copyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(betaDiagnostics(appInfo, workspace, harness, browser))
      setDiagnosticsCopied(true)
      window.setTimeout(() => setDiagnosticsCopied(false), 2_000)
    } catch (cause) {
      onError(`Could not copy diagnostics: ${errorMessage(cause)}`)
    }
  }

  return (
    <SettingsSection title="About" className="mt-3.5">
      <div className="space-y-1.5">
        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Version</strong>
            <span className={rowDesc}>{appInfo ? `${appInfo.name} ${appInfo.version}` : 'Loading…'}</span>
          </div>
          <span className={rowValueText}>{appInfo?.platform ?? '—'}</span>
        </SettingsRow>
        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Project root</strong>
            <span className={rowPathText} title={appInfo?.projectRoot}>{appInfo?.projectRoot || '—'}</span>
          </div>
        </SettingsRow>
        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Beta diagnostics</strong>
            <span className={rowDesc}>Copy runtime health for a bug report without credentials, session IDs, paths, project names, or browser URLs.</span>
          </div>
          <SettingsButton onClick={() => void copyDiagnostics()}>{diagnosticsCopied ? 'Copied' : 'Copy diagnostics'}</SettingsButton>
        </SettingsRow>
      </div>
    </SettingsSection>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
