import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { BrowserState, HarnessStatus, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CloseIcon, FileIcon, SparkIcon } from './components/Icons'
import { OrganizationDashboard } from './components/OrganizationDashboard'
import { RuntimePrompts } from './components/RuntimePrompts'
import { StatusBar } from './components/StatusBar'
import { ThemeToggle } from './components/ThemeToggle'
import './styles/organization.css'
import './styles/product-shell.css'

const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

type ProductView = 'company' | 'agent' | 'files' | 'browser' | 'settings'

const URL_ROUTING = typeof window !== 'undefined' && window.location.protocol.startsWith('http')

function viewFromPath(): ProductView {
  if (!URL_ROUTING) return 'company'
  const path = window.location.pathname
  if (path === '/agent' || path.endsWith('/agent')) return 'agent'
  if (path === '/files' || path.endsWith('/files')) return 'files'
  if (path === '/browser' || path.endsWith('/browser')) return 'browser'
  if (path === '/settings' || path.endsWith('/settings')) return 'settings'
  return 'company'
}

function pathForView(view: ProductView): string {
  return view === 'company' ? '/' : `/${view}`
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null)
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [view, setView] = useState<ProductView>(viewFromPath)
  const [externalPrompt, setExternalPrompt] = useState<{ id: string; text: string } | null>(null)
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)

  useEffect(() => {
    void Promise.all([
      window.ndDsh.workspace.state().then(setWorkspace),
      window.ndDsh.browser.state().then(setBrowserState),
      window.ndDsh.harness.status().then(setHarnessStatus),
    ]).catch((cause) => setToast(errorMessage(cause)))

    // ND-DSH owns the renderer surface. The legacy Harness web UI remains
    // available as runtime infrastructure but is never presented as a product.
    void window.ndDsh.surface.set('workbench').catch((cause) => setToast(errorMessage(cause)))
    void window.ndDsh.dshView.setVisible(false).catch(() => undefined)

    const offBrowser = window.ndDsh.browser.onState(setBrowserState)
    const offHarness = window.ndDsh.harness.onStatus(setHarnessStatus)
    return () => {
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
    if (!URL_ROUTING) return
    const target = pathForView(view)
    if (window.location.pathname !== target) window.history.pushState(null, '', target)
  }, [view])

  useEffect(() => {
    if (!URL_ROUTING) return
    const onPopState = (): void => setView(viewFromPath())
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
      setView('files')
    } catch (cause) {
      setToast(errorMessage(cause))
    }
  }

  const askAgent = (prompt: string): void => {
    setExternalPrompt({ id: crypto.randomUUID(), text: prompt })
    setView('agent')
  }

  const navItems: Array<{ id: ProductView; label: string; icon: ReactNode }> = [
    { id: 'company', label: 'Company', icon: <span className="product-nav-monogram">CO</span> },
    { id: 'agent', label: 'Agent', icon: <SparkIcon /> },
    { id: 'files', label: 'Files', icon: <FileIcon /> },
    { id: 'browser', label: 'Browser', icon: <BrowserIcon /> },
    { id: 'settings', label: 'Settings', icon: <span className="product-nav-monogram">SE</span> },
  ]

  return (
    <div className="app-shell product-shell">
      <header className="product-titlebar">
        <div className="product-brand">
          <span className="product-logo">ND</span>
          <div>
            <strong>ND-DSH</strong>
            <span>{workspace?.name ?? 'No workspace'}</span>
          </div>
        </div>
        <div className="product-title-center">
          <span>AI Company Operating System</span>
          <small>{viewLabel(view)}</small>
        </div>
        <div className="product-runtime">
          <ThemeToggle theme={theme} onSelect={selectTheme} />
          <span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />
          <span>{harnessStatus?.model ?? 'Runtime offline'}</span>
        </div>
      </header>

      <div className="product-body">
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
          <div className="product-nav-runtime" title={harnessStatus?.error}>
            <span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />
            <small>{harnessStatus?.state ?? 'stopped'}</small>
          </div>
        </nav>

        <main className="product-workspace">
          <section className={`product-view ${view === 'company' ? 'active' : ''}`} aria-hidden={view !== 'company'}>
            <OrganizationDashboard workspace={workspace} onOpenDeepSeek={() => setView('agent')} onError={setToast} />
          </section>

          <section className={`product-view product-agent-view ${view === 'agent' ? 'active' : ''}`} aria-hidden={view !== 'agent'}>
            <ChatPanel
              status={harnessStatus}
              {...(workspace?.name ? { workspaceName: workspace.name } : {})}
              onError={setToast}
              onOpenSettings={() => setView('settings')}
              onOpenFile={(path) => void openFile(path)}
              externalPrompt={externalPrompt}
              onExternalPromptConsumed={() => setExternalPrompt(null)}
            />
          </section>

          <section className={`product-view ${view === 'files' ? 'active' : ''}`} aria-hidden={view !== 'files'}>
            <div className="product-files-layout">
              <Explorer
                workspace={workspace}
                selectedPath={selectedFile?.relativePath}
                onWorkspaceChanged={changeWorkspace}
                onOpenFile={(path) => void openFile(path)}
              />
              <div className="product-editor-wrap">
                <EditorPane file={selectedFile} onAgentPrompt={askAgent} onError={setToast} />
              </div>
            </div>
          </section>

          <section className={`product-view product-browser-view ${view === 'browser' ? 'active' : ''}`} aria-hidden={view !== 'browser'}>
            <BrowserPane
              active={view === 'browser'}
              state={browserState}
              onSnapshot={() => setToast('Browser snapshot captured from the live page.')}
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

function viewLabel(view: ProductView): string {
  if (view === 'company') return 'Company command center'
  if (view === 'agent') return 'Agent console'
  if (view === 'files') return 'Workspace files'
  if (view === 'browser') return 'Agent browser'
  return 'Settings'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
