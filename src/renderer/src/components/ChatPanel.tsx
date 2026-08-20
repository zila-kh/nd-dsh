import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { HarnessStatus, ModelProvider, WorkspaceState } from '../../../shared/contracts'
import type { ChatMessage } from '../lib/types'
import {
  ArrowUpIcon,
  BrainIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SidebarToggleIcon,
  SparkIcon,
  SpinnerIcon,
  StopIcon,
  UndoIcon,
} from './Icons'

export interface ChatSession {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
}

interface ChatPanelProps {
  status: HarnessStatus | null
  notifications: string[]
  messages: ChatMessage[]
  workspace?: WorkspaceState | null
  onMessages(messages: ChatMessage[]): void
  onError(message: string): void
  onOpenSettings?(): void
}

const PERMISSION_OPTIONS = ['Full access', 'Read only'] as const
const THOUGHT_OPTIONS = ['Max', 'High', 'Medium', 'Low', 'Off'] as const

const INITIAL_SESSIONS: ChatSession[] = [
  {
    id: 'session-eval',
    title: 'You are being evaluated in',
    updatedAt: '39min',
    messages: [
      {
        id: 'welcome-1',
        role: 'assistant',
        content: 'The desktop shell is ready. I can work in the selected folder and control the exact built-in browser through Browser MCP.',
      },
    ],
  },
  {
    id: 'session-ui',
    title: 'UI Layout & Compact Actions',
    updatedAt: '12min',
    messages: [
      {
        id: 'welcome-2',
        role: 'assistant',
        content: 'Updated workbench layout with left chat sidebar and right explorer panel.',
      },
    ],
  },
  {
    id: 'session-models',
    title: 'Model Provider & Settings',
    updatedAt: '2min',
    messages: [
      {
        id: 'welcome-3',
        role: 'assistant',
        content: 'DeepSeek provider configured with flash and pro models.',
      },
    ],
  },
]

