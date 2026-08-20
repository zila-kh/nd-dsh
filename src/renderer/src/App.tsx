import { useEffect, useMemo, useState } from 'react'
import type { BrowserState, HarnessNotification, HarnessStatus, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import { ActivityRail } from './components/ActivityRail'
import { BrowserPane } from './components/BrowserPane'
import { ChatPanel } from './components/ChatPanel'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CloseIcon, FileIcon } from './components/Icons'
import { StatusBar } from './components/StatusBar'
import { ThemeToggle } from './components/ThemeToggle'
import type { CenterView, ChatMessage } from './lib/types'

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'The desktop shell is ready. I can work in the selected folder and control the exact built-in browser through Browser MCP.',
  },
]

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null)
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [centerView, setCenterView] = useState<CenterView>('browser')
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [notifications, setNotifications] = useState<string[]>([])
  const [toast, setToast] = useState<string>()
  const [theme, setTheme] = useState<ThemeState | null>(null)

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

  const fileName = useMemo(() => selectedFile?.relativePath.split(/[\\/]/).at(-1), [selectedFile?.relativePath])

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
        <div className="title-state"><ThemeToggle theme={theme} onSelect={selectTheme} /><span className={`tiny-dot ${harnessStatus?.state ?? 'stopped'}`} />{harnessStatus?.model ?? 'DeepSeek'}</div>
      </header>
      <main className="workbench">
        <ActivityRail browserActive={centerView === 'browser'} onBrowser={() => setCenterView('browser')} />
        <Explorer
          workspace={workspace}
          selectedPath={selectedFile?.relativePath}
          onWorkspaceChanged={(next) => { setWorkspace(next); setSelectedFile(null) }}
          onOpenFile={(path) => void openFile(path)}
        />
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
            <div className={centerView === 'editor' ? 'view-layer active' : 'view-layer'}><EditorPane file={selectedFile} /></div>
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
          </div>
        </section>
        <ChatPanel
          status={harnessStatus}
          notifications={notifications}
          messages={messages}
          onMessages={setMessages}
          onError={setToast}
        />
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
