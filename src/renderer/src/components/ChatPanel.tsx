import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type {
  DshEventFrame,
  HarnessStatus,
  ModelProviderGroup,
  SessionModels,
  SessionSummary,
} from '../../../shared/contracts'
import type { AskQuestion, ThreadEntry, TodoItem } from '../lib/types'
import {
  ArrowUpIcon,
  BrainIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ContextIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  SpinnerIcon,
  StopIcon,
} from './Icons'

interface ChatPanelProps {
  status: HarnessStatus | null
  workspaceName?: string
  sessionsCollapsed: boolean
  onError(message: string): void
  onOpenSettings?(): void
  onOpenFile?(path: string): void
  externalPrompt?: { id: string; text: string } | null
  onExternalPromptConsumed?(): void
}

const PERMISSION_MODES = [
  { id: 'read-only', label: 'Read only' },
  { id: 'workspace-write', label: 'Workspace write' },
  { id: 'danger-full-access', label: 'Full access' },
] as const

const RESULT_MAX_CHARS = 2_000

const FS_WRITE_TOOL_NAMES = new Set(['fs_edit', 'fs_write', 'fs_write_text', 'fs_create', 'fs_apply_patch', 'fs_str_replace', 'apply_patch'])

export function ChatPanel({ status, workspaceName, sessionsCollapsed, onError, onOpenSettings, onOpenFile, externalPrompt, onExternalPromptConsumed }: ChatPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [threads, setThreads] = useState<Record<string, ThreadEntry[]>>({})
  const [busySessions, setBusySessions] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<SessionModels | null>(null)
  const [permissionMode, setPermissionMode] = useState('workspace-write')
  const [prompt, setPrompt] = useState('')
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [thoughtMenuOpen, setThoughtMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [changedFiles, setChangedFiles] = useState<string[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeSession = useMemo(() => sessions.find((s) => s.sessionId === activeSessionId) ?? null, [sessions, activeSessionId])
  const entries = useMemo(() => threads[activeSessionId ?? ''] ?? [], [threads, activeSessionId])
  const threadContext = useMemo(() => collectThreadContext(entries), [entries])
  const busy = busySessions.has(activeSessionId ?? '')

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      const result = await window.ndDsh.dsh.rpc('session.list', {})
      const items = ((result.value ?? {}) as { items?: SessionSummary[] }).items ?? []
      setSessions(items)
      setSessionsLoaded(true)
      setActiveSessionId((current) => current ?? items[0]?.sessionId ?? null)
    } catch (cause) {
      setSessionsLoaded(true)
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  const loadHistory = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const result = await window.ndDsh.dsh.rpc('session.history', { sessionId, maxMessages: 50 })
      const events = ((result.value ?? {}) as { events?: { event?: HistoryEventEnvelope }[] }).events ?? []
      const entries = foldHistory(events.flatMap((item) => (item.event ? [item.event] : [])))
      setThreads((current) => ({ ...current, [sessionId]: entries }))
      setChangedFiles(collectChangedFiles(entries))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  const selectSession = useCallback((session: SessionSummary): void => {
    setActiveSessionId(session.sessionId)
    if (!threads[session.sessionId]) void loadHistory(session.sessionId)
  }, [threads, loadHistory])

  const handleNewSession = useCallback(async (): Promise<void> => {
    try {
      const result = await window.ndDsh.dsh.rpc('session.create', {})
      const sessionId = ((result.value ?? {}) as { sessionId?: string }).sessionId
      if (typeof sessionId !== 'string') throw new Error('session.create returned no session id')
      const created: SessionSummary = { sessionId, updatedAt: Date.now(), running: false, blank: true }
      setSessions((current) => [created, ...current])
      setThreads((current) => ({ ...current, [sessionId]: [] }))
      setActiveSessionId(sessionId)
      setChangedFiles([])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    void window.ndDsh.harness.getPermissionMode().then(setPermissionMode).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!activeSessionId) return
    // Covers the auto-selected session on startup, not just manual clicks,
    // so an existing thread shows its messages and context immediately.
    if (!threads[activeSessionId]) void loadHistory(activeSessionId)
  }, [activeSessionId, threads, loadHistory])

  useEffect(() => {
    if (!activeSessionId) return
    void window.ndDsh.dsh.rpc('session.models', { sessionId: activeSessionId })
      .then((result) => {
        if (result.ok) setModels(result.value as SessionModels)
      })
      .catch(() => setModels(null))
  }, [activeSessionId])

  useEffect(() => {
    if (!externalPrompt) return
    setPrompt(externalPrompt.text)
    onExternalPromptConsumed?.()
  }, [externalPrompt, onExternalPromptConsumed])

  // The live gateway stream: fold session events into the active thread, show
  // approvals/questions as cards, and track per-session busy state.
  useEffect(() => {
    const offEvent = window.ndDsh.dsh.onEvent((frame) => handleFrame(frame))
    return offEvent
  })

  function handleFrame(frame: DshEventFrame): void {
    const sessionId = frame.sessionId
    if (sessionId) {
      if (frame.kind === 'session-status') {
        setBusySessions((current) => {
          const next = new Set(current)
          if (frame.running) next.add(sessionId)
          else next.delete(sessionId)
          return next
        })
        return
      }
      if (frame.kind === 'session-added' || frame.kind === 'session-removed') {
        void refreshSessions()
        return
      }
      if (frame.kind === 'session-event' && frame.event) {
        const envelope = frame.event
        if (envelope.type === 'session/title') {
          void refreshSessions()
          return
        }
        setThreads((current) => {
          const previous = current[sessionId] ?? []
          const next = foldEvent(previous, envelope)
          if (next === previous) return current
          const updated = { ...current, [sessionId]: next }
          if (sessionId === activeSessionId) setChangedFiles(collectChangedFiles(next))
          return updated
        })
      }
    }
    if (frame.kind === 'agent-error' && frame.message) {
      appendNotice(sessionId, frame.message, 'error')
    }
  }

  function appendNotice(sessionId: string | undefined, text: string, tone: 'info' | 'error' = 'info'): void {
    if (!sessionId) return
    setThreads((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), { kind: 'notice', id: crypto.randomUUID(), text, tone }],
    }))
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [entries.length])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setModelMenuOpen(false)
        setPermissionMenuOpen(false)
        setThoughtMenuOpen(false)
        setContextMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const run = async (): Promise<void> => {
    const input = prompt.trim()
    if (!input || busy) return
    setPrompt('')
    try {
      const result = await window.ndDsh.harness.run(input, activeSessionId ? { sessionId: activeSessionId } : undefined)
      setActiveSessionId(result.sessionId)
      setThreads((current) => ({
        ...current,
        [result.sessionId]: [...(current[result.sessionId] ?? []), { kind: 'user', id: crypto.randomUUID(), text: input }],
      }))
      if (result.sessionId && !sessions.some((s) => s.sessionId === result.sessionId)) void refreshSessions()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const stop = async (): Promise<void> => {
    try {
      await window.ndDsh.harness.stop()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const setSessionPermission = async (mode: string): Promise<void> => {
    setPermissionMode(mode)
    setPermissionMenuOpen(false)
    try {
      await window.ndDsh.harness.setPermissionMode(mode)
      onError('Permission mode changed; the runtime restarts on the next prompt.')
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selectModel = async (provider: string, model: string): Promise<void> => {
    if (!activeSessionId) return
    try {
      await window.ndDsh.dsh.rpc('session.selectModel', { sessionId: activeSessionId, provider, model })
      setModels((current) => current ? { ...current, current: { provider, model } } : current)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selectReasoningEffort = async (effortId: string): Promise<void> => {
    if (!activeSessionId || !models) return
    try {
      await window.ndDsh.dsh.rpc('session.selectModel', {
        sessionId: activeSessionId,
        provider: models.current.provider,
        model: models.current.model,
        reasoningEffort: effortId,
      })
      setModels({ ...models, current: { ...models.current, reasoningEffort: effortId } })
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const answerApproval = async (entry: Extract<ThreadEntry, { kind: 'approval' }>, outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    try {
      await window.ndDsh.dsh.respond(entry.rpcId, { sessionId: entry.sessionId, approvalId: entry.approvalId, outcome })
      markResolved(entry.id, 'approval', outcome)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const markResolved = (id: string, kind: 'approval' | 'question', outcome: string): void => {
    if (!activeSessionId) return
    setThreads((current) => {
      const list = current[activeSessionId] ?? []
      return {
        ...current,
        [activeSessionId]: list.map((entry) => {
          if (entry.id !== id) return entry
          if (kind === 'approval' && entry.kind === 'approval') return { ...entry, resolved: outcome as 'allowed-once' | 'rejected' }
          if (kind === 'question' && entry.kind === 'question') return { ...entry, resolved: true }
          return entry
        }),
      }
    })
  }

  const modelGroups: ModelProviderGroup[] = models?.groups ?? []
  const currentModel = models?.current
  const currentGroup = modelGroups.find((group) => group.id === currentModel?.provider)
  const currentModelMeta = currentGroup?.models.find((model) => model.id === currentModel?.model)
  const reasoningEfforts = currentModelMeta?.reasoning?.efforts ?? []
  const activeEffort = currentModel?.reasoningEffort ?? currentModelMeta?.reasoning?.defaultEffort

  const sessionTime = (session: SessionSummary): string => {
    const minutes = Math.round((Date.now() - session.updatedAt) / 60_000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}min`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours}h`
    return new Date(session.updatedAt).toLocaleDateString()
  }

  const sessionTitle = (session: SessionSummary): string => {
    const title = session.projections?.values?.title
    if (typeof title === 'string' && title.trim()) return title
    return 'New Chat Thread'
  }

  return (
    <div className="chat-dual-sidebar-wrap">
      <aside className={`chat-sessions-sidebar ${sessionsCollapsed ? 'collapsed' : ''}`}>
        <div className="session-action-container">
          <button className="new-session-btn" onClick={() => void handleNewSession()}>
            <PlusIcon className="plus-icon" />
            <span>New Session</span>
          </button>
        </div>

        <div className="workspaces-section">
          <div className="workspaces-header">
            <span className="section-label">Workspaces</span>
            <div className="section-actions">
              <button className="settings-cta-btn" title="Refresh sessions" onClick={() => void refreshSessions()}>
                <SearchIcon />
              </button>
              {onOpenSettings ? (
                <button className="settings-cta-btn" onClick={onOpenSettings} title="Settings">
                  <SettingsIcon />
                </button>
              ) : null}
              <button className="settings-cta-btn" title="New session" onClick={() => void handleNewSession()}>
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="workspace-item">
            <FolderIcon className="folder-icon" />
            <span className="workspace-name">{workspaceName ?? 'workspace'}</span>
          </div>

          <div className="sessions-list">
            {!sessionsLoaded ? (
              <div className="sessions-empty">Loading sessions…</div>
            ) : sessions.length === 0 ? (
              <div className="sessions-empty">No sessions yet</div>
            ) : (
              sessions.filter((session) => !session.blank || session.sessionId === activeSessionId).map((session) => (
                <button
                  key={session.sessionId}
                  className={`session-thread-card ${activeSessionId === session.sessionId ? 'active' : ''}`}
                  onClick={() => selectSession(session)}
                >
                  <div className="card-left">
                    <span className={`dot-active ${busySessions.has(session.sessionId) ? 'on' : 'off'}`} />
                    <ChatIcon className="thread-icon" />
                    <span className="thread-title">{sessionTitle(session)}</span>
                  </div>
                  <span className="thread-time">{sessionTime(session)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <footer className="sessions-footer">
          <button className="settings-footer-btn" onClick={onOpenSettings} title="Settings">
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </footer>
      </aside>

      <aside className="chat-thread-pane">
        <header className="chat-heading">
          <div className="active-thread-header-info">
            <div>
              <span className="eyebrow">ACTIVE THREAD</span>
              <strong title={activeSession ? sessionTitle(activeSession) : undefined}>
                {activeSession ? sessionTitle(activeSession) : 'No session'}
              </strong>
            </div>
          </div>
          <span className={`status-orb ${status?.state ?? 'stopped'}`} title={status?.error} />
        </header>

        {!status?.sourceReady ? (
          <div className="setup-card">
            <strong>Harness not built</strong>
            <span>Run <code>pnpm bootstrap</code> once.</span>
          </div>
        ) : null}
        {status?.sourceReady && !status.apiKeyPresent ? (
          <div className="setup-card warning">
            <strong>API key missing</strong>
            <span>Add <code>DEEPSEEK_API_KEY</code> to <code>.env</code>.</span>
          </div>
        ) : null}

        {changedFiles.length > 0 ? (
          <div className="diff-changes-banner">
            <div className="banner-left">
              <ChevronRightIcon className="banner-chevron" />
              <span className="banner-title">{changedFiles.length} file{changedFiles.length === 1 ? '' : 's'} changed</span>
              <div className="banner-files">
                {changedFiles.slice(0, 4).map((file) => (
                  <button key={file} className="banner-file" onClick={() => onOpenFile?.(file)} title={file}>
                    {file}
                  </button>
                ))}
                {changedFiles.length > 4 ? <span className="banner-more">+{changedFiles.length - 4} more</span> : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="chat-scroll" ref={scrollRef}>
          {entries.length === 0 && !busy ? (
            <div className="chat-empty">
              <span className="chat-empty-mark"><SparkIcon /></span>
              <h3>ND Agent</h3>
              <p>Ask anything about this workspace — open files, inspect the browser, or plan company goals. Context used during the thread appears on the composer badge.</p>
            </div>
          ) : null}
          {entries.map((entry) => (
            <ThreadEntryView
              key={entry.id}
              entry={entry}
              onAnswerApproval={answerApproval}
              {...(onOpenFile ? { onOpenFile } : {})}
            />
          ))}
          {busy ? (
            <div className="agent-working">
              <span /><span /><span />
              <em>{status?.state === 'starting' ? 'Starting pinned runtime' : 'Harness is working'}</em>
            </div>
          ) : null}
        </div>

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
            placeholder="Ask the agent to work in this workspace"
            rows={3}
          />

          <div className="composer-actions-bar">
            <div className="action-group-left">
              <div className="menu-anchor">
                <button
                  className="permission-badge"
                  onClick={() => { setPermissionMenuOpen(!permissionMenuOpen); setModelMenuOpen(false); setThoughtMenuOpen(false) }}
                >
                  <ShieldIcon />
                  <span>{PERMISSION_MODES.find((mode) => mode.id === permissionMode)?.label ?? permissionMode}</span>
                  <ChevronDownIcon />
                </button>
                {permissionMenuOpen ? (
                  <div className="popover-menu shadow-flyout">
                    {PERMISSION_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        className={`menu-item ${permissionMode === mode.id ? 'active' : ''}`}
                        onClick={() => void setSessionPermission(mode.id)}
                      >
                        {mode.label}
                        {permissionMode === mode.id ? <CheckIcon className="check-icon" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div
                className="menu-anchor context-anchor"
                onMouseEnter={() => setContextMenuOpen(true)}
                onMouseLeave={() => setContextMenuOpen(false)}
              >
                <button
                  className="context-badge"
                  title="Context used in this thread (hover to inspect)"
                  onClick={() => setContextMenuOpen((open) => !open)}
                >
                  <ContextIcon />
                  <span>{threadContext.readFiles.length + threadContext.editedFiles.length}</span>
                </button>
                {contextMenuOpen ? (
                  <div className="popover-menu context-popover">
                    <div className="context-popover-title">THREAD CONTEXT</div>
                    {threadContext.readFiles.length === 0
                      && threadContext.editedFiles.length === 0
                      && threadContext.tools.length === 0 ? (
                      <>
                        <div className="context-tool"><span>Files</span><span>0</span></div>
                        <div className="context-tool"><span>Tools</span><span>0</span></div>
                      </>
                    ) : (
                      <>
                        {threadContext.editedFiles.length > 0 ? (
                          <div className="context-section">
                            <small>EDITED</small>
                            {threadContext.editedFiles.map((file) => (
                              <button key={file} className="context-file" onClick={() => onOpenFile?.(file)} title={file}>
                                <FileIcon />
                                <span>{file}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {threadContext.readFiles.length > 0 ? (
                          <div className="context-section">
                            <small>READ</small>
                            {threadContext.readFiles.map((file) => (
                              <button key={file} className="context-file" onClick={() => onOpenFile?.(file)} title={file}>
                                <FileIcon />
                                <span>{file}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {threadContext.tools.length > 0 ? (
                          <div className="context-section">
                            <small>TOOLS</small>
                            {threadContext.tools.map((tool) => (
                              <div key={tool.name} className="context-tool">
                                <span>{tool.name}</span>
                                <span>×{tool.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    <div className="context-meta">
                      {threadContext.userMessages} prompt{threadContext.userMessages === 1 ? '' : 's'} · {threadContext.assistantMessages} repl{threadContext.assistantMessages === 1 ? 'y' : 'ies'}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="action-group-right">
              {busy ? <SpinnerIcon className="busy-spinner" /> : null}

              <div className="menu-anchor">
                <button
                  className="model-picker-button"
                  title={`${currentGroup?.name ?? currentModel?.provider ?? 'model'}/${currentModel?.model ?? ''}`}
                  onClick={() => { setModelMenuOpen(!modelMenuOpen); setPermissionMenuOpen(false); setThoughtMenuOpen(false) }}
                >
                  <span className="model-name-text">{`${currentGroup?.name ?? currentModel?.provider ?? 'deepseek'}/${currentModel?.model ?? 'deepseek-v4-flash'}`}</span>
                  <ChevronDownIcon />
                </button>

                {modelMenuOpen ? (
                  <div className="popover-menu model-flyout shadow-flyout">
                    {modelGroups.map((group) => (
                      <div
                        key={group.id}
                        className="model-provider-row"
                        onClick={() => { const first = group.models[0]; if (first) void selectModel(group.id, first.id); setModelMenuOpen(false) }}
                      >
                        <span>{group.name}</span>
                        <div className="row-end">
                          {currentModel?.provider === group.id ? <CheckIcon className="check-icon" /> : null}
                          <ChevronRightIcon />
                        </div>
                      </div>
                    ))}
                    {currentGroup && currentGroup.models.length > 1 ? <div className="menu-divider" /> : null}
                    {currentGroup && currentGroup.models.length > 1 ? currentGroup.models.map((model) => (
                      <button
                        key={model.id}
                        className={`menu-item model-item ${currentModel?.model === model.id ? 'active' : ''}`}
                        onClick={() => { void selectModel(currentGroup.id, model.id); setModelMenuOpen(false) }}
                      >
                        {model.name ?? model.id}
                        {currentModel?.model === model.id ? <CheckIcon className="check-icon" /> : null}
                      </button>
                    )) : null}
                    <div className="menu-divider" />
                    <button className="menu-item" onClick={() => { setModelMenuOpen(false); if (onOpenSettings) onOpenSettings() }}>
                      Manage models
                    </button>
                  </div>
                ) : null}
              </div>

              {reasoningEfforts.length > 0 ? (
                <div className="menu-anchor">
                  <button
                    className="thought-picker-button"
                    onClick={() => { setThoughtMenuOpen(!thoughtMenuOpen); setModelMenuOpen(false); setPermissionMenuOpen(false) }}
                  >
                    <BrainIcon />
                    <span>{reasoningEfforts.find((effort) => effort.id === activeEffort)?.name ?? 'Auto'}</span>
                    <ChevronDownIcon />
                  </button>
                  {thoughtMenuOpen ? (
                    <div className="popover-menu shadow-flyout">
                      {reasoningEfforts.map((effort) => (
                        <button
                          key={effort.id}
                          className={`menu-item ${activeEffort === effort.id ? 'active' : ''}`}
                          onClick={() => { void selectReasoningEffort(effort.id); setThoughtMenuOpen(false) }}
                        >
                          {effort.name}
                          {activeEffort === effort.id ? <CheckIcon className="check-icon" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {busy ? (
                <button className="send-pill-button stop" onClick={() => void stop()} title="Cancel the running turn">
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

interface ThreadEntryViewProps {
  entry: ThreadEntry
  onAnswerApproval?(entry: Extract<ThreadEntry, { kind: 'approval' }>, outcome: 'allowed-once' | 'rejected'): void
  onOpenFile?(path: string): void
}

function ThreadEntryView({ entry, onAnswerApproval, onOpenFile }: ThreadEntryViewProps) {
  switch (entry.kind) {
    case 'user':
      return (
        <article className="chat-message user" key={entry.id}>
          <div className="message-label">You</div>
          <div className="message-content">{entry.text}</div>
        </article>
      )
    case 'assistant':
      return (
        <article className="chat-message assistant" key={entry.id}>
          <div className="message-label"><SparkIcon /> Harness</div>
          <div className="message-content">{entry.text}{entry.streaming ? <span className="stream-caret" /> : null}</div>
        </article>
      )
    case 'notice':
      return (
        <article className={`chat-message system ${entry.tone === 'error' ? 'error' : ''}`} key={entry.id}>
          <div className="message-label">Runtime</div>
          <div className="message-content">{entry.text}</div>
        </article>
      )
    case 'tool':
      return (
        <article className={`tool-card ${entry.status}`} key={entry.id}>
          <div className="tool-card-head">
            <span className="tool-name">{entry.name}</span>
            <span className="tool-status">{entry.status === 'running' ? 'running…' : entry.status === 'error' ? 'failed' : 'done'}</span>
          </div>
          {entry.args !== undefined && entry.name.startsWith('fs_') ? <div className="tool-card-path">{toolPath(entry.args)}</div> : null}
          {entry.result ? <pre className="tool-card-result">{entry.result}</pre> : null}
        </article>
      )
    case 'todo':
      return (
        <article className="todo-card" key={entry.id}>
          {entry.items.map((item: TodoItem, index) => (
            <div className={`todo-row ${item.status}`} key={`${item.content}-${index}`}>
              <span className="todo-check">{item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '·' : ''}</span>
              <span>{item.content}</span>
            </div>
          ))}
        </article>
      )
    case 'approval':
      return (
        <article className="approval-card" key={entry.id}>
          <div className="approval-head"><ShieldIcon /> Approval required</div>
          <div className="approval-body">
            <span className="approval-tool">{entry.toolName}</span>
            {entry.reason ? <span className="approval-reason">{entry.reason}</span> : null}
          </div>
          {entry.resolved ? (
            <div className="approval-resolved">{entry.resolved === 'allowed-once' ? 'Allowed once' : 'Rejected'}</div>
          ) : (
            <div className="approval-actions">
              <button className="approval-allow" onClick={() => onAnswerApproval?.(entry, 'allowed-once')}>Allow once</button>
              <button className="approval-reject" onClick={() => onAnswerApproval?.(entry, 'rejected')}>Reject</button>
            </div>
          )}
        </article>
      )
    case 'question':
      return <QuestionCard entry={entry} />
    default:
      return null
  }
}

function QuestionCard({ entry }: { entry: Extract<ThreadEntry, { kind: 'question' }> }) {
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  const toggleOption = (question: AskQuestion, label: string, multiSelect: boolean): void => {
    setSelections((current) => {
      const selected = current[question.id] ?? []
      if (multiSelect) {
        return { ...current, [question.id]: selected.includes(label) ? selected.filter((value) => value !== label) : [...selected, label] }
      }
      return { ...current, [question.id]: [label] }
    })
  }

  const submit = async (): Promise<void> => {
    const answers = entry.questions.map((question) => {
      const customAnswer = custom[question.id]?.trim()
      return {
        id: question.id,
        selected: selections[question.id] ?? [],
        ...(customAnswer ? { custom: customAnswer } : {}),
      }
    })
    try {
      await window.ndDsh.dsh.respond(entry.rpcId, { sessionId: entry.sessionId, answer: { answers } })
    } catch {
      // The card stays interactive; a later submit retries the same rpcId.
    }
  }

  return (
    <article className="question-card" key={entry.id}>
      <div className="approval-head">Questions</div>
      {entry.questions.map((question) => (
        <div className="question-block" key={question.id}>
          <div className="question-text">{question.question}</div>
          <div className="question-options">
            {(question.options ?? []).map((option) => (
              <button
                key={option.label}
                className={`question-option ${(selections[question.id] ?? []).includes(option.label) ? 'selected' : ''}`}
                onClick={() => toggleOption(question, option.label, question.multiSelect ?? false)}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="question-custom"
            placeholder="Other…"
            value={custom[question.id] ?? ''}
            onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
          />
        </div>
      ))}
      {entry.resolved ? (
        <div className="approval-resolved">Answered</div>
      ) : (
        <div className="approval-actions">
          <button className="approval-allow" onClick={() => void submit()}>Submit answers</button>
        </div>
      )}
    </article>
  )
}

// ── session event fold ────────────────────────────────────────────────────────

interface HistoryEventEnvelope {
  type: string
  seq: number
  data?: unknown
}

function foldHistory(events: HistoryEventEnvelope[]): ThreadEntry[] {
  const entries: ThreadEntry[] = []
  for (const envelope of events) {
    if (!envelope) continue
    foldEventInto(entries, envelope)
  }
  return entries
}

function foldEvent(entries: ThreadEntry[], envelope: HistoryEventEnvelope): ThreadEntry[] {
  const next = [...entries]
  foldEventInto(next, envelope)
  return next
}

function foldEventInto(entries: ThreadEntry[], envelope: HistoryEventEnvelope): void {
  const data = (envelope.data ?? {}) as Record<string, unknown>
  switch (envelope.type) {
    case 'user/message': {
      const text = messageText(data.message)
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'user' && last.text === text) return
      entries.push({ kind: 'user', id: crypto.randomUUID(), text })
      return
    }
    case 'assistant/chunk': {
      const text = messageText(data.chunk)
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'assistant' && last.streaming) {
        last.text = `${last.text}${text}`
      } else {
        entries.push({ kind: 'assistant', id: crypto.randomUUID(), text, streaming: true })
      }
      return
    }
    case 'assistant/message': {
      const text = messageText(data.message)
      if (text === undefined) return
      const last = entries.at(-1)
      if (last?.kind === 'assistant' && last.streaming) {
        last.text = text
        last.streaming = false
      } else {
        entries.push({ kind: 'assistant', id: crypto.randomUUID(), text })
      }
      return
    }
    case 'tool/call': {
      const callId = typeof data.callId === 'string' ? data.callId : undefined
      const name = typeof data.name === 'string' ? data.name : 'tool'
      entries.push({ kind: 'tool', id: crypto.randomUUID(), ...(callId === undefined ? {} : { callId }), name, args: data.arguments, status: 'running' })
      return
    }
    case 'tool/result': {
      const runningIndex = entries.findIndex((entry) => entry.kind === 'tool' && entry.status === 'running')
      const text = messageText(data.message) ?? ''
      const summary = typeof data.error === 'string' ? `Error: ${data.error}` : text.slice(0, RESULT_MAX_CHARS)
      if (runningIndex === -1) {
        entries.push({ kind: 'tool', id: crypto.randomUUID(), name: 'tool', status: typeof data.error === 'string' ? 'error' : 'done', result: summary })
      } else {
        const entry = entries[runningIndex]
        if (entry?.kind === 'tool') {
          entry.status = typeof data.error === 'string' ? 'error' : 'done'
          entry.result = summary
        }
      }
      return
    }
    case 'todo/write': {
      const todos = Array.isArray(data.todos) ? data.todos as unknown as TodoItem[] : []
      const last = entries.at(-1)
      if (last?.kind === 'todo') last.items = todos
      else entries.push({ kind: 'todo', id: crypto.randomUUID(), items: todos })
      return
    }
    default:
      // turn/step markers, request headers, compaction records, and plugin
      // events stay out of the surface; the trajectory view owns those.
      return
  }
}

function messageText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const record = message as Record<string, unknown>
  if (typeof record.content === 'string') return record.content
  if (!Array.isArray(record.content)) return undefined
  const parts: string[] = []
  for (const block of record.content) {
    if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
      const text = (block as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

function collectChangedFiles(entries: ThreadEntry[]): string[] {
  const files = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'tool') continue
    if (!FS_WRITE_TOOL_NAMES.has(entry.name)) continue
    const path = toolPath(entry.args)
    if (path) files.add(path)
  }
  return [...files]
}

interface ThreadContext {
  readFiles: string[]
  editedFiles: string[]
  tools: Array<{ name: string; count: number }>
  userMessages: number
  assistantMessages: number
}

// Everything the agent pulled into this thread: files it read or edited and
// the tools it invoked. Derived from the folded session events of this thread only.
function collectThreadContext(entries: ThreadEntry[]): ThreadContext {
  const read = new Set<string>()
  const edited = new Set<string>()
  const toolCounts = new Map<string, number>()
  let userMessages = 0
  let assistantMessages = 0
  for (const entry of entries) {
    if (entry.kind === 'user') userMessages += 1
    else if (entry.kind === 'assistant') assistantMessages += 1
    else if (entry.kind === 'tool') {
      toolCounts.set(entry.name, (toolCounts.get(entry.name) ?? 0) + 1)
      const path = toolPath(entry.args)
      if (!path) continue
      if (FS_WRITE_TOOL_NAMES.has(entry.name)) edited.add(path)
      else read.add(path)
    }
  }
  return {
    readFiles: [...read].filter((path) => !edited.has(path)),
    editedFiles: [...edited],
    tools: [...toolCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    userMessages,
    assistantMessages,
  }
}

function toolPath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  const candidates = [record.path, record.file_path, record.filePath, record.file]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.replaceAll('\\', '/')
    }
  }
  return undefined
}