export function ChatPanel({ status, notifications, messages, workspace, onMessages, onError, onOpenSettings }: ChatPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [permissionMode, setPermissionMode] = useState<(typeof PERMISSION_OPTIONS)[number]>('Full access')
  const [thoughtLevel, setThoughtLevel] = useState<(typeof THOUGHT_OPTIONS)[number]>('Max')

  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [thoughtMenuOpen, setThoughtMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)

  const [sessions, setSessions] = useState<ChatSession[]>(INITIAL_SESSIONS)
  const [activeSessionId, setActiveSessionId] = useState<string>('session-eval')
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)

  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('deepseek')
  const [selectedModelId, setSelectedModelId] = useState<string>('deepseek-v4-flash')

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const busy = status?.state === 'running' || status?.state === 'starting'

  useEffect(() => {
    window.ndDsh.providers
      .list()
      .then((list) => {
        setProviders(list)
        if (list.length > 0) {
          const enabled = list.find((p) => p.enabled) ?? list[0]
          if (enabled) {
            setSelectedProviderId(enabled.id)
            if (enabled.models && enabled.models.length > 0 && enabled.models[0]) {
              setSelectedModelId(enabled.models[0].id)
            }
          }
        }
      })
      .catch(() => {
        setProviders([
          {
            id: 'deepseek',
            name: 'deepseek',
            enabled: true,
            baseUrl: 'https://api.deepseek.com',
            apiFormat: 'Chat completions (/chat/completions)',
            apiKey: '',
            models: [
              { id: 'deepseek-v4-flash', context: '1M' },
              { id: 'deepseek-v4-pro', context: '1M' },
            ],
          },
        ])
      })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, notifications.length])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
        setPermissionMenuOpen(false)
        setThoughtMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const handleSelectSession = (session: ChatSession) => {
    setActiveSessionId(session.id)
    onMessages(session.messages)
  }

  const handleNewSession = () => {
    const newId = `session-${Date.now()}`
    const newSession: ChatSession = {
      id: newId,
      title: 'New Chat Thread',
      updatedAt: 'Just now',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'New session started. How can I help you with your codebase today?',
        },
      ],
    }
    setSessions([newSession, ...sessions])
    setActiveSessionId(newId)
    onMessages(newSession.messages)
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0]

  const run = async (): Promise<void> => {
    const input = prompt.trim()
    if (!input || busy) return
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input }
    const nextMessages = [...messages, userMessage]
    onMessages(nextMessages)
    setPrompt('')

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSessionId
          ? {
              ...s,
              title: s.title === 'New Chat Thread' ? input.slice(0, 32) : s.title,
              updatedAt: 'Just now',
              messages: nextMessages,
            }
          : s,
      ),
    )

    try {
      const result = await window.ndDsh.harness.run(input)
      const finalNextMessages: ChatMessage[] = [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.finalResponse || 'The Harness completed without a text response.',
          detail: `${result.eventCount} events · ${result.notificationCount} notifications`,
        },
      ]
      onMessages(finalNextMessages)
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSessionId ? { ...s, messages: finalNextMessages } : s)),
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const errorMessages: ChatMessage[] = [...nextMessages, { id: crypto.randomUUID(), role: 'system', content: message }]
      onMessages(errorMessages)
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, messages: errorMessages } : s)))
      onError(message)
    }
  }

  const stop = async (): Promise<void> => {
    try {
      await window.ndDsh.harness.stop()
      const next: ChatMessage[] = [
        ...messages,
        { id: crypto.randomUUID(), role: 'system', content: 'Harness runtime stopped. The next prompt starts a fresh session.' },
      ]
      onMessages(next)
      setSessions((prev) => prev.map((s) => (s.id === activeSessionId ? { ...s, messages: next } : s)))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || providers[0]

  return (
    <div className="chat-dual-sidebar-wrap">
      {/* Sidebar 1: Chat Sessions Management Sidebar */}
      <aside className={`chat-sessions-sidebar ${sessionsCollapsed ? 'collapsed' : ''}`}>
        <header className="chat-heading">
          <div className="brand-title-group">
            <SparkIcon className="logo-spark" />
            <strong className="brand-name">deepseek</strong>
            <span className="harness-tag">HARNESS</span>
          </div>
          <button
            className="sidebar-toggle-btn"
            title={sessionsCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setSessionsCollapsed(!sessionsCollapsed)}
          >
            <SidebarToggleIcon collapsed={sessionsCollapsed} />
          </button>
        </header>

        <div className="session-action-container">
          <button className="new-session-btn" onClick={handleNewSession}>
            <PlusIcon className="plus-icon" />
            <span>New Session</span>
          </button>
        </div>

        <div className="workspaces-section">
          <div className="workspaces-header">
            <span className="section-label">Workspaces</span>
            <div className="section-actions">
              <button className="settings-cta-btn" title="Search workspaces">
                <SearchIcon />
              </button>
              {onOpenSettings ? (
                <button className="settings-cta-btn" onClick={onOpenSettings} title="Settings">
                  <SettingsIcon />
                </button>
              ) : null}
              <button className="settings-cta-btn" title="Add workspace">
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="workspace-item">
            <FolderIcon className="folder-icon" />
            <span className="workspace-name">{workspace?.name ?? 'Deepseek-harness-test'}</span>
          </div>

          <div className="sessions-list">
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`session-thread-card ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => handleSelectSession(session)}
              >
                <div className="card-left">
                  <span className={`dot-active ${activeSessionId === session.id ? 'on' : 'off'}`} />
                  <ChatIcon className="thread-icon" />
                  <span className="thread-title">{session.title}</span>
                </div>
                <span className="thread-time">{session.updatedAt}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 4. Settings Footer */}
        <footer className="sessions-footer">
          <button className="settings-footer-btn" onClick={onOpenSettings} title="Settings">
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </footer>
      </aside>

      {/* Sidebar 2: Active Chat Thread Pane */}
      <aside className="chat-thread-pane">
        <header className="chat-heading">
          <div className="active-thread-header-info">
            {sessionsCollapsed ? (
              <button
                className="sidebar-toggle-btn expand-btn"
                title="Expand sessions sidebar"
                onClick={() => setSessionsCollapsed(false)}
              >
                <SidebarToggleIcon collapsed={true} />
              </button>
            ) : null}
            <div>
              <span className="eyebrow">ACTIVE THREAD</span>
              <strong>{activeSession?.title ?? 'Chat Thread'}</strong>
            </div>
          </div>
          <span className={`status-orb ${status?.state ?? 'stopped'}`} title={status?.error} />
        </header>

        {!status?.sourceReady ? (
          <div className="setup-card">
            <strong>Harness not built</strong>
            <span>
              Run <code>pnpm bootstrap</code> once.
            </span>
          </div>
        ) : null}
        {status?.sourceReady && !status.apiKeyPresent ? (
          <div className="setup-card warning">
            <strong>API key missing</strong>
            <span>
              Add <code>DEEPSEEK_API_KEY</code> to <code>.env</code>.
            </span>
          </div>
        ) : null}

        {/* File Changes Summary Banner */}
        <div className="diff-changes-banner">
          <div className="banner-left">
            <ChevronRightIcon className="banner-chevron" />
            <span className="banner-title">10 files changed</span>
            <span className="additions">+264</span>
            <span className="deletions">-132</span>
          </div>
          <button className="undo-button" title="Undo last change">
            <UndoIcon />
            <span>Undo</span>
          </button>
        </div>

        {/* Messages Stream */}
        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="message-label">
                {message.role === 'assistant' ? (
                  <>
                    <SparkIcon /> Harness
                  </>
                ) : message.role === 'user' ? (
                  'You'
                ) : (
                  'Runtime'
                )}
              </div>
              <div className="message-content">{message.content}</div>
              {message.detail ? <div className="message-detail">{message.detail}</div> : null}
            </article>
          ))}
          {busy ? (
            <div className="agent-working">
              <span />
              <span />
              <span />
              <em>{status?.state === 'starting' ? 'Starting pinned runtime' : 'Harness is working'}</em>
            </div>
          ) : null}
          {notifications.length > 0 ? (
            <details className="notification-log">
              <summary>Runtime activity · {notifications.length}</summary>
              {notifications.slice(-12).map((item, index) => (
                <div key={`${item}-${index}`}>{item}</div>
              ))}
            </details>
          ) : null}
        </div>

        {/* Enhanced Composer Container */}
        <div className="composer-container" ref={menuRef}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void run()
              }
            }}
            placeholder="Ask for follow-up changes"
            rows={3}
          />

          {/* Bottom Control Bar */}
          <div className="composer-actions-bar">
            <div className="action-group-left">
              <button className="composer-icon-button" title="Add context">
                <PlusIcon />
              </button>

              <div className="menu-anchor">
                <button
                  className="permission-badge"
                  onClick={() => {
                    setPermissionMenuOpen(!permissionMenuOpen)
                    setModelMenuOpen(false)
                    setThoughtMenuOpen(false)
                  }}
                >
                  <ShieldIcon />
                  <span>{permissionMode}</span>
                  <ChevronDownIcon />
                </button>
                {permissionMenuOpen ? (
                  <div className="popover-menu shadow-flyout">
                    {PERMISSION_OPTIONS.map((opt) => (
                      <button
                        key={opt}
                        className={`menu-item ${permissionMode === opt ? 'active' : ''}`}
                        onClick={() => {
                          setPermissionMode(opt)
                          setPermissionMenuOpen(false)
                        }}
                      >
                        {opt}
                        {permissionMode === opt ? <CheckIcon className="check-icon" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="action-group-right">
              {busy ? <SpinnerIcon className="busy-spinner" /> : null}

              <div className="menu-anchor">
                <button
                  className="model-picker-button"
                  title={`${activeProvider?.name ?? selectedProviderId}/${selectedModelId}`}
                  onClick={() => {
                    setModelMenuOpen(!modelMenuOpen)
                    setPermissionMenuOpen(false)
                    setThoughtMenuOpen(false)
                  }}
                >
                  <span className="model-name-text">{`${activeProvider?.name ?? selectedProviderId}/${selectedModelId}`}</span>
                  <ChevronDownIcon />
                </button>

                {modelMenuOpen ? (
                  <div className="popover-menu model-flyout shadow-flyout">
                    {providers.map((p) => (
                      <div
                        key={p.id}
                        className="model-provider-row"
                        onClick={() => {
                          setSelectedProviderId(p.id)
                          if (p.models && p.models.length > 0 && p.models[0]) setSelectedModelId(p.models[0].id)
                          setModelMenuOpen(false)
                        }}
                      >
                        <span>{p.name}</span>
                        <div className="row-end">
                          {selectedProviderId === p.id ? <CheckIcon className="check-icon" /> : null}
                          <ChevronRightIcon />
                        </div>
                      </div>
                    ))}
                    <div className="menu-divider" />
                    <button
                      className="menu-item"
                      onClick={() => {
                        setModelMenuOpen(false)
                        if (onOpenSettings) onOpenSettings()
                      }}
                    >
                      Manage models
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="menu-anchor">
                <button
                  className="thought-picker-button"
                  onClick={() => {
                    setThoughtMenuOpen(!thoughtMenuOpen)
                    setModelMenuOpen(false)
                    setPermissionMenuOpen(false)
                  }}
                >
                  <BrainIcon />
                  <span>{thoughtLevel}</span>
                  <ChevronDownIcon />
                </button>

                {thoughtMenuOpen ? (
                  <div className="popover-menu shadow-flyout">
                    {THOUGHT_OPTIONS.map((level) => (
                      <button
                        key={level}
                        className={`menu-item ${thoughtLevel === level ? 'active' : ''}`}
                        onClick={() => {
                          setThoughtLevel(level)
                          setThoughtMenuOpen(false)
                        }}
                      >
                        {level}
                        {thoughtLevel === level ? <CheckIcon className="check-icon" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {busy ? (
                <button className="send-pill-button stop" onClick={() => void stop()} title="Stop runtime">
                  <StopIcon />
                </button>
              ) : (
                <button className="send-pill-button" disabled={!prompt.trim()} onClick={() => void run()} title="Send">
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="chat-footnote">Browser actions run in the pane you can see.</div>
      </aside>
    </div>
  )
}
