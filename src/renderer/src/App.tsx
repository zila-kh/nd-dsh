import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { BrowserState, ExternalElementPickView, HarnessStatus, InspectScope, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { DesignView } from './components/DesignView'
import { DiffView } from './components/DiffView'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CameraIcon, CloseIcon, CrosshairIcon, ExternalIcon, FileIcon, MonitorIcon, SidebarToggleIcon, SparkIcon } from './components/Icons'
import { OrganizationDashboard } from './components/OrganizationDashboard'
import { QaView } from './components/QaView'
import { RuntimePrompts } from './components/RuntimePrompts'
import { ThemeToggle } from './components/ThemeToggle'
import './styles/design.css'
import './styles/organization.css'
import './styles/product-shell.css'
import './styles/qa.css'

const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

type ProductView = 'company' | 'agent' | 'design' | 'qa' | 'settings'

type AgentPane = 'files' | 'browser'

const VIEWS: ProductView[] = ['company', 'agent', 'design', 'qa', 'settings']

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
  const [activeDiff, setActiveDiff] = useState<{ relativePath: string; staged: boolean } | null>(null)
  const [view, setView] = useState<ProductView>(viewFromHash)
  const [agentPane, setAgentPane] = useState<AgentPane>('files')
  const [chatWidth, setChatWidth] = useState(580)
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false)
  const [externalPrompt, setExternalPrompt] = useState<{ id: string; text: string } | null>(null)
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)
  const [appInspectCountdown, setAppInspectCountdown] = useState<number | null>(null)
  const [appInspectInFlight, setAppInspectInFlight] = useState(false)
  const [elementInspectActive, setElementInspectActive] = useState(false)
  const [inspectScope, setInspectScope] = useState<InspectScope>('external')
  const [pendingPick, setPendingPick] = useState<{ element: ExternalElementPickView; targetTitle: string; shortName: string; hover: string } | null>(null)
  const [elementAttachmentVersion, setElementAttachmentVersion] = useState(0)
  const appInspectTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  // Cross-app inspect: after a short countdown (so the user can focus the
  // target app), the trusted main process captures the screen, bridges the
  // screenshot into the ND chat session, and copies it to the clipboard.
  // In 'self' scope there is nothing to switch to, so capture immediately.
  const startAppInspect = (): void => {
    if (appInspectCountdown !== null || appInspectInFlight) return
    const selfScope = inspectScope === 'self'
    let remaining = 3
    if (!selfScope) setAppInspectCountdown(remaining)
    const fire = (): void => {
      setAppInspectInFlight(true)
      void window.ndDsh.capture.inspectApp(true, inspectScope)
        .then((result) => setToast(result.copiedToClipboard
          ? `Screenshot of ${selfScope ? 'this app' : 'the screen'} sent to the agent and copied to the clipboard.`
          : `Screenshot of ${selfScope ? 'this app' : 'the screen'} sent to the agent.`))
        .catch((cause) => setToast(errorMessage(cause)))
        .finally(() => setAppInspectInFlight(false))
    }
    if (selfScope) {
      fire()
      return
    }
    appInspectTimer.current = setInterval(() => {
      remaining -= 1
      if (remaining > 0) {
        setAppInspectCountdown(remaining)
        return
      }
      clearInterval(appInspectTimer.current)
      appInspectTimer.current = undefined
      setAppInspectCountdown(null)
      fire()
    }, 1_000)
  }

  useEffect(() => () => {
    if (appInspectTimer.current !== undefined) clearInterval(appInspectTimer.current)
  }, [])

  // Keyboard accelerators for the two inspect entry points.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (key === 'e') {
        event.preventDefault()
        startElementInspect()
      } else if (key === 'c') {
        event.preventDefault()
        startAppInspect()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // Element-level inspect: in 'external' scope the picker is injected into
  // an external Electron app over its loopback debug port; in 'self' scope
  // it runs inside this app's own renderer. The picked element is offered
  // as an Add-to-chat chip (multiple chips can queue before one prompt).
  const startElementInspect = (): void => {
    if (elementInspectActive) return
    setElementInspectActive(true)
    void window.ndDsh.capture.inspectElement(inspectScope)
      .then((result) => {
        if (result.outcome === 'picked' && result.element && result.targetTitle && result.shortName && result.hover) {
          setPendingPick({
            element: result.element,
            targetTitle: result.targetTitle,
            shortName: result.shortName,
            hover: result.hover,
          })
        } else if (result.outcome === 'canceled') {
          setToast('Element pick canceled.')
        } else {
          setToast(result.message ?? 'No external app debug port found.')
        }
      })
      .catch((cause) => setToast(errorMessage(cause)))
      .finally(() => setElementInspectActive(false))
  }

  const addElementToChat = async (): Promise<void> => {
    const pick = pendingPick
    if (!pick) return
    try {
      await window.ndDsh.capture.stageElement(pick.element, pick.targetTitle)
      setPendingPick(null)
      setElementAttachmentVersion((version) => version + 1)
    } catch (cause) {
      setToast(errorMessage(cause))
    }
  }

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
      setActiveDiff(null)
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
    setActiveDiff(null)
  }

  const openFile = async (path: string): Promise<void> => {
    try {
      setSelectedFile(await window.ndDsh.workspace.read(path))
      setActiveDiff(null)
      setAgentPane('files')
      setView('agent')
    } catch (cause) {
      setToast(errorMessage(cause))
    }
  }

  const openDiff = (relativePath: string, staged: boolean): void => {
    setActiveDiff({ relativePath, staged })
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
    { id: 'qa', label: 'QA', icon: <span className="product-nav-monogram">QA</span> },
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
          <button
            className={`titlebar-sidebar-toggle ${inspectScope === 'self' ? 'scope-active' : ''}`}
            title={inspectScope === 'external'
              ? 'Inspect target: external apps — the camera captures the screen, the crosshair needs a debug port. Click to target this ND-DSH app instead.'
              : 'Inspect target: this ND-DSH app — the camera captures this window, the crosshair picks elements here. Click to target external apps instead.'}
            onClick={() => setInspectScope((scope) => (scope === 'external' ? 'self' : 'external'))}
          >
            {inspectScope === 'external' ? <ExternalIcon /> : <MonitorIcon />}
          </button>
          <button
            className="titlebar-sidebar-toggle"
            title={inspectScope === 'external'
              ? 'Inspect any app (Ctrl+Alt+C) — captures the screen in 3s, sends it to the ND chat agent, and copies it to the clipboard'
              : 'Inspect this app (Ctrl+Alt+C) — captures this ND-DSH window, sends it to the ND chat agent, and copies it to the clipboard'}
            disabled={appInspectCountdown !== null || appInspectInFlight}
            onClick={startAppInspect}
          >
            <CameraIcon />
          </button>
          <button
            className="titlebar-sidebar-toggle"
            title={inspectScope === 'external'
              ? 'Inspect an element in an external Electron app (Ctrl+Alt+E) — launch it with --remote-debugging-port=9333, pick the element there, then Add to chat'
              : 'Inspect an element in this app (Ctrl+Alt+E) — hover and click any element in ND-DSH, then Add to chat'}
            disabled={elementInspectActive}
            onClick={startElementInspect}
          >
            <CrosshairIcon />
          </button>
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
                  elementAttachmentVersion={elementAttachmentVersion}
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
                            {activeDiff ? (
                              <DiffView
                                relativePath={activeDiff.relativePath}
                                staged={activeDiff.staged}
                                onClose={() => setActiveDiff(null)}
                                onError={setToast}
                              />
                            ) : (
                              <EditorPane file={selectedFile} onAgentPrompt={askAgent} onError={setToast} />
                            )}
                          </div>
                          <Explorer
                            workspace={workspace}
                            selectedPath={selectedFile?.relativePath}
                            onWorkspaceChanged={changeWorkspace}
                            onOpenFile={(path) => void openFile(path)}
                            onOpenDiff={openDiff}
                            onError={setToast}
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

          <section className={`product-view ${view === 'qa' ? 'active' : ''}`} aria-hidden={view !== 'qa'}>
            <QaView active={view === 'qa'} onError={setToast} />
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

      <RuntimePrompts onError={setToast} />
      {pendingPick ? (
        <div className="element-pick-popover" role="dialog" aria-label="Picked element">
          <div className="element-pick-head" title={pendingPick.hover}>
            <CrosshairIcon />
            <strong>{pendingPick.shortName}</strong>
            <span>{pendingPick.targetTitle}</span>
          </div>
          <div className="element-pick-actions">
            <button type="button" className="toggle-button" onClick={() => void addElementToChat()}>Add to chat</button>
            <button type="button" className="toggle-button" onClick={() => setPendingPick(null)}>Discard</button>
          </div>
        </div>
      ) : appInspectCountdown !== null ? (
        <div className="toast" role="status">
          <span>{`Screen capture in ${appInspectCountdown}s — switch to the app you want to inspect`}</span>
        </div>
      ) : elementInspectActive ? (
        <div className="toast" role="status">
          <span>{inspectScope === 'self'
            ? 'Element picker active — click any element in this ND-DSH window (Esc cancels)'
            : 'Element picker active — switch to your Electron app and click an element (Esc cancels)'}</span>
        </div>
      ) : toast ? <div className="toast" role="alert"><span>{toast}</span><button onClick={() => setToast(undefined)}><CloseIcon /></button></div> : null}
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
