import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode, Fragment } from 'react'
import type {
  CodingEngineDescriptor,
  DshEventFrame,
  EngineModelOption,
  EngineSessionSummary,
  ExternalElementAttachmentView,
  HarnessStatus,
  ModelProvider,
  ModelProviderGroup,
  ProviderPingResult,
  SessionModels,
  SessionSummary,
  WorkspaceSuggestion,
} from '../../../shared/contracts'
import { ANTIGRAVITY_ENGINE_ID, CODEX_CLI_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../../../shared/coding-engines'
import { DisplayGroup, groupEntries, parseFileChanges, toolPreview } from '../../../shared/chat-grouping'
import { filterSessionsInProjectScope, isSessionInProjectScope } from '../../../shared/session-project-scope'
import { splitAssistantSegments, type ReviewVerdict } from '../../../shared/structured-output'
import type { ProjectPlanInput } from '../../../shared/organization'
import type { AskQuestion, ThreadEntry, TodoItem } from '../lib/types'
import { FOLDER_ACCENT, SKILL_ACCENT, fileExtensionOf, fileAccent } from '../lib/file-accents'
import { applyMention, detectMentionTrigger } from '../../../shared/mentions'
import { resolveModelSelectionDisplay, type ModelCatalogState } from '../lib/model-selection'
import { describeAgentError, type AgentErrorRoute } from '../lib/runtime-notices'
import {
  ArchiveIcon,
  ArrowUpIcon,
  BrainIcon,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ContextIcon,
  CopyIcon,
  CrosshairIcon,
  FileIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SparkIcon,
  SpinnerIcon,
  StopIcon,
  TerminalIcon,
} from './Icons'
import { cn } from '../lib/utils'
import { TerminalDock } from './TerminalDock'
import { ChangedFilesCard } from './ChangedFilesCard'
import { MarkdownLite } from './MarkdownLite'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface ChatPanelProps {
  status: HarnessStatus | null
  workspaceName?: string
  sessionsCollapsed: boolean
  /** Run attribution for scoping the sidebar to the active project's sessions. */
  sessionProjectScope?: { activeProjectId?: string | undefined; sessionProjects: Readonly<Record<string, string>> }
  /** Projects of the active company, listed in the sidebar; click to switch workspace. */
  projects?: Array<{ id: string; name: string; active: boolean; linked: boolean }>
  /** Requests activation of a project; the coordinator rebinds the workspace root. */
  onSelectProject?(projectId: string): void
  onError(message: string): void
  onOpenSettings?(tab?: 'models'): void
  onOpenFile?(path: string): void
  externalPrompt?: { id: string; text: string } | null
  onExternalPromptConsumed?(): void
  /** Bumped by the titlebar when a picked element is staged or removed. */
  elementAttachmentVersion?: number
}

const PERMISSION_MODES = [
  { id: 'read-only', label: 'Read only' },
  { id: 'workspace-write', label: 'Workspace write' },
  { id: 'danger-full-access', label: 'Full access' },
] as const

const RESULT_MAX_CHARS = 2_000

/** Stable fallback so the project-scope memos keep a consistent dependency. */
const EMPTY_SESSION_PROJECTS: Readonly<Record<string, string>> = {}

const FS_WRITE_TOOL_NAMES = new Set(['fs_edit', 'fs_write', 'fs_write_text', 'fs_create', 'fs_apply_patch', 'fs_str_replace', 'apply_patch'])

interface SkillSuggestion {
  name: string
  description: string
  whenToUse?: string
}

interface MentionItem {
  kind: 'skill' | 'file'
  insert: string
  label: string
  tag: string
  hover: string
  accent: string
  directory: boolean
}

const MENTION_MENU_LIMIT = 12

type PingEntry = { testing: true } | ProviderPingResult
type ModelMenuPane = 'root' | 'model' | 'effort'

function fileMentionTag(relativePath: string): string {
  const extension = fileExtensionOf(relativePath)
  return extension ? extension.toUpperCase().slice(0, 5) : 'FILE'
}

export function ChatPanel({ status, workspaceName, sessionsCollapsed, sessionProjectScope, projects, onSelectProject, onError, onOpenSettings, onOpenFile, externalPrompt, onExternalPromptConsumed, elementAttachmentVersion }: ChatPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [threads, setThreads] = useState<Record<string, ThreadEntry[]>>({})
  const [busySessions, setBusySessions] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<SessionModels | null>(null)
  const [modelCatalogState, setModelCatalogState] = useState<ModelCatalogState>('idle')
  const [providerRoutes, setProviderRoutes] = useState<ModelProvider[]>([])
  const [providerPings, setProviderPings] = useState<Record<string, PingEntry>>({})
  const [permissionMode, setPermissionMode] = useState('workspace-write')
  const [prompt, setPrompt] = useState('')
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [modelMenuPane, setModelMenuPane] = useState<ModelMenuPane>('root')
  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [changedFiles, setChangedFiles] = useState<string[]>([])
  const [mentionCaret, setMentionCaret] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [skillItems, setSkillItems] = useState<SkillSuggestion[]>([])
  const [skillsState, setSkillsState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [fileItems, setFileItems] = useState<WorkspaceSuggestion[]>([])
  const [elementChips, setElementChips] = useState<ExternalElementAttachmentView[]>([])
  // Catalog-driven engine support: non-harness engines (e.g. the direct Codex
  // CLI) appear as extra "New … chat" actions and extra sidebar sections.
  const [engines, setEngines] = useState<CodingEngineDescriptor[]>([])
  const [engineSessions, setEngineSessions] = useState<EngineSessionSummary[]>([])
  // Engine id for a chat that is drafted but not created yet; the session is
  // created by the first send (router-side), never via gateway session.create.
  const [draftEngineId, setDraftEngineId] = useState<string | null>(null)
  // Dedicated terminal session that hosts the interactive `agy` TUI for native
  // account switching (/logout); independent from per-chat terminals.
  const [switchAccountTerminalOpen, setSwitchAccountTerminalOpen] = useState(false)
  // Native model selection for engines that expose a catalog (Antigravity).
  // `null` means "engine-native default": no model flag is sent at all.
  const [engineModels, setEngineModels] = useState<EngineModelOption[]>([])
  const [engineModel, setEngineModel] = useState<string | null>(null)
  const [engineModelMenuOpen, setEngineModelMenuOpen] = useState(false)
  // Chat archival lives ND-side; the sidebar filters on it and each thread
  // card gets a hover menu that toggles it (harness and engine chats alike).
  const [showArchived, setShowArchived] = useState(false)
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Composer grows with its content up to the CSS max-height, then scrolls.
  const autosizeComposer = (): void => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
  useEffect(() => {
    autosizeComposer()
  }, [prompt])
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== '`') return
      event.preventDefault()
      if (activeSessionId) setTerminalOpen((open) => !open)
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [activeSessionId])

  const activeSession = useMemo(() => sessions.find((s) => s.sessionId === activeSessionId) ?? null, [sessions, activeSessionId])
  const entries = useMemo(() => threads[activeSessionId ?? ''] ?? [], [threads, activeSessionId])
  const threadContext = useMemo(() => collectThreadContext(entries), [entries])
  const busy = busySessions.has(activeSessionId ?? '')
  // Elapsed wall-clock time for the active session's current turn; drives the
  // "Working for 2m 14s" hint next to the thinking indicator.
  const [busyElapsedMs, setBusyElapsedMs] = useState(0)
  useEffect(() => {
    if (!busy) {
      setBusyElapsedMs(0)
      return
    }
    const startedAt = Date.now()
    setBusyElapsedMs(0)
    const timer = window.setInterval(() => setBusyElapsedMs(Date.now() - startedAt), 1000)
    return () => window.clearInterval(timer)
  }, [busy])
  // Non-harness sessions (and drafts of one) hide harness-only composer controls.
  const engineSessionIds = useMemo(() => new Set(engineSessions.map((session) => session.sessionId)), [engineSessions])
  const activeEngineSession = activeSessionId !== null ? engineSessions.find((session) => session.sessionId === activeSessionId) : undefined
  const terminalCwd = activeSession?.cwd ?? activeEngineSession?.cwd
  const activeEngineId = activeEngineSession
    ? activeEngineSession.engineId
    : activeSessionId === null && draftEngineId !== null
      ? draftEngineId
      : ND_HARNESS_ENGINE_ID
  const onHarnessThread = activeEngineId === ND_HARNESS_ENGINE_ID
  const activeEngineName = engines.find((engine) => engine.id === activeEngineId)?.name ?? 'Codex CLI'
  // Extra chat engines come straight from the catalog; unavailable ones never render.
  const chatEngines = useMemo(() => engines.filter((engine) => engine.available && engine.id !== ND_HARNESS_ENGINE_ID), [engines])
  // Both listings arrive pre-annotated with ND archive flags; the sidebar
  // shows one bucket at a time. Run attribution narrows each bucket to the
  // active project's sessions (unattributed manual chats always stay).
  const activeProjectId = sessionProjectScope?.activeProjectId
  const sessionProjects = sessionProjectScope?.sessionProjects ?? EMPTY_SESSION_PROJECTS
  const visibleSessions = useMemo(
    () => filterSessionsInProjectScope(
      sessions.filter((session) => (showArchived ? session.archived === true : session.archived !== true)),
      activeProjectId,
      sessionProjects,
    ),
    [sessions, showArchived, activeProjectId, sessionProjects],
  )
  const visibleEngineSessions = useMemo(
    () => filterSessionsInProjectScope(
      engineSessions.filter((session) => (showArchived ? session.archived === true : session.archived !== true)),
      activeProjectId,
      sessionProjects,
    ),
    [engineSessions, showArchived, activeProjectId, sessionProjects],
  )

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

  // Engine catalog + non-harness sessions: optional surfaces that never block
  // the primary chat panel when unavailable.
  useEffect(() => {
    void window.ndDsh.engines.list().then(setEngines).catch(() => undefined)
  }, [])

  const refreshEngineSessions = useCallback(async (): Promise<void> => {
    try {
      setEngineSessions(await window.ndDsh.engines.sessions())
    } catch {
      // Engine chat listing stays empty; not an error surface.
    }
  }, [])

  useEffect(() => {
    void refreshEngineSessions()
  }, [refreshEngineSessions])

  /** Restore a non-harness thread by replaying its stored session events. */
  const loadEngineTranscript = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const result = await window.ndDsh.engines.transcript(sessionId)
      const restored = foldHistory(result.events)
      setThreads((current) => ({ ...current, [sessionId]: restored }))
      setChangedFiles(collectChangedFiles(restored))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  // Staged external-element chips: compact labels above the composer; the
  // full element data rides along with the next prompt from the main process.
  const refreshElementChips = useCallback(async (): Promise<void> => {
    try {
      setElementChips(await window.ndDsh.capture.elementAttachments())
    } catch {
      // Attachments are optional context; never block the composer.
    }
  }, [])

  useEffect(() => {
    void refreshElementChips()
  }, [refreshElementChips, elementAttachmentVersion])

  const removeElementChip = useCallback(async (id: string): Promise<void> => {
    try {
      setElementChips(await window.ndDsh.capture.removeElement(id))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  const selectSession = useCallback((session: SessionSummary): void => {
    setDraftEngineId(null)
    setActiveSessionId(session.sessionId)
    if (!threads[session.sessionId]) void loadHistory(session.sessionId)
  }, [threads, loadHistory])

  const selectEngineSession = useCallback((summary: EngineSessionSummary): void => {
    setDraftEngineId(null)
    setActiveSessionId(summary.sessionId)
    if (!threads[summary.sessionId]) void loadEngineTranscript(summary.sessionId)
  }, [threads, loadEngineTranscript])

  // Archival is a desktop-side flag; refetching both listings re-applies the
  // annotated flags exactly like every other session mutation does.
  const setSessionArchived = useCallback(async (sessionId: string, archived: boolean): Promise<void> => {
    try {
      await window.ndDsh.sessions.setArchived(sessionId, archived)
      await Promise.all([refreshSessions(), refreshEngineSessions()])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError, refreshEngineSessions, refreshSessions])

  /** Draft a chat on a non-harness engine; creation happens on first send. */
  const startEngineDraft = useCallback((engineId: string): void => {
    setDraftEngineId(engineId)
    setActiveSessionId(null)
    setChangedFiles([])
  }, [])

  const handleNewSession = useCallback(async (): Promise<void> => {
    try {
      const result = await window.ndDsh.dsh.rpc('session.create', {})
      const sessionId = ((result.value ?? {}) as { sessionId?: string }).sessionId
      if (typeof sessionId !== 'string') throw new Error('session.create returned no session id')
      const created: SessionSummary = { sessionId, updatedAt: Date.now(), running: false, blank: true }
      setSessions((current) => [created, ...current])
      setThreads((current) => ({ ...current, [sessionId]: [] }))
      setActiveSessionId(sessionId)
      setDraftEngineId(null)
      setChangedFiles([])
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  const selectHeaderEngine = useCallback((engineId: string): void => {
    if (engineId === activeEngineId) return
    if (engineId === ND_HARNESS_ENGINE_ID) {
      void handleNewSession()
      return
    }
    startEngineDraft(engineId)
  }, [activeEngineId, handleNewSession, startEngineDraft])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    void window.ndDsh.harness.getPermissionMode().then(setPermissionMode).catch(() => undefined)
  }, [])

  const refreshProviderRoutes = useCallback(async (): Promise<void> => {
    try {
      setProviderRoutes(await window.ndDsh.providers.list())
    } catch {
      setProviderRoutes([])
    }
  }, [])

  useEffect(() => {
    void refreshProviderRoutes()
  }, [refreshProviderRoutes])

  useEffect(() => {
    if (!activeSessionId) return
    // Engine-backed threads restore from their ND-side transcript instead of
    // the gateway history store.
    if (engineSessionIds.has(activeSessionId)) return
    // Covers the auto-selected session on startup, not just manual clicks,
    // so an existing thread shows its messages and context immediately.
    if (!threads[activeSessionId]) void loadHistory(activeSessionId)
  }, [activeSessionId, threads, loadHistory, engineSessionIds])

  // Archiving (or leaving the archived view) must not strand the composer on
  // a hidden thread: fall back to the first visible chat, else the draft state.
  // Switching the active project hides other projects' run sessions the same
  // way, so the fallback covers project-scope changes too.
  useEffect(() => {
    if (!activeSessionId || showArchived) return
    const activeArchived = sessions.some((session) => session.sessionId === activeSessionId && session.archived === true)
      || engineSessions.some((session) => session.sessionId === activeSessionId && session.archived === true)
    const activeOutOfProject = !isSessionInProjectScope(activeSessionId, activeProjectId, sessionProjects)
    if (!activeArchived && !activeOutOfProject) return
    const nextHarness = visibleSessions.find((session) => !session.blank)
    const nextEngine = visibleEngineSessions[0]
    setDraftEngineId(null)
    setActiveSessionId(nextHarness?.sessionId ?? nextEngine?.sessionId ?? null)
  }, [activeSessionId, showArchived, activeProjectId, sessionProjects, visibleSessions, visibleEngineSessions, sessions, engineSessions])

  useEffect(() => {
    // The gateway model catalog only applies to harness sessions.
    setModels(null)
    if (!activeSessionId || engineSessionIds.has(activeSessionId)) {
      setModelCatalogState('idle')
      return
    }
    let cancelled = false
    setModelCatalogState('loading')
    void window.ndDsh.dsh.rpc('session.models', { sessionId: activeSessionId })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setModels(result.value as SessionModels)
          setModelCatalogState('ready')
        } else {
          setModelCatalogState('unavailable')
        }
      })
      .catch(() => {
        if (cancelled) return
        setModels(null)
        setModelCatalogState('unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, engineSessionIds])

  // Engines with a native model catalog (Antigravity) load it once per active
  // engine; switching threads keeps the chosen slug until the engine changes.
  useEffect(() => {
    setEngineModelMenuOpen(false)
    if (activeEngineId !== ANTIGRAVITY_ENGINE_ID) {
      setEngineModels([])
      return
    }
    let cancelled = false
    void window.ndDsh.engines.models(ANTIGRAVITY_ENGINE_ID)
      .then((options) => {
        if (!cancelled) setEngineModels(options)
      })
      .catch(() => {
        if (!cancelled) setEngineModels([])
      })
    return () => {
      cancelled = true
    }
  }, [activeEngineId])

  // Provider routes edited in settings (model removed/renamed, provider
  // disabled) must reach open chat threads: refetch the session's catalog so
  // the picker and its current-selection state stay in sync.
  useEffect(() => {
    return window.ndDsh.providers.onChanged(() => {
      void refreshProviderRoutes()
      if (!activeSessionId || engineSessionIds.has(activeSessionId)) return
      setModelCatalogState('loading')
      void window.ndDsh.dsh.rpc('session.models', { sessionId: activeSessionId })
        .then((result) => {
          if (result.ok) {
            setModels(result.value as SessionModels)
            setModelCatalogState('ready')
          } else {
            setModels(null)
            setModelCatalogState('unavailable')
          }
        })
        .catch(() => {
          setModels(null)
          setModelCatalogState('unavailable')
        })
    })
  }, [activeSessionId, engineSessionIds, refreshProviderRoutes])

  // Opening the model picker probes every provider route for real: the main
  // process sends an authenticated request to each provider server and the
  // result (state + latency) renders as the row's status icon.
  const pingProviders = useCallback(async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return
    setProviderPings((current) => {
      const next = { ...current }
      for (const id of ids) next[id] = { testing: true }
      return next
    })
    await Promise.all(ids.map(async (id) => {
      try {
        const result = await window.ndDsh.providers.ping(id)
        setProviderPings((current) => ({ ...current, [id]: result }))
      } catch {
        setProviderPings((current) => ({
          ...current,
          [id]: { providerId: id, state: 'unreachable', hasApiKey: false, at: Date.now() },
        }))
      }
    }))
  }, [])

  useEffect(() => {
    if (!modelMenuOpen) return
    const ids = [...new Set((models?.groups ?? []).map((group) => group.id))]
    if (ids.length > 0) void pingProviders(ids)
  }, [modelMenuOpen, models, pingProviders])

  useEffect(() => {
    if (!externalPrompt) return
    setPrompt(externalPrompt.text)
    onExternalPromptConsumed?.()
  }, [externalPrompt, onExternalPromptConsumed])

  // Mention triggers: '/' lists skills from the runtime's session catalog,
  // '@' lists workspace files. Escape dismisses the current token until it
  // changes, so the menu does not fight the typist.
  const mentionTrigger = useMemo(() => {
    const trigger = detectMentionTrigger(prompt, mentionCaret)
    if (!trigger) return null
    return prompt.slice(trigger.start, trigger.end) === mentionDismissed ? null : trigger
  }, [prompt, mentionCaret, mentionDismissed])

  const skillsLoadedFor = useRef<string | null>(null)
  useEffect(() => {
    if (mentionTrigger?.kind !== 'skill' || !activeSessionId) return
    // The runtime skill catalog is a harness capability; engine chats have none.
    if (engineSessionIds.has(activeSessionId)) {
      setSkillsState('unavailable')
      return
    }
    if (skillsLoadedFor.current === activeSessionId) return
    skillsLoadedFor.current = activeSessionId
    setSkillsState('loading')
    void window.ndDsh.dsh.rpc('skill.list', { sessionId: activeSessionId })
      .then((result) => {
        const skills = result.ok ? ((result.value ?? {}) as { skills?: SkillSuggestion[] }).skills : undefined
        if (!Array.isArray(skills)) throw new Error('skill.list returned no catalog')
        setSkillItems(skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          ...(typeof skill.whenToUse === 'string' && skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
        })))
        setSkillsState('ready')
      })
      .catch(() => {
        setSkillItems([])
        setSkillsState('unavailable')
      })
  }, [mentionTrigger?.kind, activeSessionId, engineSessionIds])

  useEffect(() => {
    if (mentionTrigger?.kind !== 'file') return
    const query = mentionTrigger.query
    let cancelled = false
    const timer = setTimeout(() => {
      void window.ndDsh.workspace.suggest(query)
        .then((items) => { if (!cancelled) setFileItems(items) })
        .catch(() => { if (!cancelled) setFileItems([]) })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [mentionTrigger?.kind, mentionTrigger?.query])

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mentionTrigger) return []
    if (mentionTrigger.kind === 'skill') {
      const needle = mentionTrigger.query.toLowerCase()
      return skillItems
        .filter((skill) => skill.name.toLowerCase().includes(needle))
        .slice(0, MENTION_MENU_LIMIT)
        .map((skill) => ({
          kind: 'skill' as const,
          insert: `/${skill.name}`,
          label: skill.name,
          tag: 'SKILL',
          hover: [skill.description, skill.whenToUse].filter(Boolean).join(' — '),
          accent: SKILL_ACCENT,
          directory: false,
        }))
    }
    return fileItems
      .slice(0, MENTION_MENU_LIMIT)
      .map((file) => ({
        kind: 'file' as const,
        insert: `@${file.relativePath}`,
        label: file.relativePath,
        tag: file.kind === 'directory' ? 'FOLDER' : fileMentionTag(file.relativePath),
        hover: `@${file.relativePath} · ${file.kind === 'directory' ? 'directory mention' : 'file mention'}`,
        accent: file.kind === 'directory' ? FOLDER_ACCENT : fileAccent(file.relativePath),
        directory: file.kind === 'directory',
      }))
  }, [mentionTrigger, skillItems, fileItems])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionTrigger?.kind, mentionTrigger?.query, mentionItems.length])

  const acceptMention = useCallback((item: MentionItem): void => {
    const trigger = detectMentionTrigger(prompt, mentionCaret)
    if (!trigger) return
    const next = applyMention(prompt, trigger, item.insert)
    setPrompt(next.value)
    setMentionCaret(next.caret)
    setMentionDismissed(null)
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(next.caret, next.caret))
  }, [prompt, mentionCaret])

  // Opening a badge flyout must retire the mention popup: two popups over the
  // composer overlap and hide each other.
  const closeMention = useCallback((): void => {
    setMentionCaret(0)
  }, [])

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
        void refreshEngineSessions()
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
      const lastUserText = findLastUserPrompt(sessionId)
      // Quota errors on Antigravity threads are native-account limits; ND can
      // only route the user to the CLI's own account switch (/logout).
      const antigravityQuota = sessionId !== undefined
        && engineSessions.some((session) => session.sessionId === sessionId && session.engineId === ANTIGRAVITY_ENGINE_ID)
        && /quota/i.test(frame.message)
      appendNotice(sessionId, describeAgentError(frame.message, currentRoute()), 'error', lastUserText, antigravityQuota)
    }
  }

  /** The route this session is pinned to, so failure notices can name it. */
  function currentRoute(): AgentErrorRoute | null {
    const current = models?.current
    if (!current) return null
    const group = (models?.groups ?? []).find((item) => item.id === current.provider)
    return { provider: group?.name ?? current.provider, model: current.model }
  }

  function appendNotice(sessionId: string | undefined, text: string, tone: 'info' | 'error' = 'info', retryPrompt?: string, switchAccount = false): void {
    if (!sessionId) return
    setThreads((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), { kind: 'notice', id: crypto.randomUUID(), text, tone, ...(retryPrompt ? { retryPrompt } : {}), ...(switchAccount ? { switchAccount: true } : {}) }],
    }))
  }

  function findLastUserPrompt(sessionId: string | undefined): string | undefined {
    if (!sessionId) return undefined
    const items = threads[sessionId]
    if (!items) return undefined
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!
      if (item.kind === 'user') return item.text
    }
    return undefined
  }

  // Prompt that produced a given entry — walks back to the nearest user
  // message so Retry on an assistant bubble resends the right turn.
  function lastPromptBefore(list: ThreadEntry[], entryId: string): string | undefined {
    const index = list.findIndex((item) => item.id === entryId)
    if (index === -1) return undefined
    for (let i = index; i >= 0; i--) {
      const item = list[i]!
      if (item.kind === 'user') return item.text
    }
    return undefined
  }

  // ChatGPT-style scroll: follow the newest content only while the user is
  // already at (or near) the bottom; scrolling up to read wins.
  const [atBottom, setAtBottom] = useState(true)
  const onFeedScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }
  const scrollToEnd = (smooth = true): void => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
  useEffect(() => {
    if (atBottom) scrollToEnd(false)
  }, [entries.length, atBottom])

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
    if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
      setModelMenuOpen(false)
      setModelMenuPane('root')
      setPermissionMenuOpen(false)
      setEngineModelMenuOpen(false)
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
    setMentionCaret(0)
    setMentionDismissed(null)
    // A drafted engine chat has no session yet: the first send creates it on
    // that engine (router-side); harness sends stay exactly as before.
    const draftEngine = activeSessionId === null ? draftEngineId : null
    // Antigravity threads carry the picker's slug; every other engine keeps
    // its native model configuration (no flag is sent).
    const engineModelOption = activeEngineId === ANTIGRAVITY_ENGINE_ID && engineModel !== null
      ? { model: engineModel }
      : {}
    const options = activeSessionId !== null
      ? { sessionId: activeSessionId, ...engineModelOption }
      : draftEngine !== null
        ? { engineId: draftEngine, ...engineModelOption }
        : undefined
    try {
      const result = await window.ndDsh.harness.run(input, options)
      setActiveSessionId(result.sessionId)
      if (draftEngine !== null) {
        setDraftEngineId(null)
        void refreshEngineSessions()
      }
      void refreshElementChips()
      setThreads((current) => ({
        ...current,
        [result.sessionId]: [...(current[result.sessionId] ?? []), { kind: 'user', id: crypto.randomUUID(), text: input }],
      }))
      if (!sessions.some((s) => s.sessionId === result.sessionId)) void refreshSessions()
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

  /**
   * Antigravity authentication is native Google OAuth in the OS keyring, and
   * its terms forbid third-party OAuth flows — so switching accounts means
   * running the first-party `agy` TUI in an ND terminal, where `/logout`
   * purges the keyring and the next login re-authenticates in the browser.
   */
  const openAntigravityAccountTerminal = useCallback(async (): Promise<void> => {
    const terminalSession = 'antigravity-account'
    try {
      const existing = await window.ndDshTerminal.state(terminalSession)
      if (existing.terminals.length === 0) {
        const created = await window.ndDshTerminal.create({ sessionId: terminalSession, title: 'Antigravity account (agy)' })
        const terminalId = created.terminals[0]?.id
        if (terminalId) await window.ndDshTerminal.write(terminalSession, terminalId, 'agy\r')
      }
      setSwitchAccountTerminalOpen(true)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [onError])

  const retry = async (retryPrompt: string): Promise<void> => {
    if (busy || !retryPrompt.trim()) return
    const options = activeSessionId
      ? { sessionId: activeSessionId, ...(activeEngineId === ANTIGRAVITY_ENGINE_ID && engineModel !== null ? { model: engineModel } : {}) }
      : undefined
    try {
      const result = await window.ndDsh.harness.run(retryPrompt, options)
      setActiveSessionId(result.sessionId)
      void refreshElementChips()
      setThreads((current) => ({
        ...current,
        [result.sessionId]: [...(current[result.sessionId] ?? []), { kind: 'user', id: crypto.randomUUID(), text: retryPrompt }],
      }))
      if (!sessions.some((s) => s.sessionId === result.sessionId)) void refreshSessions()
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

  const selectModel = async (provider: string, model: string, reasoningEffort?: string): Promise<void> => {
    if (!activeSessionId) return
    try {
      await window.ndDsh.dsh.rpc('session.selectModel', {
        sessionId: activeSessionId,
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      })
      setModels((current) => current ? {
        ...current,
        current: { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) },
      } : current)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const selectReasoningEffort = async (effortId: string | undefined): Promise<void> => {
    if (!activeSessionId || !models) return
    try {
      await window.ndDsh.dsh.rpc('session.selectModel', {
        sessionId: activeSessionId,
        provider: models.current.provider,
        model: models.current.model,
        ...(effortId === undefined ? {} : { reasoningEffort: effortId }),
      })
      const { reasoningEffort: _previousEffort, ...route } = models.current
      setModels({
        ...models,
        current: { ...route, ...(effortId === undefined ? {} : { reasoningEffort: effortId }) },
      })
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
  const modelSelection = resolveModelSelectionDisplay(models, activeSessionId, providerRoutes, modelCatalogState)
  // The session's stored route can reference a provider/model that was since
  // removed or renamed in settings; flag it instead of rendering a ghost route.
  const currentSelectionStale = modelSelection.stale
  const reasoningEfforts = currentModelMeta?.reasoning?.efforts ?? []
  const activeEffort = currentModel?.reasoningEffort ?? currentModelMeta?.reasoning?.defaultEffort
  const activeEffortLabel = currentModelMeta?.reasoning
    ? reasoningEfforts.find((effort) => effort.id === activeEffort)?.name ?? activeEffort ?? 'Provider default'
    : undefined
  const configuredDefault = providerRoutes
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.map((model) => ({ provider, model })))
    .find(({ model }) => Boolean(model.id.trim()))
  const triggerModelLabel = currentModelMeta?.name
    ?? compactModelLabel(currentModel?.model ?? configuredDefault?.model.id ?? modelSelection.label)

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
    <div className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
      <aside className={cn('flex h-full min-h-0 w-[185px] shrink-0 grow-0 basis-[185px] flex-col overflow-hidden border-r border-border-soft bg-sidebar', sessionsCollapsed && 'hidden')}>
        <div className="space-y-1 px-3 pb-1 pt-2">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-soft bg-secondary px-3 py-[7px] text-xs font-medium text-soft transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
            onClick={() => void handleNewSession()}
          >
            <PlusIcon />
            <span>New Session</span>
          </button>
          {chatEngines.map((engine) => (
            <button
              key={engine.id}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-soft bg-transparent px-3 py-[7px] text-xs font-medium text-faint transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
              title={`${engine.description}${engine.unavailableReason ? `\n${engine.unavailableReason}` : ''}`}
              onClick={() => startEngineDraft(engine.id)}
            >
              <PlusIcon />
              <span>New {engine.name} chat</span>
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-faint">Workspaces</span>
            <div className="flex items-center gap-1">
              <button className="grid size-[22px] place-items-center rounded-[5px] text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[13px]" title="Refresh sessions" onClick={() => void refreshSessions()}>
                <SearchIcon />
              </button>
              <button
                className={cn(
                  'grid size-[22px] place-items-center rounded-[5px] transition-colors [&_svg]:size-[13px]',
                  showArchived ? 'bg-accent text-primary' : 'text-faint hover:bg-accent hover:text-foreground',
                )}
                title={showArchived ? 'Showing archived chats' : 'Show archived chats'}
                onClick={() => setShowArchived((value) => !value)}
              >
                <ArchiveIcon />
              </button>
              {onOpenSettings ? (
                <button className="grid size-[22px] place-items-center rounded-[5px] text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[13px]" onClick={() => onOpenSettings()} title="Settings">
                  <SettingsIcon />
                </button>
              ) : null}
              <button className="grid size-[22px] place-items-center rounded-[5px] text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[13px]" title="New session" onClick={() => void handleNewSession()}>
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-folder">
            <FolderIcon />
            <span className="truncate">{workspaceName ?? 'workspace'}</span>
          </div>

          {projects && projects.length > 0 ? (
            <div className="mt-1 flex flex-col gap-0.5">
              <span className="px-2 text-[9px] font-semibold tracking-[0.08em] text-faint">PROJECTS</span>
              {projects.map((project) => (
                <button
                  key={project.id}
                  className={cn(
                    'flex h-[23px] w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors [&_svg]:size-3 [&_svg]:shrink-0',
                    project.active
                      ? 'bg-selected-row text-selected-row-foreground hover:bg-selected-row'
                      : 'text-soft hover:bg-accent hover:text-foreground',
                  )}
                  title={project.linked ? project.name : `${project.name} (workspace not linked)`}
                  onClick={() => !project.active && onSelectProject?.(project.id)}
                >
                  <FolderIcon style={{ color: FOLDER_ACCENT }} />
                  <span className="min-w-0 truncate">{project.name}</span>
                  {project.active ? <span className="ml-auto text-[9px] font-bold text-primary">ACTIVE</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-1.5 flex flex-col gap-1">
            {!sessionsLoaded ? (
              <div className="px-0.5 py-2 text-[10px]/[1.5] text-faint">Loading sessions…</div>
            ) : visibleSessions.length === 0 && visibleEngineSessions.length === 0 ? (
              <div className="px-0.5 py-2 text-[10px]/[1.5] text-faint">{showArchived ? 'No archived chats' : 'No sessions yet'}</div>
            ) : (
              <>
                {visibleSessions.filter((session) => !session.blank || session.sessionId === activeSessionId).map((session) => (
                  <SessionCard
                    key={session.sessionId}
                    active={activeSessionId === session.sessionId}
                    busy={busySessions.has(session.sessionId)}
                    title={sessionTitle(session)}
                    time={sessionTime(session)}
                    archived={session.archived === true}
                    menuOpen={sessionMenuId === session.sessionId}
                    onMenuOpenChange={(open) => setSessionMenuId(open ? session.sessionId : null)}
                    onToggleArchive={() => {
                      setSessionMenuId(null)
                      void setSessionArchived(session.sessionId, session.archived !== true)
                    }}
                    onClick={() => selectSession(session)}
                  />
                ))}
                {visibleEngineSessions.map((session) => (
                  <SessionCard
                    key={session.sessionId}
                    active={activeSessionId === session.sessionId}
                    busy={busySessions.has(session.sessionId)}
                    title={session.title}
                    time={sessionTime({ updatedAt: session.updatedAt } as SessionSummary)}
                    engineChip={engines.find((engine) => engine.id === session.engineId)?.name ?? session.engineId}
                    cardTitle={`${engines.find((engine) => engine.id === session.engineId)?.name ?? session.engineId} chat`}
                    archived={session.archived === true}
                    menuOpen={sessionMenuId === session.sessionId}
                    onMenuOpenChange={(open) => setSessionMenuId(open ? session.sessionId : null)}
                    onToggleArchive={() => {
                      setSessionMenuId(null)
                      void setSessionArchived(session.sessionId, session.archived !== true)
                    }}
                    onClick={() => selectEngineSession(session)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <footer className="mt-auto border-t border-border-soft px-3 py-2">
          <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-soft transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[15px] [&_svg]:text-faint" onClick={() => onOpenSettings?.()} title="Settings">
            <SettingsIcon />
            <span>Settings</span>
          </button>
        </footer>
      </aside>

      <aside className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-0">
        <header className="flex h-[38px] shrink-0 items-center justify-between border-b border-border-soft bg-sidebar px-2.5">
          <div className="flex min-w-0 flex-1 flex-row items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-px">
              <span className="m-0 text-[8px]/[1.2] tracking-[0.1em] text-faint">{onHarnessThread ? 'ACTIVE THREAD' : 'ENGINE THREAD'}</span>
              <strong
                className="truncate text-[11px]/[1.25] font-normal text-foreground"
                title={activeSession ? sessionTitle(activeSession) : undefined}
              >
                {activeSession
                  ? sessionTitle(activeSession)
                  : draftEngineId !== null
                    ? `New ${activeEngineName} chat`
                    : 'No session'}
              </strong>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Select value={activeEngineId} onValueChange={selectHeaderEngine}>
              <SelectTrigger
                aria-label="Coding engine"
                className="h-6 w-[122px] gap-1 rounded-md border-border-soft bg-transparent px-2 font-mono text-[9px] text-faint shadow-none hover:bg-accent hover:text-foreground"
                title="Coding engine — selecting another engine starts a new chat"
              >
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ND_HARNESS_ENGINE_ID}>Default · ND Harness</SelectItem>
                {engines.filter((engine) => engine.id !== ND_HARNESS_ENGINE_ID).map((engine) => (
                  <SelectItem
                    key={engine.id}
                    value={engine.id}
                    disabled={!engine.available}
                    title={engine.available ? engine.description : engine.unavailableReason ?? `${engine.name} is unavailable`}
                  >
                    {engine.name}{engine.available ? '' : ' · Unavailable'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              aria-pressed={terminalOpen}
              disabled={!activeSessionId}
              className={cn(
                'flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                terminalOpen
                  ? 'border-primary/25 bg-primary/[0.08] text-primary'
                  : 'border-border-soft text-faint hover:bg-accent hover:text-foreground',
              )}
              title="Toggle this chat's isolated terminal (Ctrl/Cmd + Backtick)"
              onClick={() => setTerminalOpen((open) => !open)}
            >
              <span>&gt;_</span><span>Terminal</span>
            </button>
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                status?.state === 'ready' && 'bg-primary',
                (status?.state === 'running' || status?.state === 'starting') && 'animate-pulse-dot bg-info',
                status?.state === 'error' && 'bg-destructive',
                !status?.state || status.state === 'stopped' ? 'bg-faint' : '',
              )}
              title={status?.error}
            />
          </div>
        </header>

        {/* Harness runtime health is a harness-thread concern; engine chats
            authenticate natively and never route through ND providers. */}
        {onHarnessThread && !status?.sourceReady ? (
          <div className="mx-3 mt-2.5 flex flex-col gap-[3px] rounded-[7px] border border-info/25 bg-info/[0.07] p-2.5 text-[9px] text-info">
            <strong>Harness not built</strong>
            <span>Run <code className="font-mono">pnpm bootstrap</code> once.</span>
          </div>
        ) : null}
        {onHarnessThread && status?.sourceReady && status.apiKeyRequired && !status.apiKeyPresent ? (
          <div className="mx-3 mt-2.5 flex flex-col gap-[3px] rounded-[7px] border border-warning/25 bg-warning/10 p-2.5 text-[9px] text-warning">
            <div className="flex items-center justify-between gap-2">
              <strong>Provider credential missing</strong>
              {onOpenSettings ? (
                <button className="shrink-0 rounded border border-warning/35 px-1.5 py-0.5 font-medium hover:bg-warning/10" onClick={() => onOpenSettings('models')}>
                  Open Models
                </button>
              ) : null}
            </div>
            <span>Add a credential for <code className="font-mono">{status.provider}</code> in Settings → Models.</span>
          </div>
        ) : null}

        {changedFiles.length > 0 ? (
          <ChangedFilesCard files={changedFiles} {...(onOpenFile ? { onOpenFile } : {})} onError={onError} />
        ) : null}

        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-auto px-3 pt-2.5 pb-4" ref={scrollRef} onScroll={onFeedScroll}>
          {entries.length === 0 && !busy ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-5 text-center text-faint">
              <span className="mb-1.5 grid size-[46px] place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary [&_svg]:size-5"><SparkIcon /></span>
              <h3 className="m-0 text-[13px] font-semibold text-soft">{onHarnessThread ? 'ND Agent' : activeEngineName}</h3>
              <p className="m-0 max-w-[300px] text-[9px]/[1.6]">Ask anything about this workspace — open files, inspect the browser, or plan company goals. Context used during the thread appears on the composer badge.</p>
            </div>
          ) : null}
          {groupEntries(entries).map((group, index, groups) => {
            const isLastAssistant = group.kind === 'entry'
              && group.entry.kind === 'assistant'
              && groups.slice(index + 1).every((later) => later.kind !== 'entry' || later.entry.kind !== 'assistant')
            const entryRetryPrompt = group.kind === 'entry' && group.entry.kind === 'user' ? group.entry.text : lastPromptBefore(entries, group.key)
            return (
              <Fragment key={group.key}>
                {group.kind === 'tool-group' ? (
                  <ToolGroupView group={group} {...(onOpenFile ? { onOpenFile } : {})} />
                ) : group.kind === 'reasoning-group' ? (
                  <ReasoningCard text={group.text} />
                ) : (
                  <ThreadEntryView
                    entry={group.entry}
                    isLastAssistant={isLastAssistant}
                    {...(entryRetryPrompt ? { retryPrompt: entryRetryPrompt } : {})}
                    onAnswerApproval={answerApproval}
                    onRetry={retry}
                    onSwitchModel={() => { setModelMenuOpen(true); setModelMenuPane('root') }}
                    onSwitchAccount={() => void openAntigravityAccountTerminal()}
                    {...(onOpenFile ? { onOpenFile } : {})}
                  />
                )}
              </Fragment>
            )
          })}
          {busy ? (
            <div className="mb-2 flex items-center gap-2.5">
              <span className="grid size-[20px] shrink-0 place-items-center rounded-full bg-primary/15 [&_svg]:size-[11px]">
                <span className="flex items-center gap-[3px]">
                  <span className="size-1 animate-thinking rounded-full bg-primary" />
                  <span className="size-1 animate-thinking rounded-full bg-primary [animation-delay:160ms]" />
                  <span className="size-1 animate-thinking rounded-full bg-primary [animation-delay:320ms]" />
                </span>
              </span>
              <em className="text-[11px] font-normal not-italic text-faint">
                {status?.state === 'starting' && onHarnessThread ? 'Starting runtime…' : onHarnessThread ? 'Thinking…' : `${activeEngineName} is working…`}
              </em>
              {busyElapsedMs >= 30_000 ? (
                <span className="ml-auto mr-1 whitespace-nowrap font-mono text-[9px] tabular-nums text-fainter">
                  Working for {formatElapsed(busyElapsedMs)}
                </span>
              ) : null}
            </div>
          ) : null}
          </div>
          {!atBottom ? (
            <button
              className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-strong bg-surface-1 px-2.5 py-1 text-[9px] font-medium text-soft shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[10px]"
              onClick={() => { setAtBottom(true); scrollToEnd() }}
            >
              <ChevronDownIcon /> Latest
            </button>
          ) : null}
        </div>

        <TerminalDock
          open={switchAccountTerminalOpen || terminalOpen}
          sessionId={switchAccountTerminalOpen ? 'antigravity-account' : activeSessionId}
          {...(switchAccountTerminalOpen || !terminalCwd ? {} : { cwd: terminalCwd })}
          onOpenChange={switchAccountTerminalOpen ? setSwitchAccountTerminalOpen : setTerminalOpen}
          onError={onError}
        />

        <div className="mx-3 my-1.5 flex flex-col rounded-xl border border-border bg-surface-1 px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.18)]" ref={menuRef}>
          {elementChips.length > 0 ? (
            <div className="mb-[7px] flex flex-wrap gap-[5px]" aria-label="Staged UI elements">
              {elementChips.map((chip) => (
                <span
                  key={chip.id}
                  className="inline-flex cursor-help items-center gap-[5px] rounded-full border border-[#a78bfa]/35 bg-[#a78bfa]/10 py-0.5 pl-[7px] pr-1 font-mono text-[10px] text-[#a78bfa]"
                  title={chip.hover}
                >
                  <CrosshairIcon className="size-2.5" />
                  <span className="max-w-[180px] truncate">{chip.shortName}</span>
                  <button
                    type="button"
                    className="grid size-3.5 place-items-center rounded-full text-[11px] leading-none text-faint transition-colors hover:bg-[#a78bfa]/25 hover:text-foreground"
                    title="Remove this element"
                    onClick={() => void removeElementChip(chip.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="relative">
            {mentionTrigger ? (
              <div className="absolute inset-x-0 bottom-full z-[110] mb-1.5 max-h-[300px] overflow-y-auto rounded-[10px] border border-border-strong bg-surface-1 p-[5px] shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
                {mentionItems.length === 0 ? (
                  <div className="px-2.5 py-2 text-xs text-faint">
                    {mentionTrigger.kind === 'skill'
                      ? (activeSessionId
                        ? (skillsState === 'loading' ? 'Loading skills…' : skillsState === 'unavailable' ? 'Skills unavailable' : 'No matching skills')
                        : 'Send a message first to load skills')
                      : 'No matching files'}
                  </div>
                ) : (
                  <>
                    {mentionItems.map((item, index) => (
                      <button
                        key={item.kind + item.insert}
                        className={cn(
                          'flex w-full items-start gap-[9px] rounded-lg border-l-2 border-l-transparent px-2 py-[7px] text-left text-xs text-foreground transition-colors',
                          index === mentionIndex && '[&:hover]:bg-[transparent]',
                        )}
                        style={{
                          '--mention-accent': item.accent,
                          ...(index === mentionIndex
                            ? {
                                backgroundColor: 'color-mix(in srgb, var(--mention-accent) 12%, transparent)',
                                borderLeftColor: item.accent,
                              }
                            : {}),
                        } as CSSProperties}
                        onMouseEnter={() => setMentionIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          acceptMention(item)
                        }}
                      >
                        <span
                          className="inline-flex size-[22px] shrink-0 place-items-center rounded-md [&_svg]:size-3"
                          style={{
                            color: item.accent,
                            backgroundColor: 'color-mix(in srgb, var(--mention-accent) 18%, transparent)',
                          }}
                        >
                          {item.kind === 'skill' ? <SparkIcon /> : item.directory ? <FolderIcon /> : <FileIcon />}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-medium"><span className="mr-px font-bold" style={{ color: item.accent }}>{item.kind === 'skill' ? '/' : '@'}</span>{item.label}</span>
                            <span
                              className="shrink-0 rounded px-[5px] py-px text-[9px] font-semibold tracking-[0.04em]"
                              style={{
                                color: `color-mix(in srgb, ${item.accent} 72%, var(--color-foreground))`,
                                backgroundColor: `color-mix(in srgb, ${item.accent} 14%, transparent)`,
                              }}
                            >
                              {item.tag}
                            </span>
                          </span>
                          {item.hover ? (
                            <span
                              className={cn(
                                'block max-h-0 overflow-hidden text-[11px]/[1.45] text-faint opacity-0 transition-all duration-150',
                                index === mentionIndex && 'max-h-12 opacity-100',
                              )}
                            >
                              {item.hover}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                    <div className="mt-[3px] flex gap-3 border-t border-border px-2 pb-[3px] pt-1.5 text-[10px] text-fainter">
                      <span>↑↓ navigate</span>
                      <span>↵ insert</span>
                      <span>esc dismiss</span>
                    </div>
                  </>
                )}
              </div>
            ) : null}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setPrompt(event.target.value)
                setMentionCaret(event.target.selectionStart ?? event.target.value.length)
              }}
              onSelect={(event: ChangeEvent<HTMLTextAreaElement>) => {
                setMentionCaret(event.target.selectionStart ?? 0)
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (mentionTrigger) {
                  if (mentionItems.length > 0 && event.key === 'ArrowDown') {
                    event.preventDefault()
                    setMentionIndex((index) => (index + 1) % mentionItems.length)
                    return
                  }
                  if (mentionItems.length > 0 && event.key === 'ArrowUp') {
                    event.preventDefault()
                    setMentionIndex((index) => (index - 1 + mentionItems.length) % mentionItems.length)
                    return
                  }
                  if (mentionItems.length > 0 && (event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                    event.preventDefault()
                    const item = mentionItems[mentionIndex] ?? mentionItems[0]
                    if (item) acceptMention(item)
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setMentionDismissed(prompt.slice(mentionTrigger.start, mentionTrigger.end))
                    return
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void run()
                }
              }}
              placeholder="Ask the agent to work in this workspace — use @ for files and / for skills"
              rows={1}
              className="max-h-[180px] w-full resize-none overflow-y-auto bg-transparent text-xs/[1.5] text-foreground outline-none placeholder:text-faint"
            />
          </div>

          <div className="mt-[5px] flex flex-nowrap items-center justify-between gap-1 border-t border-border pt-[5px]">
            <div className="flex min-w-0 items-center gap-1">
              {onHarnessThread ? (
                <div className="relative">
                  <button
                    className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-1.5 py-[3px] text-[10px] font-medium text-[#f59e0b] transition-colors hover:bg-[#f59e0b]/20 [&_svg]:size-3"
                    onClick={() => { setPermissionMenuOpen(!permissionMenuOpen); setModelMenuOpen(false); setModelMenuPane('root'); closeMention() }}
                  >
                    <ShieldIcon />
                    <span>{PERMISSION_MODES.find((mode) => mode.id === permissionMode)?.label ?? permissionMode}</span>
                    <ChevronDownIcon />
                  </button>
                  {permissionMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-[130] mb-1.5 min-w-40 rounded-[10px] border border-border-strong bg-surface-1 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
                      {PERMISSION_MODES.map((mode) => (
                        <MenuItem key={mode.id} active={permissionMode === mode.id} onClick={() => void setSessionPermission(mode.id)}>
                          {mode.label}
                          {permissionMode === mode.id ? <CheckIcon className="text-primary" /> : null}
                        </MenuItem>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                // Engine threads manage their own permission policy (Codex runs
                // fail-closed unless an approval card is answered).
                <span
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[#f59e0b]/30 bg-[#f59e0b]/10 px-1.5 py-[3px] text-[10px] font-medium text-[#f59e0b] opacity-85 [&_svg]:size-3"
                  title={`${activeEngineName} manages its own sandbox and approval policy`}
                >
                  <ShieldIcon />
                  <span>{activeEngineName}</span>
                </span>
              )}
              <div
                className="relative"
                onMouseEnter={() => setContextMenuOpen(true)}
                onMouseLeave={() => setContextMenuOpen(false)}
              >
                <button
                  className="flex h-6 items-center gap-[5px] rounded-full border border-border-strong px-2 font-mono text-[8px] text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3"
                  title="Context used in this thread (hover to inspect)"
                  onClick={() => { setContextMenuOpen((open) => !open); closeMention() }}
                >
                  <ContextIcon />
                  <span>{threadContext.readFiles.length + threadContext.editedFiles.length}</span>
                </button>
                {contextMenuOpen ? (
                  <div className="absolute bottom-full left-0 right-auto z-[130] mb-1.5 max-h-[300px] w-[250px] overflow-auto rounded-[10px] border border-border-strong bg-surface-1 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
                    <div className="px-2.5 pb-1 pt-1.5 text-[8px] font-bold tracking-[0.12em] text-faint">THREAD CONTEXT</div>
                    {threadContext.readFiles.length === 0
                      && threadContext.editedFiles.length === 0
                      && threadContext.tools.length === 0 ? (
                      <>
                        <ContextRow label="Files" value="0" />
                        <ContextRow label="Tools" value="0" />
                      </>
                    ) : (
                      <>
                        {threadContext.editedFiles.length > 0 ? (
                          <div>
                            <small className="block px-2.5 pb-[3px] pt-1.5 text-[7px] font-bold tracking-[0.1em] text-primary">EDITED</small>
                            {threadContext.editedFiles.map((file) => (
                              <button
                                key={file}
                                className="flex w-full items-center gap-[7px] rounded-[5px] px-2.5 py-1 text-left font-mono text-[9px] text-soft transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[11px] [&_svg]:shrink-0 [&_svg]:text-faint"
                                onClick={() => onOpenFile?.(file)}
                                title={file}
                              >
                                <FileIcon />
                                <span className="truncate">{file}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {threadContext.readFiles.length > 0 ? (
                          <div>
                            <small className="block px-2.5 pb-[3px] pt-1.5 text-[7px] font-bold tracking-[0.1em] text-primary">READ</small>
                            {threadContext.readFiles.map((file) => (
                              <button
                                key={file}
                                className="flex w-full items-center gap-[7px] rounded-[5px] px-2.5 py-1 text-left font-mono text-[9px] text-soft transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[11px] [&_svg]:shrink-0 [&_svg]:text-faint"
                                onClick={() => onOpenFile?.(file)}
                                title={file}
                              >
                                <FileIcon />
                                <span className="truncate">{file}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {threadContext.tools.length > 0 ? (
                          <div>
                            <small className="block px-2.5 pb-[3px] pt-1.5 text-[7px] font-bold tracking-[0.1em] text-primary">TOOLS</small>
                            {threadContext.tools.map((tool) => (
                              <ContextRow key={tool.name} label={tool.name} value={`×${tool.count}`} />
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                    <div className="mt-1 border-t border-border-soft px-2.5 py-1.5 font-mono text-[8px] text-faint">
                      {threadContext.userMessages} prompt{threadContext.userMessages === 1 ? '' : 's'} · {threadContext.assistantMessages} repl{threadContext.assistantMessages === 1 ? 'y' : 'ies'}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-1">
              {busy ? <SpinnerIcon className="size-[15px] animate-spin text-primary" /> : null}

              {/* Model/reasoning routing is an ND Harness capability; engine
                  chats keep their native model configuration. */}
              {onHarnessThread ? (<>
              <div className="relative">
                <button
                  className={cn('flex min-w-0 max-w-[135px] shrink items-center gap-1 rounded-md border border-border-soft bg-secondary px-1.5 py-[3px] text-[10px] text-soft transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0', currentSelectionStale && 'text-warning')}
                  title={modelSelection.title}
                  onClick={() => {
                    const nextOpen = !modelMenuOpen
                    setModelMenuOpen(nextOpen)
                    setModelMenuPane('root')
                    setPermissionMenuOpen(false)
                    closeMention()
                  }}
                >
                  <span className="truncate font-medium">{triggerModelLabel}</span>
                  {activeEffortLabel ? <span className="shrink-0 text-faint">· {activeEffortLabel}</span> : null}
                  <ChevronDownIcon />
                </button>

                {modelMenuOpen ? (
                  <div
                    className="absolute bottom-full right-0 z-[130] mb-1.5 w-[286px] overflow-hidden rounded-xl border border-border-strong bg-surface-1 p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.42)]"
                    role="menu"
                    aria-label="Model controls"
                  >
                    {modelMenuPane === 'root' ? (<>
                      <ModelMenuRow
                        label="Model"
                        value={triggerModelLabel}
                        disabled={modelGroups.length === 0}
                        onClick={() => setModelMenuPane('model')}
                      />
                      {currentModelMeta?.reasoning && reasoningEfforts.length > 0 ? (
                        <ModelMenuRow
                          icon={<BrainIcon />}
                          label="Effort"
                          value={activeEffortLabel ?? 'Provider default'}
                          onClick={() => setModelMenuPane('effort')}
                        />
                      ) : null}
                      {modelCatalogState === 'loading' ? (
                        <div className="flex items-center gap-2 px-2.5 py-2 text-[10px] text-faint"><SpinnerIcon className="size-3 animate-spin" />Loading model capabilities…</div>
                      ) : null}
                      {activeSessionId && modelCatalogState === 'unavailable' ? (
                        <div className="rounded-md bg-warning/10 px-2.5 py-2 text-[10px] text-warning">This session’s model catalog is unavailable.</div>
                      ) : null}
                      {!activeSessionId ? (
                        <div className="px-2.5 py-1.5 text-[10px]/[1.4] text-faint">Start a session to change its model and capabilities.</div>
                      ) : null}
                      <div className="mx-1 my-1 h-px bg-border" />
                      <div className="px-2 pb-1 pt-0.5 text-[8px] font-semibold uppercase tracking-[0.11em] text-fainter">Advanced</div>
                      <MenuItem onClick={() => { setModelMenuOpen(false); setModelMenuPane('root'); if (onOpenSettings) onOpenSettings('models') }}>
                        <span className="flex items-center gap-2"><SettingsIcon />Manage providers & models</span>
                        <ChevronRightIcon className="text-faint" />
                      </MenuItem>
                    </>) : null}

                    {modelMenuPane === 'model' ? (<>
                      <ModelMenuHeader title="Choose model" onBack={() => setModelMenuPane('root')} />
                      <div className="max-h-[310px] overflow-y-auto px-0.5 pb-0.5">
                        {models?.failures.map((failure) => (
                          <div className="mx-1 mb-1 rounded-md bg-warning/10 px-2 py-1.5 text-[9px]/[1.35] text-warning" key={failure.id}>
                            {failure.name}: {failure.message}
                          </div>
                        ))}
                        {modelGroups.map((group) => (
                          <section className="mb-1 last:mb-0" key={group.id}>
                            <div className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">
                              <ProviderPingIndicator ping={providerPings[group.id]} />
                              <span className="truncate">{group.name}</span>
                            </div>
                            {group.models.map((model) => {
                              const selected = currentModel?.provider === group.id && currentModel.model === model.id
                              return (
                                <button
                                  type="button"
                                  role="menuitemradio"
                                  aria-checked={selected}
                                  className={cn(
                                    'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                                    selected ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent hover:text-foreground',
                                  )}
                                  key={model.id}
                                  title={model.description ?? model.id}
                                  onClick={() => {
                                    void selectModel(group.id, model.id, model.reasoning?.defaultEffort)
                                    setModelMenuOpen(false)
                                    setModelMenuPane('root')
                                  }}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-[11px] font-medium">{model.name ?? compactModelLabel(model.id)}</span>
                                    {model.name ? <span className="block truncate font-mono text-[8px] text-fainter">{model.id}</span> : null}
                                    {model.description ? <span className="mt-0.5 block line-clamp-2 text-[9px]/[1.35] text-faint">{model.description}</span> : null}
                                  </span>
                                  {selected ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : null}
                                </button>
                              )
                            })}
                          </section>
                        ))}
                      </div>
                    </>) : null}

                    {modelMenuPane === 'effort' && currentModelMeta?.reasoning ? (<>
                      <ModelMenuHeader title="Reasoning effort" onBack={() => setModelMenuPane('root')} />
                      <div className="px-0.5 pb-0.5">
                        {currentModelMeta.reasoning.defaultEffort === undefined ? (
                          <CapabilityOption
                            label="Provider default"
                            active={activeEffort === undefined}
                            onClick={() => { void selectReasoningEffort(undefined); setModelMenuOpen(false); setModelMenuPane('root') }}
                          />
                        ) : null}
                        {reasoningEfforts.map((effort) => (
                          <CapabilityOption
                            key={effort.id}
                            label={effort.name}
                            description={effort.description}
                            badge={effort.id === currentModelMeta.reasoning?.defaultEffort ? 'Default' : undefined}
                            active={activeEffort === effort.id}
                            onClick={() => { void selectReasoningEffort(effort.id); setModelMenuOpen(false); setModelMenuPane('root') }}
                          />
                        ))}
                      </div>
                    </>) : null}
                  </div>
                ) : null}
              </div>
              </>) : activeEngineId === ANTIGRAVITY_ENGINE_ID ? (
              <div className="relative">
                <button
                  className="flex min-w-0 max-w-[135px] shrink items-center gap-1 rounded-md border border-border-soft bg-secondary px-1.5 py-[3px] text-[10px] text-soft transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground [&_svg]:size-3 [&_svg]:shrink-0"
                  title={engineModel ?? 'Antigravity keeps its own configured model'}
                  onClick={() => {
                    const nextOpen = !engineModelMenuOpen
                    setEngineModelMenuOpen(nextOpen)
                    setModelMenuOpen(false)
                    setPermissionMenuOpen(false)
                    closeMention()
                  }}
                >
                  <span className="truncate font-medium">{engineModel ? compactModelLabel(engineModel) : 'Native model'}</span>
                  <ChevronDownIcon />
                </button>

                {engineModelMenuOpen ? (
                  <div
                    className="absolute bottom-full right-0 z-[130] mb-1.5 w-[286px] overflow-hidden rounded-xl border border-border-strong bg-surface-1 p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.42)]"
                    role="menu"
                    aria-label="Antigravity model"
                  >
                    <div className="px-2 pb-1 pt-0.5 text-[8px] font-semibold uppercase tracking-[0.11em] text-fainter">Antigravity model</div>
                    <div className="max-h-[310px] overflow-y-auto px-0.5 pb-0.5">
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={engineModel === null}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                          engineModel === null ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent hover:text-foreground',
                        )}
                        onClick={() => { setEngineModel(null); setEngineModelMenuOpen(false) }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-medium">Native default</span>
                          <span className="block truncate font-mono text-[8px] text-fainter">whatever the CLI is configured with</span>
                        </span>
                        {engineModel === null ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : null}
                      </button>
                      {engineModels.map((model) => {
                        const selected = engineModel === model.id
                        return (
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={cn(
                              'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                              selected ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent hover:text-foreground',
                            )}
                            key={model.id}
                            title={model.id}
                            onClick={() => { setEngineModel(model.id); setEngineModelMenuOpen(false) }}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-medium">{model.name ?? model.id}</span>
                              {model.name ? <span className="block truncate font-mono text-[8px] text-fainter">{model.id}</span> : null}
                            </span>
                            {selected ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : null}
                          </button>
                        )
                      })}
                      {engineModels.length === 0 ? (
                        <div className="px-2.5 py-2 text-[10px]/[1.4] text-faint">Model catalog is unavailable; Antigravity keeps its native configuration.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              ) : null}

              {busy ? (
                <button
                  className="grid size-[25px] shrink-0 place-items-center rounded-[7px] bg-primary text-primary-foreground transition-[filter] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-3.5"
                  onClick={() => void stop()}
                  title="Cancel the running turn"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  className="grid size-[25px] shrink-0 place-items-center rounded-[7px] bg-primary text-primary-foreground transition-[filter] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 [&_svg]:size-3.5"
                  disabled={!prompt.trim()}
                  onClick={() => void run()}
                  title="Send"
                >
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-3 pb-2.5 pt-1.5 text-center text-[8px] text-fainter">Browser actions run in the pane you can see.</div>
      </aside>
    </div>
  )
}

/**
 * Session thread card in the left sidebar. The card stays a plain select
 * button; Archive/Unarchive lives on a sibling kebab that swaps in for the
 * timestamp on hover, so no interactive element nests inside another.
 */
function SessionCard({ active, busy, title, time, engineChip, cardTitle, archived = false, menuOpen, onMenuOpenChange, onToggleArchive, onClick }: {
  active: boolean
  busy: boolean
  title: string
  time: string
  engineChip?: string
  cardTitle?: string
  archived?: boolean
  menuOpen: boolean
  onMenuOpenChange(open: boolean): void
  onToggleArchive(): void
  onClick(): void
}) {
  return (
    <div className="group relative">
      <button
        className={cn(
          'flex w-full items-center justify-between rounded-lg border border-border-soft bg-surface-1 px-2.5 py-1.5 text-left text-[11px] text-soft transition-colors',
          active
            ? 'border-border-strong bg-secondary text-foreground shadow-sm'
            : 'hover:bg-accent hover:text-foreground',
        )}
        {...(cardTitle ? { title: cardTitle } : {})}
        onClick={onClick}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('size-[5px] shrink-0 rounded-full', busy ? 'bg-primary' : 'bg-faint opacity-40')} />
          <ChatIcon className="size-[13px] shrink-0 text-faint" />
          <span className="truncate font-medium">{title}</span>
          {engineChip ? (
            <span className="shrink-0 rounded-md border border-border-soft px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.04em] text-soft">
              {engineChip}
            </span>
          ) : null}
        </span>
        <span className={cn('shrink-0 text-[10px] text-faint transition-opacity', menuOpen ? 'opacity-0' : 'group-hover:opacity-0')}>{time}</span>
      </button>
      <button
        aria-label="Chat options"
        className={cn(
          'absolute right-[4px] top-1/2 hidden -translate-y-1/2 place-items-center rounded-[5px] p-px text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[14px]',
          menuOpen ? 'grid' : 'group-hover:grid',
        )}
        onClick={() => onMenuOpenChange(!menuOpen)}
      >
        <MoreHorizontalIcon />
      </button>
      {menuOpen ? (
        <>
          {/* Click-away catcher sits under the flyout and above the page. */}
          <div className="fixed inset-0 z-[135]" onMouseDown={() => onMenuOpenChange(false)} />
          <div className="absolute right-0 top-full z-[140] mt-1 min-w-[124px] rounded-[10px] border border-border-strong bg-surface-1 p-1 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
            <button
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[13px]"
              onClick={onToggleArchive}
            >
              <ArchiveIcon />
              <span>{archived ? 'Unarchive' : 'Archive'}</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Generic flyout menu row with optional check mark. */
function MenuItem({ children, active = false, onClick }: {
  children: ReactNode
  active?: boolean | undefined
  onClick(): void
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors [&_svg]:size-[13px]',
        active ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent hover:text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ModelMenuRow({ icon, label, value, disabled = false, onClick }: {
  icon?: ReactNode
  label: string
  value: string
  disabled?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-55 [&_svg]:size-3.5 [&_svg]:shrink-0"
      onClick={onClick}
    >
      {icon ? <span className="text-faint">{icon}</span> : null}
      <span className="font-medium">{label}</span>
      <span className="ml-auto max-w-[145px] truncate text-faint">{value}</span>
      {!disabled ? <ChevronRightIcon className="text-fainter" /> : null}
    </button>
  )
}

function ModelMenuHeader({ title, onBack }: { title: string; onBack(): void }) {
  return (
    <div className="mb-1 flex items-center gap-1 border-b border-border px-0.5 pb-1.5">
      <button
        type="button"
        className="grid size-7 place-items-center rounded-md text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
        aria-label="Back"
        onClick={onBack}
      >
        <ChevronRightIcon className="rotate-180" />
      </button>
      <span className="text-[11px] font-semibold text-foreground">{title}</span>
    </div>
  )
}

function CapabilityOption({ label, description, badge, active, onClick }: {
  label: string
  description?: string | undefined
  badge?: string | undefined
  active: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent hover:text-foreground',
      )}
      onClick={onClick}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[11px] font-medium">
          {label}
          {badge ? <span className="rounded-full border border-border-strong px-1.5 py-px text-[7px] font-semibold uppercase tracking-wide text-faint">{badge}</span> : null}
        </span>
        {description ? <span className="mt-0.5 block text-[9px]/[1.35] text-faint">{description}</span> : null}
      </span>
      {active ? <CheckIcon className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  )
}

function compactModelLabel(value: string): string {
  const clean = value.replace(/^\u26a0\s*/, '').trim()
  return clean.split('/').filter(Boolean).at(-1) ?? clean
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1 font-mono text-[9px] text-soft">
      <span>{label}</span>
      <span className="text-faint">{value}</span>
    </div>
  )
}

interface ThreadEntryViewProps {
  entry: ThreadEntry
  isLastAssistant?: boolean
  retryPrompt?: string
  onAnswerApproval?(entry: Extract<ThreadEntry, { kind: 'approval' }>, outcome: 'allowed-once' | 'rejected'): void
  onOpenFile?(relativePath: string): void
  onRetry?(prompt: string): void
  onSwitchModel?(): void
  onSwitchAccount?(): void
}

function ThreadEntryView({ entry, isLastAssistant, retryPrompt, onAnswerApproval, onOpenFile, onRetry, onSwitchModel, onSwitchAccount }: ThreadEntryViewProps) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="group mb-4 flex justify-end">
          <div className="flex max-w-[85%] items-end gap-1.5">
            <CopyMessageButton text={entry.text} />
            <article className="rounded-2xl rounded-br-sm bg-info/[0.13] px-3.5 py-2.5">
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[12.5px]/[1.65] text-foreground">{entry.text}</div>
            </article>
          </div>
        </div>
      )
    case 'assistant': {
      const segments = splitAssistantSegments(entry.text)
      return (
        <article className="group mb-2 flex items-start gap-2.5">
          <span className="mt-[2px] grid size-[20px] shrink-0 place-items-center rounded-full bg-primary/15 text-primary [&_svg]:size-[11px]">
            <SparkIcon />
          </span>
          <div className="min-w-0 flex-1 pb-1">
            {segments.map((segment, index) => {
              if (segment.kind === 'review') return <ReviewVerdictCard key={index} review={segment.review} />
              if (segment.kind === 'plan') return <PlanSubmittedCard key={index} plan={segment.plan} />
              return <MarkdownLite key={index} text={segment.text} {...(onOpenFile ? { onOpenFile } : {})} />
            })}
            {entry.streaming ? <span className="ml-0.5 inline-block h-[13px] w-1.5 animate-caret-blink bg-primary align-bottom" /> : null}
            {!entry.streaming ? (
              <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <CopyMessageButton text={entry.text} labeled />
                {isLastAssistant && onRetry && retryPrompt ? (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[10px]"
                    title="Regenerate from the last prompt"
                    onClick={() => onRetry(retryPrompt)}
                  >
                    <RotateIcon /> Retry
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </article>
      )
    }
    case 'notice':
      return (
        <article
          className={cn(
            'mb-3 ml-[30px] rounded-lg border px-3 py-2.5',
            entry.tone === 'error'
              ? 'border-destructive/30 bg-destructive/[0.08] text-destructive'
              : 'border-warning/20 bg-warning/[0.07]',
          )}
        >
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Runtime</div>
          <div className={cn('whitespace-pre-wrap [overflow-wrap:anywhere] text-[11px]/[1.55]', entry.tone === 'error' ? 'text-destructive' : 'text-soft')}>{entry.text}</div>
          {entry.switchAccount ? (
            <div className="mt-1.5 text-[10px]/[1.45] text-muted-foreground/80">
              Quota is native to your Antigravity account: wait for the reset, switch model, or click <span className="font-medium">Switch account</span> to run <code className="font-mono">agy</code> in a terminal and use <code className="font-mono">/logout</code> to sign in as another Google user.
            </div>
          ) : null}
          {(entry.tone === 'error' && entry.retryPrompt && onRetry) || (entry.switchAccount && onSwitchAccount) ? (
            <div className="mt-2 flex items-center gap-2">
              {entry.tone === 'error' && entry.retryPrompt && onRetry ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/20 active:bg-destructive/25"
                  onClick={() => onRetry(entry.retryPrompt!)}
                >
                  <RotateIcon className="size-3" />
                  Retry
                </button>
              ) : null}
              {onSwitchModel ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={onSwitchModel}
                >
                  Switch Model
                </button>
              ) : null}
              {entry.switchAccount && onSwitchAccount ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Opens a terminal running the Antigravity CLI: type /logout, then sign in with another Google account"
                  onClick={onSwitchAccount}
                >
                  Switch account
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      )
    case 'tool':
      // groupEntries() handles all tool entries; this branch only fires for
      // entries rendered outside the feed (e.g. approval previews).
      return <ToolCardView entry={entry} />
    case 'todo':
      return (
        <article className="mb-3 ml-[30px] rounded-lg border border-border-soft bg-surface-1 px-2.5 py-2">
          {entry.items.map((item: TodoItem, index) => (
            <div
              className={cn('flex items-center gap-[7px] py-[3px] text-[10px]', item.status === 'completed' ? 'text-faint line-through' : 'text-soft')}
              key={`${item.content}-${index}`}
            >
              <span
                className={cn(
                  'grid size-[13px] shrink-0 place-items-center rounded border text-[9px]',
                  item.status === 'completed' ? 'border-primary/40 text-primary' : item.status === 'in_progress' ? 'border-info text-info' : 'border-border-strong',
                )}
              >
                {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '·' : ''}
              </span>
              <span>{item.content}</span>
            </div>
          ))}
        </article>
      )
    case 'approval':
      return (
        <article className="mb-3 ml-[30px] rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-foreground [&_svg]:size-[13px] [&_svg]:text-warning">
            <ShieldIcon /> Approval required
          </div>
          <div className="mb-2.5 flex flex-col gap-1">
            <span className="font-mono text-[9px] text-soft">{entry.toolName}</span>
            {entry.reason ? <span className="text-[10px]/[1.45] text-muted-foreground">{entry.reason}</span> : null}
          </div>
          {entry.resolved ? (
            <div className="text-[9px] text-muted-foreground">{entry.resolved === 'allowed-once' ? '✓ Allowed once' : '✗ Rejected'}</div>
          ) : (
            <div className="flex gap-2">
              <button
                className="cursor-pointer rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/[0.18]"
                onClick={() => onAnswerApproval?.(entry, 'allowed-once')}
              >
                Allow once
              </button>
              <button
                className="cursor-pointer rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => onAnswerApproval?.(entry, 'rejected')}
              >
                Reject
              </button>
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

function ToolCardView({ entry }: { entry: Extract<ThreadEntry, { kind: 'tool' }> }) {
  return (
    <article
      className={cn(
        'mb-2 rounded-lg border bg-meta px-2.5 py-2',
        entry.status === 'running' && 'border-info/20',
        entry.status === 'error' && 'border-destructive',
        !entry.status || (entry.status !== 'running' && entry.status !== 'error') ? 'border-border-soft' : '',
      )}
    >
      <div className="mb-[5px] flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[9px] font-semibold text-soft">{entry.name}</span>
        <span
          className={cn(
            'shrink-0 text-[8px] uppercase tracking-[0.08em]',
            entry.status === 'running' ? 'animate-pulse-dot text-info' : entry.status === 'error' ? 'text-destructive' : 'text-faint',
          )}
        >
          {entry.status === 'running' ? 'running…' : entry.status === 'error' ? 'failed' : 'done'}
        </span>
      </div>
      {entry.args !== undefined && entry.name.startsWith('fs_') ? (
        <div className="truncate font-mono text-[8px] text-primary">{toolPath(entry.args)}</div>
      ) : null}
      {entry.result ? (
        <pre className="mt-1.5 max-h-[140px] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-[5px] border border-border-soft bg-surface-0 px-2 py-[7px] font-mono text-[8px]/[1.5] text-muted-foreground">
          {entry.result}
        </pre>
      ) : null}
    </article>
  )
}

function ReasoningCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n').filter((line) => line.trim())
  const firstLine = lines[0] ?? ''
  return (
    <div className="mb-2 ml-[30px]">
      <button
        className="flex items-center gap-1.5 rounded-md py-[3px] pl-[5px] pr-2 text-[11px] text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[11px]"
        onClick={() => setOpen((v) => !v)}
      >
        <BrainIcon className="text-primary/50" />
        <span className="max-w-[320px] truncate font-medium">{firstLine}</span>
        <span className="text-[9px] text-fainter">{lines.length > 1 ? `+${lines.length - 1}` : ''}</span>
        <ChevronDownIcon className={cn('ml-0.5 transition-transform [&]:size-[10px]', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1 border-l-2 border-primary/20 pl-2.5">
          {lines.map((line, index) => (
            <div key={index} className="[overflow-wrap:anywhere] font-mono text-[9.5px]/[1.7] text-faint">{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ToolGroupView({ group, onOpenFile }: {
  group: Extract<DisplayGroup, { kind: 'tool-group' }>
  onOpenFile?: (path: string) => void
}) {
  const hasRunning = group.tools.some((t) => t.status === 'running')
  const hasError = group.tools.some((t) => t.status === 'error')
  // Auto-open while tools are running so the user sees live activity.
  const [open, setOpen] = useState(hasRunning)

  // If a group transitions from running→done, keep the open state stable.
  const prevRunning = useRef(hasRunning)
  useEffect(() => {
    if (!prevRunning.current && hasRunning) setOpen(true)
    prevRunning.current = hasRunning
  }, [hasRunning])

  const iconEl = group.icon === 'file' ? (
    <FileIcon className={cn(hasError ? 'text-destructive' : 'text-soft/60')} />
  ) : group.icon === 'skill' ? (
    <SparkIcon className="text-primary/60" />
  ) : group.icon === 'read' ? (
    <FileIcon className="text-faint" />
  ) : group.icon === 'command' ? (
    <TerminalIcon className={cn(hasRunning ? 'text-info' : hasError ? 'text-destructive' : 'text-faint')} />
  ) : group.icon === 'search' ? (
    <SearchIcon className={cn(hasRunning ? 'text-info' : hasError ? 'text-destructive' : 'text-faint')} />
  ) : (
    <ContextIcon className={cn(hasRunning ? 'text-info' : hasError ? 'text-destructive' : 'text-faint')} />
  )

  return (
    <div className="mb-2 ml-[30px]">
      {/* Summary pill — icon + friendly verb label + expand/collapse */}
      <button
        className={cn(
          'flex items-center gap-1.5 rounded-md py-[3px] pl-[5px] pr-2 text-[11px] transition-colors hover:bg-accent [&_svg]:size-[11px]',
          hasError ? 'text-destructive' : hasRunning ? 'text-info' : 'text-faint hover:text-foreground',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {iconEl}
        <span className="font-medium">
          {group.label}
          {hasRunning ? <span className="ml-1 inline-block animate-pulse-dot">…</span> : null}
        </span>
        <ChevronDownIcon className={cn('ml-0.5 transition-transform [&]:size-[10px]', open && 'rotate-180')} />
      </button>

      {/* Expanded rows inside a soft bordered box, like a mini terminal log */}
      {open ? (
        <div className="mt-1 flex flex-col gap-px rounded-lg border border-border-soft bg-surface-1 px-1 py-1">
          {group.tools.map((tool) => {
            const path = toolPath(tool.args)
            const preview = toolPreview(tool)
            const rowLabel = preview ?? path ?? tool.name
            const isCommand = group.icon === 'command' && preview !== undefined
            const clickable = Boolean(path && onOpenFile)
            const Wrapper = clickable ? 'button' : 'div'
            return (
              <Wrapper
                key={tool.id}
                className={cn(
                  'flex items-center gap-1.5 rounded-[5px] px-[7px] py-[3px] text-left font-mono text-[9px] [&_svg]:size-[10px] [&_svg]:shrink-0',
                  clickable
                    ? 'cursor-pointer text-soft/80 transition-colors hover:bg-accent hover:text-foreground'
                    : 'cursor-default text-faint',
                  tool.status === 'error' && '!text-destructive',
                )}
                {...(clickable ? { onClick: () => onOpenFile!(path!) } : {})}
                title={tool.result ? tool.result.slice(0, 120) : rowLabel}
              >
                {isCommand ? (
                  <span className="shrink-0 select-none text-primary/70">$</span>
                ) : group.icon === 'file' || group.icon === 'read' ? (
                  <FileIcon />
                ) : group.icon === 'skill' ? (
                  <SparkIcon />
                ) : group.icon === 'command' ? (
                  <TerminalIcon />
                ) : group.icon === 'search' ? (
                  <SearchIcon />
                ) : (
                  <ContextIcon />
                )}
                <span className="min-w-0 truncate">{rowLabel}</span>
                {(() => {
                  // File-change rows: per-file +/- counts, like a diff stat.
                  if (group.icon !== 'file' || tool.status === 'running') return null
                  const changes = parseFileChanges(tool.args)
                  const info = changes.find((c) => c.path === path) ?? (changes.length === 1 ? changes[0] : undefined)
                  if (!info || (info.added === 0 && info.removed === 0)) return null
                  return (
                    <span className="ml-auto flex shrink-0 gap-1 font-sans text-[8px] not-italic">
                      {info.added > 0 ? <span className="text-green-400">+{info.added}</span> : null}
                      {info.removed > 0 ? <span className="text-red-400">−{info.removed}</span> : null}
                    </span>
                  )
                })()}
                {tool.status === 'running' ? (
                  <span className="ml-auto shrink-0 animate-pulse-dot font-sans text-[8px] not-italic text-info">running</span>
                ) : tool.status === 'error' ? (
                  <span className="ml-auto shrink-0 font-sans text-[8px] not-italic text-destructive">failed</span>
                ) : (
                  <CheckIcon className="ml-auto shrink-0 text-fainter/50" />
                )}
              </Wrapper>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function CopyMessageButton({ text, labeled = false }: { text: string; labeled?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[10px]',
        labeled ? '' : 'mb-0.5 opacity-0 group-hover:opacity-100',
      )}
      title="Copy message"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1_600)
        } catch {
          // Clipboard may be denied; nothing to fall back to in the renderer.
        }
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {labeled ? (copied ? 'Copied' : 'Copy') : null}
    </button>
  )
}

function ReviewVerdictCard({ review }: { review: ReviewVerdict }) {
  const passed = review.verdict === 'pass'
  return (
    <div className={cn(
      'mb-2 mt-1 rounded-lg border px-3 py-2.5',
      passed ? 'border-primary/30 bg-primary/[0.06]' : 'border-destructive/30 bg-destructive/[0.07]',
    )}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.06em] [&_svg]:size-[9px]',
          passed ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive',
        )}>
          {passed ? <CheckIcon /> : <CloseIcon />}
          {review.verdict}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-faint">Review verdict</span>
      </div>
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[11px]/[1.6] text-soft">{review.summary}</div>
      {review.issues && review.issues.length > 0 ? (
        <div className="mt-2 border-t border-border-soft pt-1.5">
          <div className="mb-[3px] text-[9px] font-semibold uppercase tracking-[0.08em] text-warning">Issues</div>
          {review.issues.map((issue, index) => (
            <div key={index} className="flex items-start gap-1.5 py-px text-[10.5px]/[1.5] text-soft">
              <span className="mt-[5px] size-[4px] shrink-0 rounded-full bg-warning" />
              <span className="min-w-0">{issue}</span>
            </div>
          ))}
        </div>
      ) : null}
      {review.memory && review.memory.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-border-soft pt-1.5">
          {review.memory.map((lesson, index) => (
            <span
              key={index}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-soft bg-surface-1 px-1.5 py-px text-[9px] text-faint"
              title={lesson.content}
            >
              <BrainIcon className="size-[9px] shrink-0 text-faint" />
              <span className="truncate">{lesson.title}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PlanSubmittedCard({ plan }: { plan: ProjectPlanInput }) {
  const taskCount = plan.milestones.reduce((sum, milestone) => sum + (milestone.tasks?.length ?? 0), 0)
  return (
    <div className="mb-2 mt-1 rounded-lg border border-info/25 bg-info/[0.06] px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-info [&_svg]:size-[10px]">
        <FolderIcon /> Project plan
      </div>
      <div className="text-[11.5px] font-semibold text-foreground">{plan.goal.title}</div>
      <div className="mt-0.5 text-[10.5px]/[1.5] text-soft">{plan.goal.description}</div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {plan.milestones.map((milestone, index) => (
          <span
            key={index}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-soft bg-surface-1 px-1.5 py-px text-[9px] text-faint"
            title={milestone.description}
          >
            <span className="truncate font-medium text-soft">{milestone.title}</span>
            <span className="shrink-0">{milestone.tasks?.length ?? 0} task{(milestone.tasks?.length ?? 0) === 1 ? '' : 's'}</span>
          </span>
        ))}
      </div>
      <div className="mt-1.5 text-[9px] text-faint">
        {plan.milestones.length} milestone{plan.milestones.length === 1 ? '' : 's'} · {taskCount} task{taskCount === 1 ? '' : 's'} queued
      </div>
    </div>
  )
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
    <article className="mb-3 ml-[30px] rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5">
      <div className="mb-2 text-[10px] font-semibold text-foreground">Questions</div>
      {entry.questions.map((question) => (
        <div className="mb-2 last:mb-0" key={question.id}>
          <div className="text-[10px]/[1.5] text-soft">{question.question}</div>
          <div className="mt-1.5 flex flex-wrap gap-[5px]">
            {(question.options ?? []).map((option) => (
              <button
                key={option.label}
                className={cn(
                  'cursor-pointer rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors',
                  (selections[question.id] ?? []).includes(option.label)
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border-strong bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                onClick={() => toggleOption(question, option.label, question.multiSelect ?? false)}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            className="mt-1.5 w-full rounded-md border border-border-strong bg-surface-0 px-2.5 py-[5px] text-[10px] text-foreground outline-none placeholder:text-faint focus:border-primary/40"
            placeholder="Other…"
            value={custom[question.id] ?? ''}
            onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
          />
        </div>
      ))}
      {entry.resolved ? (
        <div className="mt-2 text-[9px] text-muted-foreground">✓ Answered</div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            className="cursor-pointer rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/[0.18]"
            onClick={() => void submit()}
          >
            Submit answers
          </button>
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
    case 'agent/reasoning': {
      const text = typeof data.text === 'string' ? data.text : ''
      if (!text) return
      const last = entries.at(-1)
      if (last?.kind === 'reasoning' && last.text.length < 4000) {
        last.text = `${last.text}\n${text}`
      } else {
        entries.push({ kind: 'reasoning', id: crypto.randomUUID(), text })
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
    if (FS_WRITE_TOOL_NAMES.has(entry.name)) {
      const path = toolPath(entry.args)
      if (path) files.add(path)
      continue
    }
    // Codex "file change" batches carry per-file diffs in args.files.
    if (entry.name === 'file change') {
      for (const change of parseFileChanges(entry.args)) {
        if (change.path) files.add(change.path)
      }
    }
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
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

function pingTitle(ping: ProviderPingResult): string {
  if (ping.state === 'ok') {
    if (!ping.hasApiKey) {
      return `Server reachable but sessions cannot authenticate — no stored credential${ping.status !== undefined ? ` (HTTP ${ping.status})` : ''}. Save a key in Model settings.`
    }
    return `Server reachable with the stored credential — ${ping.latencyMs ?? '?'}ms round trip${ping.status !== undefined ? ` (HTTP ${ping.status})` : ''}`
  }
  if (ping.state === 'auth') {
    return `Server reachable but the stored credential was rejected${ping.status !== undefined ? ` (HTTP ${ping.status})` : ''}`
  }
  return 'No answer from the server (timeout or network error)'
}

/** Status dot + live latency for a provider row in the model flyout. */
function ProviderPingIndicator({ ping }: { ping: PingEntry | undefined }) {
  if (!ping) return null
  if ('testing' in ping) {
    return (
      <span className="inline-flex items-center gap-1" title="Probing the provider server…">
        <span className="size-[7px] shrink-0 animate-ping-pulse rounded-full bg-faint" />
      </span>
    )
  }
  const missingCredential = ping.state === 'ok' && !ping.hasApiKey
  return (
    <span className="inline-flex items-center gap-1" title={pingTitle(ping)}>
      {missingCredential
        ? <span className="inline-block size-[7px] shrink-0 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.55)]" />
        : <PingDot state={ping.state} />}
      {!missingCredential && ping.state === 'ok' && ping.latencyMs !== undefined ? <span className="font-mono text-[9px] text-faint">{ping.latencyMs}ms</span> : null}
      {missingCredential ? <span className="text-[9px] font-semibold text-amber-500">no key</span> : null}
    </span>
  )
}

function PingDot({ state, title }: { state: ProviderPingResult['state']; title?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        state === 'ok' && 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.55)]',
        state === 'auth' && 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.55)]',
        state === 'unreachable' && 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.55)]',
        !state || (state !== 'ok' && state !== 'auth' && state !== 'unreachable') ? 'bg-fainter' : '',
      )}
      title={title}
    />
  )
}
