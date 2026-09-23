import { useEffect, useState, type FormEvent } from 'react'
import type { AppInfo, BrowserState, HarnessStatus, SavedWorkspace, ThemeMode, ThemeState, WorkspaceRegistryView, WorkspaceState } from '../../../shared/contracts'
import type { BrowserCompanionState } from '../../../shared/browser-companion'
import type { BrowserPlatformState } from '../../../shared/browser-platform'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { BridgePill } from './bridge-pill'
import { CapabilitySettings } from './CapabilitySettings'
import { EngineSettings } from './EngineSettings'
import { ExtensionSettings } from './ExtensionSettings'
import { ModelSettings } from './ModelSettings'
import { PresetSettings } from './PresetSettings'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  rowDesc,
  rowPathText,
  rowStack,
  rowTitle,
  rowValueText,
  StatusChip,
} from './settings-primitives'
import { betaDiagnostics } from '../lib/beta-diagnostics'
import { cn } from '../lib/utils'
import {
  generalSubTabFromLocation,
  type CapabilitySubTab,
  type GeneralSubTab,
  type SettingsTab,
} from '../lib/settings-route'

interface SettingsPaneProps {
  theme: ThemeState | null
  onSelectTheme(mode: ThemeMode): void
  workspace: WorkspaceState | null
  onWorkspaceChanged(workspace: WorkspaceState): void
  harness: HarnessStatus | null
  browser: BrowserState | null
  onError(message: string): void
  tab: SettingsTab
  onSelectTab(tab: SettingsTab): void
  subTab?: GeneralSubTab
  onSelectSubTab?: (subTab: GeneralSubTab) => void
  capabilitySubTab?: CapabilitySubTab
  onSelectCapabilitySubTab?: (subTab: CapabilitySubTab) => void
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'models', label: 'Models' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'extensions', label: 'Plugins' },
  { id: 'engines', label: 'Coding engines' },
  { id: 'presets', label: 'Agent presets' },
]

const GENERAL_SUB_TABS: { id: GeneralSubTab; label: string }[] = [
  { id: 'runtime', label: 'Runtime' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'browser', label: 'Browser' },
  { id: 'about', label: 'About' },
]

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'system', label: 'System', Icon: MonitorIcon },
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
]


