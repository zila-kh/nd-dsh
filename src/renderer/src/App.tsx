import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { toast } from 'sonner'
import type { BrowserState, ExternalElementPickView, HarnessStatus, InspectScope, ThemeMode, ThemeState, WorkspaceFile, WorkspaceState } from '../../shared/contracts'
import type { OrganizationSnapshot } from '../../shared/organization'
import { BrowserPane } from './components/BrowserPane'
import { Button } from './components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Badge } from './components/ui/badge'
import { Toaster } from './components/ui/sonner'
import { ChatPanel } from './components/ChatPanel'
import { DesignView } from './components/DesignView'
import { DiffView } from './components/DiffView'
import { EditorPane } from './components/EditorPane'
import { Explorer } from './components/Explorer'
import { BrowserIcon, CameraIcon, CompanyIcon, CrosshairIcon, ExternalIcon, FileIcon, MonitorIcon, PencilIcon, QualityIcon, SettingsIcon, SidebarToggleIcon, SparkIcon } from './components/Icons'
import { OrganizationDashboard, type CompanyView } from './components/OrganizationDashboard'
import { QaView } from './components/QaView'
import { RuntimePrompts } from './components/RuntimePrompts'
import { ThemeToggle } from './components/ThemeToggle'
import { TitlebarIconButton } from './components/titlebar-icon-button'
import { cn } from './lib/utils'
import { pickSelfElement } from './lib/self-element-picker'
import {
  capabilitySubTabFromLocation,
  generalSubTabFromLocation,
  settingsHash,
  settingsTabFromLocation,
  type CapabilitySubTab,
  type GeneralSubTab,
  type SettingsTab,
} from './lib/settings-route'

const SettingsPane = lazy(() => import('./components/SettingsPane').then((module) => ({ default: module.SettingsPane })))

type ProductView = 'company' | 'agent' | 'design' | 'qa' | 'settings'

type AgentPane = 'files' | 'browser'

const VIEWS: ProductView[] = ['company', 'agent', 'design', 'qa', 'settings']

const CHAT_MIN_PX = 580
const CHAT_MIN_PX_SIDEBAR_COLLAPSED = 420
const WORKSPACE_MIN_PX = 480

function viewFromHash(): ProductView {
  const route = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return VIEWS.includes(route as ProductView) ? (route as ProductView) : 'agent'
}

function hashForView(view: ProductView, settingsTab: SettingsTab, settingsSubTabs: SettingsSubTabs): string {
  if (view !== 'settings') return `#/${view}`
  const subTab = settingsTab === 'general'
    ? settingsSubTabs.general
    : settingsTab === 'capabilities'
      ? settingsSubTabs.capabilities
      : undefined
  return settingsHash(settingsTab, subTab)
}

interface SettingsSubTabs {
  general: GeneralSubTab
  capabilities: CapabilitySubTab
}

function settingsSubTabsFromLocation(): SettingsSubTabs {
  return {
    general: generalSubTabFromLocation(),
    capabilities: capabilitySubTabFromLocation(),
  }
}

function isFloatOverlayRoute(): boolean {
  return window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] === 'float'
}

function harnessDotClasses(state: HarnessStatus['state'] | undefined): string {
  if (state === 'ready' || state === 'running') return 'bg-primary'
  if (state === 'starting') return 'bg-info animate-pulse-dot'
  if (state === 'error') return 'bg-destructive'
  return 'bg-faint'
}

const paneTabClasses = (active: boolean): string =>
  cn(
    'flex h-6 shrink-0 items-center gap-[5px] rounded-[5px] border border-transparent px-2.5 text-xs whitespace-nowrap transition-colors [&_svg]:size-3',
    active
      ? 'border-primary/20 bg-primary/[0.06] text-primary'
      : 'text-faint hover:bg-accent hover:text-muted-foreground',
  )

const navButtonClasses = (active: boolean): string =>
  cn(
    'relative flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-xs font-medium whitespace-nowrap outline-none transition-[color,background-color,border-color,box-shadow]',
    'focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15 [&_svg]:size-[14px]',
    active
      ? 'border-primary/20 bg-primary/[0.10] text-strong shadow-[0_1px_0_rgba(255,255,255,0.03),0_3px_10px_rgba(0,0,0,0.16)] [&_svg]:text-primary'
      : 'border-transparent text-faint hover:border-border-soft hover:bg-accent/70 hover:text-foreground',
  )

