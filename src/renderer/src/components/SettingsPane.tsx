import { useEffect, useState, type FormEvent } from 'react'
import type {
  AppInfo,
  BrowserState,
  DshSurface,
  HarnessStatus,
  ThemeMode,
  ThemeState,
  WorkspaceState,
} from '../../../shared/contracts'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { ModelSettings } from './ModelSettings'
import { PresetSettings } from './PresetSettings'

interface SettingsPaneProps {
  theme: ThemeState | null
  onSelectTheme(mode: ThemeMode): void
  workspace: WorkspaceState | null
  onWorkspaceChanged(workspace: WorkspaceState): void
  harness: HarnessStatus | null
  browser: BrowserState | null
  surface: DshSurface
  onSurfaceChanged(surface: DshSurface): void
  onError(message: string): void
}

type SettingsTab = 'general' | 'appearance' | 'models' | 'presets'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'models', label: 'Models' },
  { id: 'presets', label: 'Presets' },
]

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'system', label: 'System', Icon: MonitorIcon },
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
]

const SURFACE_OPTIONS: { surface: DshSurface; label: string; hint: string }[] = [
  { surface: 'dsh', label: 'DeepSeek UI', hint: 'The official DeepSeek Harness interface, served by the runtime.' },
  { surface: 'workbench', label: 'ND-DSH workbench', hint: 'Our custom IDE layout with the sessions rail, explorer, and browser pane.' },
]

export function SettingsPane({
  theme,
  onSelectTheme,
  workspace,
  onWorkspaceChanged,
  harness,
  browser,
  surface,
  onSurfaceChanged,
  onError,
}: SettingsPaneProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    let mounted = true
    void window.ndDsh.app
      .info()
      .then((info) => { if (mounted) setAppInfo(info) })
      .catch(() => undefined)
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    setPathDraft(workspace?.root ?? '')
  }, [workspace?.root])

  const changeFolder = async (): Promise<void> => {
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.pick())
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const openPath = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const path = pathDraft.trim()
    if (!path) return
    try {
      onWorkspaceChanged(await window.ndDsh.workspace.setRoot(path))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const changeSurface = async (next: DshSurface): Promise<void> => {
    if (next === surface) return
    try {
      const state = await window.ndDsh.surface.set(next)
      onSurfaceChanged(state.surface)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const dotClass =
    harness?.state === 'ready' ? 'good'
    : harness?.state === 'running' || harness?.state === 'starting' ? 'busy'
    : harness?.state === 'error' ? 'bad'
    : ''

  return (
    <section className="settings-pane" aria-label="Settings">
      <header className="settings-header">
        <div>
          <span className="eyebrow">ND · DEEPSEEK IDE</span>
          <h1>Settings</h1>
        </div>
        <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <div className="settings-tab-content">
        {tab === 'models' ? (
          <ModelSettings onError={onError} />
        ) : tab === 'presets' ? (
          <PresetSettings onError={onError} />
        ) : (
          <div className="settings-scroll">
            {tab === 'general' ? (
              <>
                <section className="settings-section">
                  <h2>Workspace</h2>
                  <div className="settings-row">
                    <div>
                      <strong>Folder</strong>
                      <span className="settings-path" title={workspace?.root}>
                        {workspace ? workspace.root : 'No workspace open'}
                      </span>
                    </div>
                    <button className="settings-button" onClick={() => void changeFolder()}>
                      Change folder
                    </button>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Folder path</strong>
                      <span>Open a folder by typing its path</span>
                    </div>
                    <form className="settings-path-form" onSubmit={openPath}>
                      <input
                        aria-label="Workspace path"
                        placeholder="/Users/you/your-project"
                        value={pathDraft}
                        onChange={(event) => setPathDraft(event.target.value)}
                        spellCheck={false}
                      />
                      <button className="settings-button" type="submit">Open</button>
                    </form>
                  </div>
                </section>

                <section className="settings-section">
                  <h2>Agent</h2>
                  <div className="settings-row">
                    <div>
                      <strong>Runtime</strong>
                      <span>DeepSeek Harness status</span>
                    </div>
                    <span className={`status-dot ${dotClass}`} />
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Model</strong>
                      <span>{harness?.model ?? 'Not connected'}</span>
                    </div>
                    <span className="settings-value">{harness?.provider ?? '—'}</span>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>API key</strong>
                      <span>
                        {harness?.apiKeyPresent
                          ? 'Configured in .env'
                          : 'Missing — add DEEPSEEK_API_KEY to .env'}
                      </span>
                    </div>
                    <span className={`settings-status ${harness?.apiKeyPresent ? 'good' : 'warn'}`}>
                      {harness?.apiKeyPresent ? 'Ready' : 'Missing'}
                    </span>
                  </div>
                  {harness?.sessionId ? (
                    <div className="settings-row">
                      <div>
                        <strong>Session</strong>
                        <span className="settings-path" title={harness.sessionId}>{harness.sessionId}</span>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="settings-section">
                  <h2>Interface surface</h2>
                  {SURFACE_OPTIONS.map((option) => (
                    <div className="settings-row" key={option.surface}>
                      <div>
                        <strong>{option.label}</strong>
                        <span>{option.hint}</span>
                      </div>
                      <button
                        className={`settings-button ${surface === option.surface ? 'active' : ''}`}
                        onClick={() => void changeSurface(option.surface)}
                      >
                        {surface === option.surface ? 'Active' : 'Switch'}
                      </button>
                    </div>
                  ))}
                </section>

                <section className="settings-section">
                  <h2>Browser</h2>
                  <div className="settings-row">
                    <div>
                      <strong>Agent browser</strong>
                      <span>Controls the visible browser pane</span>
                    </div>
                    <span className={`bridge-pill ${browser?.agentBrowser ?? 'binding'}`}>
                      <span />
                      {browser?.agentBrowser === 'ready'
                        ? 'Linked'
                        : browser?.agentBrowser === 'unavailable'
                          ? 'Offline'
                          : 'Linking'}
                    </span>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>CDP port</strong>
                      <span>Loopback debugging endpoint</span>
                    </div>
                    <span className="settings-value">{browser?.cdpPort ?? '—'}</span>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Current page</strong>
                      <span className="settings-path" title={browser?.url}>{browser?.url ?? 'No page'}</span>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <h2>About</h2>
                  <div className="settings-row">
                    <div>
                      <strong>Version</strong>
                      <span>{appInfo ? `${appInfo.name} ${appInfo.version}` : 'Loading…'}</span>
                    </div>
                    <span className="settings-value">{appInfo?.platform ?? '—'}</span>
                  </div>
                  <div className="settings-row">
                    <div>
                      <strong>Project root</strong>
                      <span className="settings-path" title={appInfo?.projectRoot}>
                        {appInfo?.projectRoot || '—'}
                      </span>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <section className="settings-section">
                <h2>Appearance</h2>
                <div className="settings-row">
                  <div>
                    <strong>Theme</strong>
                    <span>Follows your OS, or pin light or dark.</span>
                  </div>
                  <div className="theme-segmented" role="radiogroup" aria-label="Theme">
                    {THEME_OPTIONS.map(({ mode, label, Icon }) => (
                      <button
                        key={mode}
                        role="radio"
                        aria-checked={theme?.mode === mode}
                        aria-label={label}
                        title={label}
                        className={theme?.mode === mode ? 'active' : ''}
                        onClick={() => onSelectTheme(mode)}
                      >
                        <Icon />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
