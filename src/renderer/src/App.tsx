import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { BrowserState, DshViewState, DshSurface, HarnessStatus, SurfaceState, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { ActivityRail } from './components/ActivityRail'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { DshPane } from './components/DshPane'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CloseIcon, FileIcon, SparkIcon } from './components/Icons'
import { RightSidebarToggle } from './components/RightSidebarToggle'
import { StatusBar } from './components/StatusBar'
import { ThemeToggle } from './components/ThemeToggle'
import type { CenterView } from './lib/types'

// Settings is only needed on demand, so it loads as its own chunk.
const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

// Path routing only makes sense over http(s) — the packaged app loads from a
// file:// URL, where pushState would corrupt the load path.
const URL_ROUTING = typeof window !== 'undefined' && window.location.protocol.startsWith('http')

function viewFromPath(): CenterView {
  if (!URL_ROUTING) return 'browser'
  const path = window.location.pathname
  if (path === '/settings' || path.endsWith('/settings')) return 'settings'
  return 'browser'
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null)
  const [dshView, setDshView] = useState<DshViewState | null>(null)
  const [surface, setSurface] = useState<DshSurface>('dsh')
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [centerView, setCenterView] = useState<CenterView>(viewFromPath)
  const [externalPrompt, setExternalPrompt] = useState<{ id: string; text: string } | null>(null)
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.ndDsh.workspace.state().then(setWorkspace),
      window.ndDsh.browser.state().then(setBrowserState),
      window.ndDsh.harness.status().then(setHarnessStatus),
      window.ndDsh.surface.state().then((state) => {
        setSurface(state.surface)
        setDshView(state.view)
        setCenterView((current) => (current === 'browser' && state.surface === 'dsh' ? 'dsh' : current))
      }),
    ]).catch((cause) => setToast(errorMessage(cause)))
    const offBrowser = window.ndDsh.browser.onState(setBrowserState)
    const offHarness = window.ndDsh.harness.onStatus(setHarnessStatus)
    const offDshView = window.ndDsh.dshView.onState(setDshView)
    const offSurface = window.ndDsh.surface.onChanged((state: SurfaceState) => {
      setSurface(state.surface)
      setDshView(state.view)
      setCenterView(state.surface === 'dsh' ? 'dsh' : 'browser')
    })
    return () => {
      offBrowser()
      offHarness()
      offDshView()
      offSurface()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 5000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let mounted = true
    void window.ndDsh.theme.state()
      .then((state) => { if (mounted) setTheme(state) })
      .catch((cause) => setToast(errorMessage(cause)))
    const offTheme = window.ndDsh.theme.onChanged(setTheme)
    return () => {
      mounted = false
      offTheme()
    }
  }, [])

  useEffect(() => {
    if (!theme) return
    document.documentElement.dataset.theme = theme.effective
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme.effective)
  }, [theme])

  const selectTheme = (mode: ThemeMode): void => {
    void window.ndDsh.theme.set(mode).then(setTheme).catch((cause) => setToast(errorMessage(cause)))
  }

  // Keep the address bar in sync with the active view (pushState never reloads).
  useEffect(() => {
    if (!URL_ROUTING) return
    const target = centerView === 'settings' ? '/settings' : '/'
    if (window.location.pathname !== target) window.history.pushState(null, '', target)
  }, [centerView])

  useEffect(() => {
    if (!URL_ROUTING) return
    const onPopState = (): void => {
      setCenterView((current) => (current === viewFromPath() ? current : viewFromPath()))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const askAgent = (prompt: string): void => {
    // The chat panel owns the active thread; a selection-menu prompt jumps to
    // the workbench surface where that panel lives.
    setExternalPrompt({ id: crypto.randomUUID(), text: prompt })
    if (surface === 'dsh') {
      void window.ndDsh.surface.set('workbench').catch((cause) => setToast(errorMessage(cause)))
    }
    setCenterView('browser')
  }

  const fileName = useMemo(() => selectedFile?.relativePath.split(/[\\/]/).at(-1), [selectedFile?.relativePath])

  const settingsMode = centerView === 'settings'
  const dshMode = surface === 'dsh'

  const openFile = async (path: string): Promise<void> => {
    try {
      setSelectedFile(await window.ndDsh.workspace.read(path))
      setCenterView('editor')
    } catch (cause) {
      setToast(errorMessage(cause))
    }
  }

  return (
    <div className="app-shell">
      <header className="title-bar">
        <div className="title-brand"><span className="mini-logo">ND</span><strong>nd-dsh</strong><span className="title-separator">/</span><span>{workspace?.name ?? 'workspace'}</span></div>
        <div className="title-command">One engine · DeepSeek UI + ND-DSH workbench</div>
        <div className="title-state">
          {!settingsMode ? <RightSidebarToggle isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed((current) => !current)} /> : null}
          <ThemeToggle theme={theme} onSelect={selectTheme} /><span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />{harnessStatus?.model ?? 'DeepSeek'}</div>
      </header>
      <main className={`workbench ${settingsMode ? 'settings-only' : ''} ${rightCollapsed && !settingsMode ? 'chat-collapsed' : ''}`}>
        {!settingsMode && !dshMode ? (
          <aside className="chat-rail">
            <ChatPanel
              status={harnessStatus}
              {...(workspace?.name ? { workspaceName: workspace.name } : {})}
              onError={setToast}
              onOpenSettings={() => setCenterView('settings')}
              onOpenFile={(path) => void openFile(path)}
              externalPrompt={externalPrompt}
              onExternalPromptConsumed={() => setExternalPrompt(null)}
            />
          </aside>
        ) : null}
        <section className="center-workspace">
          <div className="center-tabs">
            <button className={`center-tab ${centerView === 'dsh' ? 'active' : ''}`} onClick={() => setCenterView('dsh')}>
              <SparkIcon /><span>DeepSeek</span><span className={`tab-dot ${dshView?.ready ? 'ready' : 'binding'}`} />
            </button>
            {selectedFile ? (
              <button className={`center-tab ${centerView === 'editor' ? 'active' : ''}`} onClick={() => setCenterView('editor')}>
                <FileIcon /><span>{fileName}</span><CloseIcon className="tab-close" />
              </button>
            ) : null}
            <button className={`center-tab ${centerView === 'browser' ? 'active' : ''}`} onClick={() => setCenterView('browser')}>
              <BrowserIcon /><span>Browser</span><span className={`tab-dot ${browserState?.agentBrowser ?? 'binding'}`} />
            </button>
          </div>
          <div className="center-content">
            <div className={centerView === 'dsh' ? 'view-layer active' : 'view-layer'}>
              <DshPane active={centerView === 'dsh'} state={dshView} onError={setToast} />
            </div>
            <div className={centerView === 'editor' ? 'view-layer active' : 'view-layer'}>
              <EditorPane
                file={selectedFile}
                onAgentPrompt={askAgent}
                onError={setToast}
              />
            </div>
            <div className={centerView === 'browser' ? 'view-layer active' : 'view-layer'}>
              <BrowserPane
                active={centerView === 'browser'}
                state={browserState}
                onSnapshot={() => undefined}
                onError={setToast}
              />
            </div>
            <div className={centerView === 'settings' ? 'view-layer active' : 'view-layer'}>
              <Suspense fallback={<div className="view-loading"><div className="placeholder-ring" /></div>}>
                <SettingsPane
                  theme={theme}
                  onSelectTheme={selectTheme}
                  workspace={workspace}
                  onWorkspaceChanged={(next) => { setWorkspace(next); setSelectedFile(null) }}
                  harness={harnessStatus}
                  browser={browserState}
                  surface={surface}
                  onSurfaceChanged={(next) => { setSurface(next) }}
                  onError={setToast}
                />
              </Suspense>
            </div>
          </div>
        </section>
        {!settingsMode ? (
          <aside className={rightCollapsed ? 'explorer-rail collapsed' : 'explorer-rail'}>
            <Explorer
              workspace={workspace}
              selectedPath={selectedFile?.relativePath}
              onWorkspaceChanged={(next) => { setWorkspace(next); setSelectedFile(null) }}
              onOpenFile={(path) => void openFile(path)}
            />
          </aside>
        ) : null}
      </main>
      <StatusBar browser={browserState} harness={harnessStatus} workspace={workspace} surface={surface} />
      {toast ? <div className="toast" role="alert"><span>{toast}</span><button onClick={() => setToast(undefined)}><CloseIcon /></button></div> : null}
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