export default function App() {
  const isFloatOverlay = isFloatOverlayRoute()
  const uiPreview = window.ndDshRuntimeMode === 'ui-preview'
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [orgState, setOrgState] = useState<OrganizationSnapshot | null>(null)
  const [browserState, setBrowserState] = useState<BrowserState | null>(null)
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null)
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | null>(null)
  const [activeDiff, setActiveDiff] = useState<{ relativePath: string; staged: boolean } | null>(null)
  const [view, setView] = useState<ProductView>(viewFromHash)
  const [companyView, setCompanyView] = useState<CompanyView>('workspace')
  const [companyCreateOpen, setCompanyCreateOpen] = useState(false)
  const [companyDraft, setCompanyDraft] = useState({ name: '', mission: '' })
  const [failedCompanyIds, setFailedCompanyIds] = useState<Set<string>>(() => new Set())
  const [failedProjectIds, setFailedProjectIds] = useState<Set<string>>(() => new Set())
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(settingsTabFromLocation)
  const [settingsSubTabs, setSettingsSubTabs] = useState<SettingsSubTabs>(settingsSubTabsFromLocation)
  const [agentPane, setAgentPane] = useState<AgentPane>('files')
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false)
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false)
  const [externalPrompt, setExternalPrompt] = useState<{ id: string; text: string } | null>(null)
  const [theme, setTheme] = useState<ThemeState | null>(null)
  const [appInspectCountdown, setAppInspectCountdown] = useState<number | null>(null)
  const [appInspectInFlight, setAppInspectInFlight] = useState(false)
  const [elementInspectActive, setElementInspectActive] = useState(false)
  // The dedicated overlay window loads the same bundle at #/float. Initialize
  // it directly in external mode so it never renders the full workbench into
  // the compact pill bounds before effects get a chance to run.
  const [inspectScope, setInspectScope] = useState<InspectScope>(() => isFloatOverlay ? 'external' : 'self')
  const [pendingPick, setPendingPick] = useState<{ element: ExternalElementPickView; targetTitle: string; shortName: string; hover: string; pickId?: string; hasShot?: boolean } | null>(null)
  const [pendingAppInspect, setPendingAppInspect] = useState<{ displayLabel: string; width: number; height: number; copiedToClipboard: boolean; scope: InspectScope } | null>(null)
  const [elementAttachmentVersion, setElementAttachmentVersion] = useState(0)
  const appInspectTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const notify = useCallback((message: string) => toast(message, { duration: 5000 }), [])

  const pillDragRef = useRef<{ x: number; y: number } | null>(null)

  const toggleInspectScope = (): void => {
    const nextScope: InspectScope = inspectScope === 'external' ? 'self' : 'external'
    setInspectScope(nextScope)
    void window.ndDsh.window?.setFloatMode(nextScope === 'external')
  }

  useEffect(() => {
    if (inspectScope === 'external') {
      if (!isFloatOverlay) void window.ndDsh.window?.setFloatMode(true)
      document.documentElement.classList.add('float-mode')
      document.body.classList.add('float-mode')
      document.getElementById('root')?.classList.add('float-mode')
    } else {
      document.documentElement.classList.remove('float-mode')
      document.body.classList.remove('float-mode')
      document.getElementById('root')?.classList.remove('float-mode')
    }
  }, [inspectScope, isFloatOverlay])

  useEffect(() => {
    return window.ndDsh.window?.onFloatMode?.((enabled) => {
      if (!isFloatOverlay || enabled) setInspectScope(enabled ? 'external' : 'self')
    })
  }, [isFloatOverlay])

  useEffect(() => {
    if (!isFloatOverlay) return
    const hasSummary = pendingAppInspect !== null
    void window.ndDsh.window?.resizeFloatWindow(hasSummary ? 324 : 170, hasSummary ? 194 : 56)
  }, [isFloatOverlay, pendingAppInspect])

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state()
      .then((next) => { if (mounted) setOrgState(next) })
      .catch((cause) => notify(errorMessage(cause)))
    const off = window.ndDshOrganization.onChanged((next) => {
      if (mounted) setOrgState(next)
    })
    return () => {
      mounted = false
      off()
    }
  }, [notify])

  const handlePillPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Buttons opt out of the draggable region. Capturing their pointer on the
    // parent retargets pointer-up and prevents their click handlers from firing.
    if (e.target instanceof Element && e.target.closest('.app-no-drag')) return
    pillDragRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePillPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!pillDragRef.current) return
    const deltaX = e.clientX - pillDragRef.current.x
    const deltaY = e.clientY - pillDragRef.current.y
    if (deltaX !== 0 || deltaY !== 0) {
      void window.ndDsh.window?.moveFloatWindow(deltaX, deltaY)
    }
  }

  const handlePillPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    pillDragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

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
        .then((result) => {
          setPendingAppInspect({
            displayLabel: result.displayLabel,
            width: result.width,
            height: result.height,
            copiedToClipboard: result.copiedToClipboard,
            scope: inspectScope,
          })
          toast(result.copiedToClipboard
            ? `Screenshot of ${selfScope ? 'this app' : 'the screen'} sent to the agent and copied to the clipboard.`
            : `Screenshot of ${selfScope ? 'this app' : 'the screen'} sent to the agent.`, { duration: 5000 })
        })
        .catch((cause) => notify(errorMessage(cause)))
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

  useEffect(() => {
    if (!pendingAppInspect) return
    const timeout = window.setTimeout(() => setPendingAppInspect(null), 8_000)
    return () => window.clearTimeout(timeout)
  }, [pendingAppInspect])

  useEffect(() => () => {
    if (appInspectTimer.current !== undefined) clearInterval(appInspectTimer.current)
  }, [])

  useEffect(() => {
    if (!pendingPick) return
    const timeout = window.setTimeout(() => setPendingPick(null), 7_000)
    return () => window.clearTimeout(timeout)
  }, [pendingPick])

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
    const pick = inspectScope === 'self'
      ? pickSelfElement()
      : window.ndDsh.capture.inspectElement('external')
    void pick
      .then((result) => {
        if (result.outcome === 'picked' && result.element && result.targetTitle && result.shortName && result.hover) {
          setPendingPick({
            element: result.element,
            targetTitle: result.targetTitle,
            shortName: result.shortName,
            hover: result.hover,
            ...(result.pickId !== undefined ? { pickId: result.pickId } : {}),
            ...(result.hasShot !== undefined ? { hasShot: result.hasShot } : {}),
          })
        } else if (result.outcome === 'canceled') {
          notify('Element pick canceled.')
        } else {
          notify(result.message ?? 'No external app debug port found.')
        }
      })
      .catch((cause) => notify(errorMessage(cause)))
      .finally(() => setElementInspectActive(false))
  }

  const addElementToChat = async (): Promise<void> => {
    const pick = pendingPick
    if (!pick) return
    try {
      await window.ndDsh.capture.stageElement(pick.element, pick.targetTitle, pick.pickId)
      setPendingPick(null)
      setElementAttachmentVersion((version) => version + 1)
    } catch (cause) {
      notify(errorMessage(cause))
    }
  }

  // Full agent-ready context block (selector, styles, source, HTML) — the
  // exact text the agent receives with Add-to-chat. Falls back to the
  // compact hover summary if the main-process pick store has expired.
  const copyPickedElementContext = (): void => {
    const pick = pendingPick
    if (!pick) return
    const fallback = (): void => {
      navigator.clipboard
        .writeText(pick.hover)
        .then(() => toast('Element reference copied to the clipboard.', { duration: 5000 }))
        .catch((cause) => notify(errorMessage(cause)))
    }
    if (!pick.pickId) {
      fallback()
      return
    }
    void window.ndDsh.capture.copyElementContext(pick.pickId)
      .then((copied) => {
        if (copied) toast('Full element context copied to the clipboard.', { duration: 5000 })
        else fallback()
      })
      .catch((cause) => notify(errorMessage(cause)))
  }

  const copyPickedSelector = (): void => {
    const pick = pendingPick
    if (!pick) return
    navigator.clipboard
      .writeText(pick.element.selector ?? pick.shortName)
      .then(() => toast('CSS selector copied to the clipboard.', { duration: 5000 }))
      .catch((cause) => notify(errorMessage(cause)))
  }

  const copyPickedShot = (): void => {
    const pick = pendingPick
    if (!pick?.pickId || !pick.hasShot) return
    void window.ndDsh.capture.copyElementShot(pick.pickId)
      .then((copied) => {
        if (copied) toast('Element screenshot copied to the clipboard.', { duration: 5000 })
        else notify('No element screenshot is available for this pick.')
      })
      .catch((cause) => notify(errorMessage(cause)))
  }

  useEffect(() => {
    if (isFloatOverlay) return
    void Promise.all([
      window.ndDsh.workspace.state().then(setWorkspace),
      window.ndDsh.browser.state().then(setBrowserState),
      window.ndDsh.harness.status().then(setHarnessStatus),
    ]).catch((cause) => notify(errorMessage(cause)))

    void window.ndDsh.surface.set('workbench').catch((cause) => notify(errorMessage(cause)))
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
      void window.ndDsh.browser.setVisible(false).catch(() => undefined)
      void window.ndDsh.dshView.setVisible(false).catch(() => undefined)
    }
  }, [isFloatOverlay, notify])

  useEffect(() => {
    if (isFloatOverlay) return
    let mounted = true
    void window.ndDsh.theme.state()
      .then((state) => { if (mounted) setTheme(state) })
      .catch((cause) => notify(errorMessage(cause)))
    const offTheme = window.ndDsh.theme.onChanged(setTheme)
    return () => {
      mounted = false
      offTheme()
    }
  }, [isFloatOverlay, notify])

  useEffect(() => {
    if (!theme) return
    document.documentElement.dataset.theme = theme.effective
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme.effective)
  }, [theme])

  useEffect(() => {
    if (isFloatOverlay) return
    const target = hashForView(view, settingsTab, settingsSubTabs)
    if (window.location.hash === target) return
    try {
      window.history.pushState(null, '', target)
    } catch {
      window.location.hash = target
    }
  }, [isFloatOverlay, settingsSubTabs, settingsTab, view])

  useEffect(() => {
    const onPopState = (): void => {
      setView(viewFromHash())
      setSettingsTab(settingsTabFromLocation())
      setSettingsSubTabs(settingsSubTabsFromLocation())
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('hashchange', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('hashchange', onPopState)
    }
  }, [])

  const openSettings = (tab?: SettingsTab): void => {
    if (tab) setSettingsTab(tab)
    setView('settings')
  }

  const selectTheme = (mode: ThemeMode): void => {
    void window.ndDsh.theme.set(mode).then(setTheme).catch((cause) => notify(errorMessage(cause)))
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
      notify(errorMessage(cause))
    }
  }

  const openDiff = (relativePath: string, staged: boolean): void => {
    setActiveDiff({ relativePath, staged })
  }

  const askAgent = (prompt: string): void => {
    setExternalPrompt({ id: crypto.randomUUID(), text: prompt })
    setView('agent')
  }

  const company = orgState?.companies.find((item) => item.id === orgState.activeCompanyId) ?? orgState?.companies[0] ?? null
  const companyProjects = orgState && company ? orgState.projects.filter((item) => item.companyId === company.id) : []
  const project = companyProjects.find((item) => item.id === orgState?.activeProjectId) ?? companyProjects[0] ?? null

  const createCompany = (event: FormEvent): void => {
    event.preventDefault()
    void window.ndDshOrganization.mutate({ type: 'company.create', name: companyDraft.name, mission: companyDraft.mission })
      .then(() => { setCompanyDraft({ name: '', mission: '' }); setCompanyCreateOpen(false) })
      .catch((cause) => notify(errorMessage(cause)))
  }

  const switchCompany = (id: string): void => {
    void window.ndDshOrganization.mutate({ type: 'company.activate', id })
      .then(() => setFailedCompanyIds((prev) => (prev.has(id) ? new Set([...prev].filter((value) => value !== id)) : prev)))
      .catch(() => setFailedCompanyIds((prev) => new Set(prev).add(id)))
  }

  const switchProject = (id: string): void => {
    void window.ndDshOrganization.mutate({ type: 'project.activate', id })
      .then(() => setFailedProjectIds((prev) => (prev.has(id) ? new Set([...prev].filter((value) => value !== id)) : prev)))
      .catch(() => setFailedProjectIds((prev) => new Set(prev).add(id)))
  }

  const navItems: Array<{ id: ProductView; label: string; icon: ReactNode }> = [
    { id: 'company', label: 'Company', icon: <CompanyIcon /> },
    { id: 'agent', label: 'Agent', icon: <SparkIcon /> },
    { id: 'design', label: 'Design', icon: <PencilIcon /> },
    { id: 'qa', label: 'QA', icon: <QualityIcon /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
  ]

  if (inspectScope === 'external') {
    return (
      <div className="float-mode flex h-screen w-screen flex-col items-center justify-start gap-2 bg-transparent p-1.5 select-none font-sans overflow-hidden">
        <div
          className="app-drag flex items-center gap-1.5 rounded-full border-2 border-primary bg-surface-1/95 p-1.5 text-primary shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur cursor-grab active:cursor-grabbing"
          onPointerDown={handlePillPointerDown}
          onPointerMove={handlePillPointerMove}
          onPointerUp={handlePillPointerUp}
        >
          <button
            type="button"
            aria-label="Inspect screen"
            className="app-no-drag grid size-8 place-items-center rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
            onClick={startAppInspect}
            title="Inspect external screen (Ctrl+Alt+C)"
          >
            <CameraIcon className="size-4 text-primary" />
          </button>
          <button
            type="button"
            aria-label="Inspect element in external app"
            className="app-no-drag grid size-7 place-items-center rounded-full text-faint hover:bg-accent hover:text-foreground transition-colors"
            onClick={startElementInspect}
            title="Inspect element in external app (Ctrl+Alt+E)"
          >
            <CrosshairIcon className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Restore full ND-DSH app window"
            className="app-no-drag grid size-7 place-items-center rounded-full text-faint hover:bg-accent hover:text-foreground transition-colors"
            onClick={() => {
              void window.ndDsh.window?.setFloatMode(false)
            }}
            title="Restore full ND-DSH app window"
          >
            <MonitorIcon className="size-3.5" />
          </button>
        </div>
        {pendingAppInspect ? (
          <div role="dialog" aria-label="Inspected app info" className="app-no-drag flex w-[300px] flex-col gap-2 rounded-[10px] border border-border-strong bg-surface-1 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.5)]">
            <div className="flex min-w-0 items-center gap-[7px]">
              <CameraIcon className="size-[13px] shrink-0 text-primary" />
              <strong className="overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap">
                App Inspect Summary
              </strong>
            </div>
            <div className="flex flex-col gap-1 pl-[20px] text-[10px] text-muted-foreground font-mono">
              <div><span className="text-faint">Target:</span> {pendingAppInspect.displayLabel}</div>
              <div><span className="text-faint">Resolution:</span> {pendingAppInspect.width} × {pendingAppInspect.height}</div>
              <div className="text-primary font-medium">✓ Sent to ND Chat Agent</div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto rounded-md px-2.5 py-1 text-[11px]"
                onClick={() => setPendingAppInspect(null)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('grid h-full w-full select-none bg-[radial-gradient(circle_at_35%_-20%,var(--bg-glow),transparent_35%)]', uiPreview ? 'grid-rows-[25px_auto_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]')}>
      {uiPreview ? (
        <aside className="flex items-center justify-center border-b border-warning/25 bg-warning/10 px-3 text-[10px] font-bold tracking-[0.08em] text-warning">
          UI PREVIEW · DEVELOPMENT FIXTURES · ACTIONS ARE SIMULATED · LAUNCH ELECTRON FOR REAL RUNTIME FEATURES
        </aside>
      ) : null}
      <header className="app-drag grid grid-cols-[minmax(180px,1fr)_auto_minmax(180px,1fr)] items-center gap-[18px] border-b border-border-soft bg-titlebar pr-[148px] pl-3">
        <div className="flex min-w-0 flex-col gap-[7px]">
          <div className="flex min-w-0 items-center gap-2">
            <TitlebarIconButton
              title={sessionsCollapsed ? 'Expand sessions sidebar' : 'Collapse sessions sidebar'}
              onClick={() => setSessionsCollapsed((collapsed) => !collapsed)}
            >
              <SidebarToggleIcon collapsed={sessionsCollapsed} />
            </TitlebarIconButton>
            <span className="grid size-6 shrink-0 place-items-center rounded-[7px] border border-primary/30 bg-primary/10 text-sm font-extrabold tracking-[0.08em] text-primary">ND</span>
            <div className="flex min-w-0 flex-col">
              <strong className="text-[15px] tracking-[0.06em] text-strong">ND-DSH</strong>
              <span className="overflow-hidden text-xs text-faint text-ellipsis whitespace-nowrap">
                {workspace?.projectName ?? workspace?.name ?? 'No workspace'}
              </span>
            </div>
          </div>
          {orgState ? (
            <div className="app-no-drag flex items-center gap-[8px]">
              <label className="flex items-center gap-[5px]">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-faint">COMPANY</span>
                <Select value={company?.id ?? ''} onValueChange={switchCompany}>
                  <SelectTrigger size="sm" aria-label="Switch company" className="h-6! max-w-[220px]! min-w-0 gap-1.5 rounded-md border-border-strong bg-surface-1/50 px-2! text-xs! text-soft [&>svg]:size-3.5">
                    <SelectValue placeholder="No company" />
                  </SelectTrigger>
                  <SelectContent align="start" position="popper">
                    {orgState.companies.map((item) => <SelectItem key={item.id} value={item.id} disabled={failedCompanyIds.has(item.id)}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <Dialog open={companyCreateOpen} onOpenChange={setCompanyCreateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="xs" className="h-6 shrink-0 rounded-md px-2 text-xs" title="Create a new AI company">
                    + New
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[460px]">
                  <DialogHeader>
                    <DialogTitle>Create AI company</DialogTitle>
                    <DialogDescription>Seeds an AI PM, builder, reviewer, researcher, teams, skills, workflow, memory boundary, and safety policies for the new company.</DialogDescription>
                  </DialogHeader>
                  <form onSubmit={createCompany} className="grid gap-[9px]">
                    <Input placeholder="Company name" value={companyDraft.name} onChange={(event) => setCompanyDraft((value) => ({ ...value, name: event.target.value }))} required autoFocus />
                    <Input placeholder="Company mission" value={companyDraft.mission} onChange={(event) => setCompanyDraft((value) => ({ ...value, mission: event.target.value }))} required />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" type="button">Cancel</Button>
                      </DialogClose>
                      <Button type="submit">Create AI company</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <label className="flex items-center gap-[5px]">
                <span className="text-[10px] font-semibold tracking-[0.1em] text-faint">PROJECT</span>
                <Select value={project?.id ?? ''} onValueChange={switchProject}>
                  <SelectTrigger size="sm" aria-label="Switch project" className="h-6! max-w-[220px]! min-w-0 gap-1.5 rounded-md border-border-strong bg-surface-1/50 px-2! text-xs! text-soft [&>svg]:size-3.5">
                    <SelectValue placeholder="No project" />
                  </SelectTrigger>
                  <SelectContent align="start" position="popper">
                    {companyProjects.map((item) => <SelectItem key={item.id} value={item.id} disabled={failedProjectIds.has(item.id)}>{item.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <Button variant="outline" size="xs" className="h-6 rounded-md px-2 text-xs" onClick={() => { setView('company'); setCompanyView('operations') }}>
                Manage
              </Button>
            </div>
          ) : null}
        </div>
        <nav className="app-no-drag flex min-w-0 items-center justify-center" aria-label="ND-DSH navigation">
          <div className="flex min-w-0 items-center justify-center gap-0.5 rounded-lg border border-border-soft bg-surface-1/70 p-[3px] shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_4px_14px_rgba(0,0,0,0.12)]">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={navButtonClasses(view === item.id)}
                onClick={() => setView(item.id)}
                title={item.label}
                aria-current={view === item.id ? 'page' : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="app-no-drag flex min-w-0 items-center justify-end gap-[7px] overflow-hidden font-mono text-xs text-faint">
          {workspace?.binding === 'project' ? (
            <Badge
              variant="outline"
              className="h-[17px] shrink-0 rounded-full border-primary/20 bg-primary/[0.06] px-[5px] font-sans text-[10px] font-extrabold tracking-[0.08em] text-primary"
            >
              SYNC
            </Badge>
          ) : null}
          <TitlebarIconButton
            active={true}
            title="Inspect target: this ND-DSH app — the camera captures this window, the crosshair picks elements here. Click to target external apps instead."
            onClick={toggleInspectScope}
          >
            <MonitorIcon />
          </TitlebarIconButton>
          <TitlebarIconButton
            title="Inspect this app (Ctrl+Alt+C) — captures this ND-DSH window, sends it to the ND chat agent, and copies it to the clipboard"
            disabled={appInspectCountdown !== null || appInspectInFlight}
            onClick={startAppInspect}
          >
            <CameraIcon />
          </TitlebarIconButton>
          <TitlebarIconButton
            title="Inspect an element in this app (Ctrl+Alt+E) — hover and click any element in ND-DSH, then Add to chat"
            disabled={elementInspectActive}
            onClick={startElementInspect}
          >
            <CrosshairIcon />
          </TitlebarIconButton>
          <ThemeToggle theme={theme} onSelect={selectTheme} />
          <span className={cn('inline-block size-1.5 shrink-0 rounded-full', harnessDotClasses(harnessStatus?.state))} title={harnessStatus?.model ?? 'Runtime offline'} />
          <TitlebarIconButton
            title={workspaceCollapsed ? 'Expand workspace pane' : 'Collapse workspace pane'}
            onClick={() => setWorkspaceCollapsed((collapsed) => !collapsed)}
          >
            <SidebarToggleIcon collapsed={!workspaceCollapsed} />
          </TitlebarIconButton>
        </div>
      </header>

      <main className="relative min-h-0 min-w-0 overflow-hidden bg-surface-0">
        {view !== 'settings' ? (
          <Group orientation="horizontal" className="h-full w-full">
            <Panel className="flex min-w-0 flex-col overflow-hidden" defaultSize={580} minSize={sessionsCollapsed ? CHAT_MIN_PX_SIDEBAR_COLLAPSED : CHAT_MIN_PX}>
              <ChatPanel
                status={harnessStatus}
                {...(workspace?.projectName || workspace?.name ? { workspaceName: workspace.projectName ?? workspace.name } : {})}
                sessionsCollapsed={sessionsCollapsed}
                onError={notify}
                onOpenSettings={openSettings}
                onOpenFile={(path) => void openFile(path)}
                externalPrompt={externalPrompt}
                onExternalPromptConsumed={() => setExternalPrompt(null)}
                elementAttachmentVersion={elementAttachmentVersion}
              />
            </Panel>
            <Separator
              aria-label="Resize chat pane"
              className="w-[5px] shrink-0 cursor-col-resize touch-none [&_div]:transition-[width,background-color] [&_div]:duration-150 hover:[&_div]:w-0.5 hover:[&_div]:bg-primary active:[&_div]:w-0.5 active:[&_div]:bg-primary"
            >
              <div className="h-full w-px bg-border-strong" />
            </Separator>
            <Panel className="relative min-h-0 min-w-0 overflow-hidden bg-surface-0" minSize={WORKSPACE_MIN_PX}>
              <section aria-hidden={view !== 'company'} className={cn('absolute inset-0 overflow-hidden', view === 'company' ? 'block' : 'hidden')}>
                <OrganizationDashboard workspace={workspace} onOpenDeepSeek={() => setView('agent')} onError={notify} companyView={companyView} onCompanyViewChange={setCompanyView} />
              </section>

              <section aria-hidden={view !== 'agent'} className={cn('absolute inset-0 overflow-hidden', view === 'agent' && !workspaceCollapsed ? 'flex' : 'hidden')}>
                <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
                  <div className="flex shrink-0 items-center gap-[3px] border-b border-border-soft bg-secondary px-2 py-1" role="tablist" aria-label="Agent workspace panes">
                    <button className={paneTabClasses(agentPane === 'files')} onClick={() => setAgentPane('files')}>
                      <FileIcon />
                      <span>Files</span>
                    </button>
                    <button className={paneTabClasses(agentPane === 'browser')} onClick={() => setAgentPane('browser')}>
                      <BrowserIcon />
                      <span>Browser</span>
                    </button>
                  </div>
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    {agentPane === 'files' ? (
                      <div className="grid h-full w-full min-h-0 grid-cols-[minmax(0,1fr)_200px]">
                        <div className="min-h-0 min-w-0 overflow-hidden">
                          {activeDiff ? (
                            <DiffView
                              relativePath={activeDiff.relativePath}
                              staged={activeDiff.staged}
                              onClose={() => setActiveDiff(null)}
                              onError={notify}
                            />
                          ) : (
                            <EditorPane file={selectedFile} onAgentPrompt={askAgent} onError={notify} />
                          )}
                        </div>
                        <div className="min-h-0 border-l border-border-soft">
                          <Explorer
                            workspace={workspace}
                            selectedPath={selectedFile?.relativePath}
                            onWorkspaceChanged={changeWorkspace}
                            onOpenFile={(path) => void openFile(path)}
                            onOpenDiff={openDiff}
                            onError={notify}
                          />
                        </div>
                      </div>
                    ) : (
                      <BrowserPane
                        active={view === 'agent'}
                        state={browserState}
                        onSnapshot={() => notify('Browser snapshot captured from the live page.')}
                        onError={notify}
                      />
                    )}
                  </div>
                </div>
              </section>

              <section aria-hidden={view !== 'design'} className={cn('absolute inset-0 overflow-hidden', view === 'design' ? 'block' : 'hidden')}>
                <DesignView
                  active={view === 'design'}
                  workspace={workspace}
                  browser={browserState}
                  harness={harnessStatus}
                  onWorkspaceChanged={changeWorkspace}
                  onAskAgent={askAgent}
                  onError={notify}
                />
              </section>

              <section aria-hidden={view !== 'qa'} className={cn('absolute inset-0 overflow-hidden', view === 'qa' ? 'block' : 'hidden')}>
                <QaView active={view === 'qa'} {...(workspace?.root ? { workspaceRoot: workspace.root } : {})} onError={notify} onAskAgent={askAgent} />
              </section>
            </Panel>
          </Group>
        ) : (
          <section aria-hidden={view !== 'settings'} className="relative h-full w-full overflow-hidden">
            <Suspense fallback={<div className="grid h-full w-full place-items-center bg-surface-0"><div className="size-[34px] animate-spin rounded-full border border-border-strong border-t-primary" /></div>}>
              <SettingsPane
                theme={theme}
                onSelectTheme={selectTheme}
                workspace={workspace}
                onWorkspaceChanged={changeWorkspace}
                harness={harnessStatus}
                browser={browserState}
                onError={notify}
                tab={settingsTab}
                onSelectTab={setSettingsTab}
                subTab={settingsSubTabs.general}
                onSelectSubTab={(subTab) => setSettingsSubTabs((current) => ({ ...current, general: subTab }))}
                capabilitySubTab={settingsSubTabs.capabilities}
                onSelectCapabilitySubTab={(subTab) => setSettingsSubTabs((current) => ({ ...current, capabilities: subTab }))}
              />
            </Suspense>
          </section>
        )}
      </main>

      <RuntimePrompts onError={notify} />
      {pendingPick ? (
        <div role="dialog" aria-label="Picked element" className="fixed right-4 bottom-[46px] z-[150] flex w-[300px] flex-col gap-2 rounded-[10px] border border-border-strong bg-surface-1 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.5)]">
          <div title={pendingPick.hover} className="flex min-w-0 cursor-help items-center gap-[7px]">
            <CrosshairIcon className="size-[13px] shrink-0 text-primary" />
            <strong className="overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap">{pendingPick.shortName}</strong>
            <span className="overflow-hidden text-[9px] text-faint text-ellipsis whitespace-nowrap">{pendingPick.targetTitle}</span>
          </div>
          {pendingPick.element.selector ? (
            <div title={pendingPick.element.selector} className="flex min-w-0 items-center gap-[6px] pl-[19px]">
              <span className="overflow-hidden font-mono text-[9px] text-faint text-ellipsis whitespace-nowrap">{pendingPick.element.selector}</span>
            </div>
          ) : null}
          {pendingPick.element.source ? (
            <div title={`Dev-build source location: ${pendingPick.element.source}`} className="flex min-w-0 items-center gap-[5px] pl-[19px]">
              <FileIcon className="size-[10px] shrink-0 text-faint" />
              <span className="overflow-hidden font-mono text-[9px] text-faint text-ellipsis whitespace-nowrap">{pendingPick.element.source}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              onClick={() => void addElementToChat()}
            >
              Add to chat
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              onClick={() => setPendingPick(null)}
            >
              Discard
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              title="Copy the full element context (selector, styles, source, HTML) the agent would receive"
              onClick={copyPickedElementContext}
            >
              Copy info
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              title="Copy the CSS selector path for this element"
              onClick={copyPickedSelector}
            >
              Copy selector
            </Button>
            {pendingPick.hasShot ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto rounded-md px-2.5 py-1 text-[11px]"
                title="Copy the cropped screenshot of this element"
                onClick={copyPickedShot}
              >
                Copy shot
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {pendingAppInspect ? (
        <div role="dialog" aria-label="Inspected app info" className="fixed right-4 bottom-[46px] z-[150] flex w-[300px] flex-col gap-2 rounded-[10px] border border-border-strong bg-surface-1 p-3 shadow-[0_14px_40px_rgba(0,0,0,0.5)]">
          <div className="flex min-w-0 items-center gap-[7px]">
            <CameraIcon className="size-[13px] shrink-0 text-primary" />
            <strong className="overflow-hidden font-mono text-[11px] text-ellipsis whitespace-nowrap">
              {pendingAppInspect.scope === 'external' ? 'External App Inspect' : 'Internal App Inspect'}
            </strong>
            <Badge variant="outline" className="ml-auto text-[9px] font-normal">
              {pendingAppInspect.scope}
            </Badge>
          </div>
          <div className="flex flex-col gap-1 pl-[20px] text-[10px] text-muted-foreground font-mono">
            <div><span className="text-faint">Target:</span> {pendingAppInspect.displayLabel}</div>
            <div><span className="text-faint">Resolution:</span> {pendingAppInspect.width} × {pendingAppInspect.height}</div>
            <div className="text-primary font-medium">✓ Sent to ND Chat Agent</div>
            {pendingAppInspect.copiedToClipboard ? <div className="text-faint">✓ Copied image to clipboard</div> : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              onClick={() => setPendingAppInspect(null)}
            >
              Dismiss
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-auto rounded-md px-2.5 py-1 text-[11px]"
              title="Copy summary information for this application inspection"
              onClick={() => {
                navigator.clipboard.writeText(`App Inspect Info:\nScope: ${pendingAppInspect.scope}\nTarget: ${pendingAppInspect.displayLabel}\nResolution: ${pendingAppInspect.width}x${pendingAppInspect.height}`)
                  .then(() => toast('App inspect info copied to clipboard.'))
                  .catch((cause) => notify(errorMessage(cause)))
              }}
            >
              Copy info
            </Button>
          </div>
        </div>
      ) : null}
      {appInspectCountdown !== null ? (
        <div role="status" className="fixed right-[18px] bottom-[38px] z-50 max-w-[min(420px,calc(100vw-36px))] rounded-lg border border-border-strong bg-secondary px-3 py-2 text-xs text-soft shadow-[0_18px_50px_rgba(0,0,0,0.46)]">
          {`Screen capture in ${appInspectCountdown}s — switch to the app you want to inspect`}
        </div>
      ) : null}
      <Toaster position="bottom-right" duration={5000} />
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
