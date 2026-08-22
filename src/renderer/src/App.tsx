import { lazy, Suspense, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { BrowserState, HarnessStatus, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { DesignView } from './components/DesignView'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CloseIcon, FileIcon, SidebarToggleIcon, SparkIcon } from './components/Icons'
import { OrganizationDashboard } from './components/OrganizationDashboard'
import { RuntimePrompts } from './components/RuntimePrompts'
import { StatusBar } from './components/StatusBar'
import { ThemeToggle } from './components/ThemeToggle'
import './styles/design.css'
import './styles/organization.css'
import './styles/product-shell.css'

const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

type ProductView = 'company' | 'agent' | 'design' | 'settings'

type AgentPane = 'files' | 'browser'

const VIEWS: ProductView[] = ['company', 'agent', 'design', 'settings']

function viewFromHash(): ProductView {
  const route = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return VIEWS.includes(route as ProductView) ? (route as ProductView) : 'agent'
}

function hashForView(view: ProductView): string {
  return `#/${view}`
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null)
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [view, setView] = useState<ProductView>(viewFromHash)
  const [agentPane, setAgentPane] = useState<AgentPane>('files')
  const [chatWidth, setChatWidth] = useState(580)
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false)
  const [externalPrompt, setExternalPrompt] = useState<{ id: string; text: string } | null>(null)
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)

  useEffect(() => {
    void Promise.all([
      window.ndDsh.workspace.state().then(setWorkspace),
      window.ndDsh.browser.state().then(setBrowserState),
      window.ndDsh.harness.status().then(setHarnessStatus),
    ]).catch((cause) => setToast(errorMessage(cause)))

    void window.ndDsh.surface.set('workbench').catch((cause) => setToast(errorMessage(cause)))
    void window.ndDsh.dshView.setVisible(false).catch(() => undefined)

    const offWorkspace = window.ndDsh.workspace.onState((next) => {
      setWorkspace(next)
      setSelectedFile(null)
    })
    const offBrowser = window.ndDsh.browser.onState(setBrowserState)
    const offHarness = window.ndDsh.harness.onStatus(setHarnessStatus)
    return () => {
      offWorkspace()
      offBrowser()
      offHarness()
      void window.ndDsh.browser.setVisible(false)
      void window.ndDsh.dshView.setVisible(false)
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

  useEffect(() => {
    const target = hashForView(view)
    if (window.location.hash === target) return
    try {
      window.history.pushState(null, '', target)
    } catch {
      window.location.hash = target
    }
  }, [view])

  useEffect(() => {
    const onPopState = (): void => setView(viewFromHash())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const selectTheme = (mode: ThemeMode): void => {
    void window.ndDsh.theme.set(mode).then(setTheme).catch((cause) => setToast(errorMessage(cause)))
  }

  const changeWorkspace = (next: WorkspaceState): void => {
    setWorkspace(next)
    setSelectedFile(null)
  }

  const openFile = async (path: string): Promise<void> => {
    try {
      setSelectedFile(await window.ndDsh.workspace.read(path))
      setAgentPane('files')
      setView('agent')
    } catch (cause) {
      setToast(errorMessage(cause))
    }
  }

  const startChatResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = chatWidth
    const minWidth = sessionsCollapsed ? 420 : 580
    const onMove = (move: PointerEvent): void => {
      const maxWidth = Math.max(minWidth, window.innerWidth - 480)
      setChatWidth(Math.min(Math.max(minWidth, startWidth + move.clientX - startX), maxWidth))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const askAgent = (prompt: string): void => {
    setExternalPrompt({ id: crypto.randomUUID(), text: prompt })
    setView('agent')
  }

  const navItems: Array<{ id: ProductView; label: string; icon: ReactNode }> = [
    { id: 'company', label: 'Company', icon: <span className="product-nav-monogram">CO</span> },
    { id: 'agent', label: 'Agent', icon: <SparkIcon /> },
    { id: 'design', label: 'Design', icon: <span className="product-nav-monogram">DE</span> },
    { id: 'settings', label: 'Settings', icon: <span className="product-nav-monogram">SE</span> },
  ]

  return (
    <div className="app-shell product-shell">
      <header className="product-titlebar">
        <div className="product-brand">
          <button
            className="titlebar-sidebar-toggle"
            title={sessionsCollapsed ? 'Expand sessions sidebar' : 'Collapse sessions sidebar'}
            onClick={() => setSessionsCollapsed((collapsed) => !collapsed)}
          >
            <SidebarToggleIcon collapsed={sessionsCollapsed} />
          </button>
          <span className="product-logo">ND</span>
          <div>
            <strong>ND-DSH</strong>
            <span>{workspace?.projectName ?? workspace?.name ?? 'No workspace'}</span>
          </div>
        </div>
        <nav className="product-nav" aria-label="ND-DSH navigation">
          <div className="product-nav-main">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="product-runtime">
          {workspace?.binding === 'project' ? <span className="workspace-sync-badge">SYNC</span> : null}
          <ThemeToggle theme={theme} onSelect={selectTheme} />
          <span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />
          <span>{harnessStatus?.model ?? 'Runtime offline'}</span>
          <button
            className="titlebar-sidebar-toggle"
            title={workspaceCollapsed ? 'Expand workspace pane' : 'Collapse workspace pane'}
            onClick={() => setWorkspaceCollapsed((collapsed) => !collapsed)}
          >
            <SidebarToggleIcon collapsed={!workspaceCollapsed} />
          </button>
        </div>
      </header>

      <div className="product-body">
        <main className="product-workspace">
          <section className={`product-view ${view === 'company' ? 'active' : ''}`} aria-hidden={view !== 'company'}>
            <OrganizationDashboard workspace={workspace} onOpenDeepSeek={() => setView('agent')} onError={setToast} />
          </section>

          <section className={`product-view product-agent-view ${view === 'agent' ? 'active' : ''}`} aria-hidden={view !== 'agent'}>
            <div className="agent-split">
              <div className="agent-chat-pane" style={{ width: workspaceCollapsed ? '100%' : chatWidth }}>
                <ChatPanel
                  status={harnessStatus}
                  {...(workspace?.projectName || workspace?.name ? { workspaceName: workspace.projectName ?? workspace.name } : {})}
                  sessionsCollapsed={sessionsCollapsed}
                  onError={setToast}
                  onOpenSettings={() => setView('settings')}
                  onOpenFile={(path) => void openFile(path)}
                  externalPrompt={externalPrompt}
                  onExternalPromptConsumed={() => setExternalPrompt(null)}
                />
              </div>
              {workspaceCollapsed ? null : (
                <>
                  <div
                    className="agent-splitter"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize chat pane"
                    onPointerDown={startChatResize}
                  />
                  <div className="agent-workspace-pane">
                    <div className="agent-pane-tabs" role="tablist" aria-label="Agent workspace panes">
                      <button className={agentPane === 'files' ? 'active' : ''} onClick={() => setAgentPane('files')}>
                        <FileIcon />
                        <span>Files</span>
                      </button>
                      <button className={agentPane === 'browser' ? 'active' : ''} onClick={() => setAgentPane('browser')}>
                        <BrowserIcon />
                        <span>Browser</span>
                      </button>
                    </div>
                    <div className="agent-pane-body">
                      {agentPane === 'files' ? (
                        <div className="product-files-layout">
                          <div className="product-editor-wrap">
                            <EditorPane file={selectedFile} onAgentPrompt={askAgent} onError={setToast} />
                          </div>
                          <Explorer
                            workspace={workspace}
                            selectedPath={selectedFile?.relativePath}
                            onWorkspaceChanged={changeWorkspace}
                            onOpenFile={(path) => void openFile(path)}
                          />
                        </div>
                      ) : (
                        <BrowserPane
                          active={view === 'agent'}
                          state={browserState}
                          onSnapshot={() => setToast('Browser snapshot captured from the live page.')}
                          onError={setToast}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={`product-view ${view === 'design' ? 'active' : ''}`} aria-hidden={view !== 'design'}>
            <DesignView
              active={view === 'design'}
              workspace={workspace}
              browser={browserState}
              harness={harnessStatus}
              onWorkspaceChanged={changeWorkspace}
              onAskAgent={askAgent}
              onError={setToast}
            />
          </section>

          <section className={`product-view ${view === 'settings' ? 'active' : ''}`} aria-hidden={view !== 'settings'}>
            <Suspense fallback={<div className="view-loading"><div className="placeholder-ring" /></div>}>
              <SettingsPane
                theme={theme}
                onSelectTheme={selectTheme}
                workspace={workspace}
                onWorkspaceChanged={changeWorkspace}
                harness={harnessStatus}
                browser={browserState}
                onError={setToast}
              />
            </Suspense>
          </section>
        </main>
      </div>

      <StatusBar browser={browserState} harness={harnessStatus} workspace={workspace} />
      <RuntimePrompts onError={setToast} />
      {toast ? <div className="toast" role="alert"><span>{toast}</span><button onClick={() => setToast(undefined)}><CloseIcon /></button></div> : null}
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
