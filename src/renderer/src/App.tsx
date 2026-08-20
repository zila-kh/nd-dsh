import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { BrowserState, HarnessNotification, HarnessStatus, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { ActivityRail } from './components/ActivityRail'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CloseIcon, FileIcon } from './components/Icons'
import { RightSidebarToggle } from './components/RightSidebarToggle'
import { StatusBar } from './components/StatusBar'
import { ThemeToggle } from './components/ThemeToggle'
import type { CenterView, ChatMessage } from './lib/types'

// Settings is only needed on demand, so it loads as its own chunk.
const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'The desktop shell is ready. I can work in the selected folder and control the exact built-in browser through Browser MCP.',
  },
]

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
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [centerView, setCenterView] = useState<CenterView>(viewFromPath)
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [notifications, setNotifications] = useState<string[]>([])
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.ndDsh.workspace.state().then(setWorkspace),
      window.ndDsh.browser.state().then(setBrowserState),
      window.ndDsh.harness.status().then(setHarnessStatus),
    ]).catch((cause) => setToast(errorMessage(cause)))
    const offBrowser = window.ndDsh.browser.onState(setBrowserState)
    const offHarness = window.ndDsh.harness.onStatus(setHarnessStatus)
    const offNotification = window.ndDsh.harness.onNotification((notification: HarnessNotification) => {
      setNotifications((current) => [...current.slice(-49), summarizeNotification(notification)])
    })
    return () => {
      offBrowser()
      offHarness()
      offNotification()
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

  const askAgent = async (prompt: string): Promise<void> => {
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: prompt }
    const next = [...messages, userMessage]
    setMessages(next)
    try {
      const result = await window.ndDsh.harness.run(prompt)
      setMessages([
        ...next,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.finalResponse || 'The Harness completed without a text response.',
          detail: `${result.eventCount} events · ${result.notificationCount} notifications`,
        },
      ])
    } catch (cause) {
      const message = errorMessage(cause)
      setMessages([...next, { id: crypto.randomUUID(), role: 'system', content: message }])
      setToast(message)
    }
  }

  const fileName = useMemo(() => selectedFile?.relativePath.split(/[\\/]/).at(-1), [selectedFile?.relativePath])

  const settingsMode = centerView === 'settings'

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
        <div className="title-command">Search files, commands, and sessions <kbd>⌘ K</kbd></div>
        <div className="title-state">
          {!settingsMode ? <RightSidebarToggle isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed((current) => !current)} /> : null}
          <ThemeToggle theme={theme} onSelect={selectTheme} /><span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />{harnessStatus?.model ?? 'DeepSeek'}</div>
      </header>
      <main className={`workbench ${settingsMode ? 'settings-only' : ''} ${rightCollapsed && !settingsMode ? 'chat-collapsed' : ''}`}>
        {!settingsMode ? (
          <ActivityRail
            browserActive={centerView === 'browser'}
            settingsActive={settingsMode}
            onBrowser={() => setCenterView('browser')}
            onSettings={() => setCenterView('settings')}
          />
        ) : null}
        {!settingsMode ? (
          <Explorer
            workspace={workspace}
            selectedPath={selectedFile?.relativePath}
            onWorkspaceChanged={(next) => { setWorkspace(next); setSelectedFile(null) }}
            onOpenFile={(path) => void openFile(path)}
          />
        ) : null}
        <section className="center-workspace">
          <div className="center-tabs">
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
            <div className={centerView === 'editor' ? 'view-layer active' : 'view-layer'}>
              <EditorPane
                file={selectedFile}
                onAgentPrompt={(prompt) => void askAgent(prompt)}
                onError={setToast}
              />
            </div>
            <div className={centerView === 'browser' ? 'view-layer active' : 'view-layer'}>
              <BrowserPane
                active={centerView === 'browser'}
                state={browserState}
                onSnapshot={(snapshot) => {
                  const preview = snapshot.length > 500 ? `${snapshot.slice(0, 500)}…` : snapshot
                  setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'system', content: `Browser snapshot\n${preview}` }])
                }}
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
                  onError={setToast}
                />
              </Suspense>
            </div>
          </div>
        </section>
        {!settingsMode ? (
          <aside className={rightCollapsed ? 'chat-rail collapsed' : 'chat-rail'}>
            <div className="chat-toggle-strip">
              <RightSidebarToggle isCollapsed={rightCollapsed} onToggle={() => setRightCollapsed((current) => !current)} />
            </div>
            <ChatPanel
              status={harnessStatus}
              notifications={notifications}
              messages={messages}
              onMessages={setMessages}
              onError={setToast}
            />
          </aside>
        ) : null}
      </main>
      <StatusBar browser={browserState} harness={harnessStatus} workspace={workspace} />
      {toast ? <div className="toast" role="alert"><span>{toast}</span><button onClick={() => setToast(undefined)}><CloseIcon /></button></div> : null}
    </div>
  )
}

function summarizeNotification(notification: HarnessNotification): string {
  const params = notification.params
  if (params && typeof params === 'object') {
    const sessionId = (params as Record<string, unknown>).sessionId
    if (typeof sessionId === 'string') return `${notification.method} · ${sessionId.slice(0, 8)}`
  }
  return notification.method
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