export function SettingsPane({
  theme,
  onSelectTheme,
  workspace,
  onWorkspaceChanged,
  harness,
  browser,
  onError,
  tab,
  onSelectTab,
  subTab: propSubTab,
  onSelectSubTab,
  capabilitySubTab,
  onSelectCapabilitySubTab,
}: SettingsPaneProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [internalSubTab, setInternalSubTab] = useState<GeneralSubTab>(generalSubTabFromLocation)
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false)
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceRegistryView | null>(null)
  const [workspaceToRemove, setWorkspaceToRemove] = useState<SavedWorkspace | null>(null)
  const [browserCompanion, setBrowserCompanion] = useState<BrowserCompanionState | null>(null)
  const [browserPlatform, setBrowserPlatform] = useState<BrowserPlatformState | null>(null)
  const [credentialOrigin, setCredentialOrigin] = useState('')
  const [credentialUsername, setCredentialUsername] = useState('')
  const [credentialPassword, setCredentialPassword] = useState('')

  const activeSubTab = propSubTab ?? internalSubTab
  const handleSelectSubTab = (selected: GeneralSubTab): void => {
    if (onSelectSubTab) {
      onSelectSubTab(selected)
    } else {
      setInternalSubTab(selected)
    }
  }

  useEffect(() => {
    let mounted = true
    void window.ndDsh.app.info().then((info) => { if (mounted) setAppInfo(info) }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    setPathDraft(workspace?.root ?? '')
  }, [workspace?.root])

  useEffect(() => {
    let mounted = true
    void window.ndDsh.browserCompanion.state().then((state) => { if (mounted) setBrowserCompanion(state) }).catch(() => undefined)
    const dispose = window.ndDsh.browserCompanion.onChanged((state) => { if (mounted) setBrowserCompanion(state) })
    return () => {
      mounted = false
      dispose()
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void window.ndDsh.browserPlatform.state().then((state) => { if (mounted) setBrowserPlatform(state) }).catch(() => undefined)
    const dispose = window.ndDsh.browserPlatform.onChanged((state) => { if (mounted) setBrowserPlatform(state) })
    return () => {
      mounted = false
      dispose()
    }
  }, [])

  // The saved list is only shown on the Workspace sub-tab, so it is read on demand.
  useEffect(() => {
    if (activeSubTab !== 'workspace') return
    let mounted = true
    void window.ndDsh.workspace.registry()
      .then((value) => { if (mounted) setSavedWorkspaces(value) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [activeSubTab, workspace?.root])

  const removeSavedWorkspace = async (id: string): Promise<void> => {
    try {
      const next = await window.ndDsh.workspace.removeSaved(id)
      setSavedWorkspaces(next)
      setWorkspaceToRemove(null)
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const changeFolder = async (): Promise<void> => {
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.pick())
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const openPath = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const path = pathDraft.trim()
    if (!path) return
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.setRoot(path))
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  const copyDiagnostics = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(betaDiagnostics(appInfo, workspace, harness, browser))
      setDiagnosticsCopied(true)
      window.setTimeout(() => setDiagnosticsCopied(false), 2_000)
    } catch (cause) {
      onError(`Could not copy diagnostics: ${errorMessage(cause)}`)
    }
  }

  const dotClass = harness?.state === 'ready'
    ? 'bg-primary'
    : harness?.state === 'running' || harness?.state === 'starting'
      ? 'animate-pulse-dot bg-info'
      : harness?.state === 'error'
        ? 'bg-destructive'
        : 'bg-faint'

  return (
    <section className="grid h-full w-full grid-rows-[auto_minmax(0,1fr)] min-h-0 min-w-0 bg-surface-0" aria-label="Settings">
      <header className="flex items-center justify-between gap-4 border-b border-border-soft px-[26px] py-3.5">
        <div>
          <span className="mb-[5px] block text-[8px] font-bold tracking-[0.13em] text-faint">ND-DSH · AI COMPANY OS</span>
          <h1 className="m-0 text-lg font-semibold tracking-tight text-strong">Settings</h1>
        </div>
        <nav role="tablist" aria-label="Settings sections" className="ml-auto flex shrink-0 gap-0.5 rounded-lg border border-border bg-secondary p-[3px]">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={cn(
                'rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors',
                tab === id ? 'bg-primary/10 text-primary' : 'text-faint hover:bg-accent hover:text-soft',
              )}
              onClick={() => onSelectTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden">
        {tab === 'models' ? (
          <ModelSettings onError={onError} />
        ) : tab === 'capabilities' ? (
          <CapabilitySettings
            onError={onError}
            {...(capabilitySubTab !== undefined ? { subTab: capabilitySubTab } : {})}
            {...(onSelectCapabilitySubTab !== undefined ? { onSelectSubTab: onSelectCapabilitySubTab } : {})}
          />
        ) : tab === 'extensions' ? (
          <ExtensionSettings onError={onError} />
        ) : tab === 'engines' ? (
          <EngineSettings onError={onError} />
        ) : tab === 'presets' ? (
          <PresetSettings onError={onError} />
        ) : (
          <div className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-1.5">
            {tab === 'general' ? (
              <>
                <div className="mt-3 flex items-center gap-1 border-b border-border-soft pb-2.5">
                  <nav role="tablist" aria-label="General sub-tabs" className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-secondary p-[3px]">
                    {GENERAL_SUB_TABS.map(({ id, label }) => (
                      <button
                        key={id}
                        role="tab"
                        aria-selected={activeSubTab === id}
                        className={cn(
                          'rounded-md px-3 py-1 text-[11px] font-semibold transition-colors',
                          activeSubTab === id
                            ? 'bg-primary/10 text-primary'
                            : 'text-faint hover:bg-accent hover:text-soft',
                        )}
                        onClick={() => handleSelectSubTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </nav>
                </div>

                {activeSubTab === 'workspace' && (
                  <>
                    <SettingsSection title="Workspace" className="mt-3.5">
                      <div className="space-y-1.5">
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Folder</strong>
                            <span className={rowPathText} title={workspace?.root}>{workspace ? workspace.root : 'No workspace open'}</span>
                          </div>
                          <SettingsButton onClick={() => void changeFolder()}>Change folder</SettingsButton>
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Folder path</strong>
                            <span className={rowDesc}>Open a project workspace by path.</span>
                          </div>
                          <form className="flex shrink-0 min-w-0 items-center gap-1.5" onSubmit={openPath}>
                            <input
                              aria-label="Workspace path"
                              placeholder="/Users/you/your-project"
                              value={pathDraft}
                              onChange={(event) => setPathDraft(event.target.value)}
                              spellCheck={false}
                              className="h-[26px] w-[220px] min-w-0 rounded-md border border-border-strong bg-background px-[9px] font-mono text-[9px] text-soft outline-none focus:border-(--border-focus)"
                            />
                            <SettingsButton type="submit">Open</SettingsButton>
                          </form>
                        </SettingsRow>
                      </div>
                    </SettingsSection>

                    {savedWorkspaces && savedWorkspaces.items.length > 0 ? (
                      <SettingsSection title="Saved workspaces">
                        <div className="space-y-1.5">
                          {savedWorkspaces.items.map((item) => (
                            <SettingsRow key={item.id}>
                              <div className={rowStack}>
                                <strong className={rowTitle}>
                                  {item.name}
                                  {item.id === savedWorkspaces.activeId ? <span className="ml-2 text-[9px] font-bold tracking-[0.08em] text-primary">CURRENT</span> : null}
                                </strong>
                                <span className={rowPathText} title={item.root}>{item.root}</span>
                              </div>
                              <SettingsButton
                                aria-label={`Remove saved workspace ${item.name}`}
                                className="hover:border-destructive/45 hover:text-destructive"
                                onClick={() => setWorkspaceToRemove(item)}
                              >
                                Remove
                              </SettingsButton>
                            </SettingsRow>
                          ))}
                        </div>
                      </SettingsSection>
                    ) : null}
                  </>
                )}

                {activeSubTab === 'runtime' && (
                  <>
                    <SettingsSection title="ND runtime" className="mt-3.5">
                      <div className="space-y-1.5">
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Primary adapter</strong>
                            <span className={rowDesc}>ND Harness currently owns durable sessions, tools, approvals, and organization run events. Additional coding engines are registered separately.</span>
                          </div>
                          <span className={cn('inline-block size-1.5 shrink-0 rounded-full', dotClass)} />
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Model route</strong>
                            <span className={rowDesc}>{harness?.model ?? 'Not connected'}</span>
                          </div>
                          <span className={rowValueText}>{harness?.provider ?? '—'}</span>
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Provider credential</strong>
                            <span className={rowDesc}>{harness?.apiKeyPresent ? 'Provider credentials configured' : harness?.apiKeyRequired ? 'Credential required for the active route' : 'No credential required for the active local route'}</span>
                          </div>
                          <StatusChip good={harness?.apiKeyPresent || !harness?.apiKeyRequired} warn={!harness?.apiKeyPresent && harness?.apiKeyRequired}>
                            {harness?.apiKeyPresent ? 'Ready' : harness?.apiKeyRequired ? 'Check route' : 'No key needed'}
                          </StatusChip>
                        </SettingsRow>
                        {harness?.sessionId ? (
                          <SettingsRow>
                            <div className={rowStack}>
                              <strong className={rowTitle}>Active session</strong>
                              <span className={rowPathText} title={harness.sessionId}>{harness.sessionId}</span>
                            </div>
                          </SettingsRow>
                        ) : null}
                        {harness?.error ? (
                          <SettingsRow>
                            <div className={rowStack}>
                              <strong className={rowTitle}>Runtime error</strong>
                              <span className={rowDesc}>{harness.error}</span>
                            </div>
                            <StatusChip warn>Attention</StatusChip>
                          </SettingsRow>
                        ) : null}
                      </div>
                    </SettingsSection>

                    <SettingsSection title="Product architecture">
                      <div className="space-y-1.5">
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Control plane</strong>
                            <span className={rowDesc}>ND-DSH owns companies, projects, roles, agents, tasks, skills, memory, policies, provider routes, and engine registration.</span>
                          </div>
                          <StatusChip good>ND-DSH</StatusChip>
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Execution boundary</strong>
                            <span className={rowDesc}>Coding engines are replaceable adapters. Vendor runtime interfaces are infrastructure, not product identity.</span>
                          </div>
                        </SettingsRow>
                      </div>
                    </SettingsSection>
                  </>
                )}

                {activeSubTab === 'browser' && (
                  <>
                    <SettingsSection title="Agent browser" className="mt-3.5">
                      <div className="space-y-1.5">
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Browser control</strong>
                            <span className={rowDesc}>The agent controls the visible Electron browser pane through the pinned browser bridge.</span>
                          </div>
                          <BridgePill state={browser?.agentBrowser ?? 'binding'}>
                            {browser?.agentBrowser === 'ready' ? 'Linked' : browser?.agentBrowser === 'unavailable' ? 'Offline' : 'Linking'}
                          </BridgePill>
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>CDP port</strong>
                            <span className={rowDesc}>Loopback debugging endpoint</span>
                          </div>
                          <span className={rowValueText}>{browser?.cdpPort ?? '—'}</span>
                        </SettingsRow>
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Current page</strong>
                            <span className={rowPathText} title={browser?.url}>{browser?.url ?? 'No page'}</span>
                          </div>
                        </SettingsRow>
                      </div>
                    </SettingsSection>
                    <SettingsSection title="Browser companions" className="mt-3.5">
                      <div className="space-y-1.5">
                        {browserCompanion?.connections.length ? browserCompanion.connections.map((connection) => (
                          <SettingsRow key={connection.id}>
                            <div className={rowStack}>
                              <strong className={rowTitle}>{connection.profileLabel}</strong>
                              <span className={rowDesc}>{connection.browser} · extension {connection.extensionVersion}</span>
                            </div>
                            <StatusChip good={connection.connected}>{connection.connected ? 'Connected' : 'Offline'}</StatusChip>
                          </SettingsRow>
                        )) : (
                          <SettingsRow>
                            <div className={rowStack}>
                              <strong className={rowTitle}>Chrome / Chromium</strong>
                              <span className={rowDesc}>Install the ND Browser Companion extension and native host to use an existing signed-in browser profile.</span>
                            </div>
                            <StatusChip>Not connected</StatusChip>
                          </SettingsRow>
                        )}
                        <SettingsRow>
                          <div className={rowStack}>
                            <strong className={rowTitle}>Writable tab leases</strong>
                            <span className={rowDesc}>One execution lane owns a writable tab at a time; disconnects revoke its leases.</span>
                          </div>
                          <span className={rowValueText}>{browserCompanion?.leases.length ?? 0}</span>
                        </SettingsRow>
                      </div>
                    </SettingsSection>
                  </>
                )}

                {activeSubTab === 'about' && (
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
                )}
              </>
            ) : (
              <SettingsSection title="Appearance" className="mt-3.5">
                <SettingsRow>
                  <div className={rowStack}>
                    <strong className={rowTitle}>Theme</strong>
                    <span className={rowDesc}>Follow the OS, or pin light or dark mode.</span>
                  </div>
                  <div role="radiogroup" aria-label="Theme" className="flex shrink-0 gap-[3px] rounded-[7px] border border-border bg-secondary p-[3px]">
                    {THEME_OPTIONS.map(({ mode, label, Icon }) => (
                      <button
                        key={mode}
                        role="radio"
                        aria-checked={theme?.mode === mode}
                        aria-label={label}
                        title={label}
                        className={cn(
                          'grid size-[30px] h-6 place-items-center rounded-[5px] transition-colors [&_svg]:size-[13px]',
                          theme?.mode === mode ? 'bg-primary/10 text-primary' : 'text-faint hover:bg-accent hover:text-foreground',
                        )}
                        onClick={() => onSelectTheme(mode)}
                      >
                        <Icon />
                      </button>
                    ))}
                  </div>
                </SettingsRow>
              </SettingsSection>
            )}
          </div>
        )}
      </div>

      <Dialog open={workspaceToRemove !== null} onOpenChange={(open) => { if (!open) setWorkspaceToRemove(null) }}>
        <DialogContent className="sm:max-w-[470px]">
          <DialogHeader>
            <DialogTitle>Remove saved workspace?</DialogTitle>
            <DialogDescription>
              {workspaceToRemove
                ? `“${workspaceToRemove.name}” will no longer be offered as a saved workspace. The folder and everything in it are left untouched.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {workspaceToRemove ? (
            <p className="m-0 font-mono text-[10px] text-muted-foreground">{workspaceToRemove.root}</p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <button
                type="button"
                className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[10px] text-soft transition-colors hover:bg-accent hover:text-foreground"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              className="shrink-0 rounded-md border border-destructive/45 bg-secondary px-2.5 py-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10"
              onClick={() => { if (workspaceToRemove) void removeSavedWorkspace(workspaceToRemove.id) }}
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
