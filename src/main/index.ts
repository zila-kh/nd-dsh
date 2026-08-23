import 'dotenv/config'
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IPC, type DshEventFrame } from '../shared/contracts.js'
import { DESIGN_IPC } from '../shared/design.js'
import { ORGANIZATION_IPC } from '../shared/organization.js'
import { projectRoot } from './app-paths.js'
import { BrowserController } from './browser/browser-controller.js'
import { DEFAULT_BROWSER_URL } from './browser/browser-url.js'
import { ExternalElementStage, RecentPickStore } from './capture/external-inspect.js'
import { DesignService } from './design/design-service.js'
import { registerDesignIpc } from './design/ipc.js'
import { NdPencilController } from './design/nd-pencil-controller.js'
import { DshSurfaceController } from './dsh/dsh-surface.js'
import { pickFreePort } from './dsh/gateway-client.js'
import { CodexCliEngine } from './engines/codex/codex-cli-engine.js'
import { EngineAssignmentStore } from './engines/engine-assignment-store.js'
import { CodingEngineRegistry } from './engines/coding-engine-registry.js'
import { EngineSessionRouter } from './engines/engine-session-router.js'
import { GitService } from './git/git-service.js'
import { HarnessService } from './harness/harness-service.js'
import { registerIpc } from './ipc.js'
import { OrganizationApprovalGate } from './organization/approval-gate.js'
import { registerOrganizationIpc } from './organization/ipc.js'
import { OrganizationOrchestrator } from './organization/orchestrator.js'
import { OrganizationStore } from './organization/store.js'
import { ProviderStore } from './providers.js'
import { QaService } from './qa/qa-service.js'
import { SessionArchiveStore } from './sessions/session-archive-store.js'
import { ThemeService } from './theme.js'
import { ProjectWorkspaceCoordinator } from './workspace/project-workspace-coordinator.js'
import { WorkspaceRegistry } from './workspace/workspace-registry.js'
import { WorkspaceService } from './workspace/workspace-service.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const requestedCdpPort = parsePort(process.env.ND_DSH_CDP_PORT, 0)
const startUrl = process.env.ND_DSH_BROWSER_URL?.trim() || DEFAULT_BROWSER_URL

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.enableSandbox()

let mainWindow: BrowserWindow | undefined
let activeHarness: HarnessService | undefined
let activeCodexEngine: CodexCliEngine | undefined
let activeNdPencil: NdPencilController | undefined
let shutdownStarted = false
const closingServices = new Set<Promise<void>>()

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

const theme = new ThemeService()

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

async function createWindow(cdpPort: number): Promise<void> {
  const preload = join(currentDirectory, '../preload/index.cjs')
  const ndPencilPreload = join(currentDirectory, '../preload/nd-pencil.cjs')
  const workspace = new WorkspaceService(process.env.ND_DSH_WORKSPACE?.trim() || process.cwd())
  const providers = new ProviderStore()
  const userData = app.getPath('userData')
  const engines = new CodingEngineRegistry(new EngineAssignmentStore(join(userData, 'engine-assignments.json')))
  const sessionArchive = new SessionArchiveStore(join(userData, 'session-archive.json'))
  const isMac = process.platform === 'darwin'

  const window = new BrowserWindow({
    width: 1640,
    height: 980,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: theme.windowBackgroundColor(),
    autoHideMenuBar: true,
    title: 'ND · AI Company OS',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 13 } } : { titleBarOverlay: theme.titleBarOverlay() }),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  const workspaces = new WorkspaceRegistry(join(userData, 'workspaces.json'))
  await workspaces.ensureActive(workspace.state().root)

  const browser = new BrowserController(window, cdpPort, projectRoot())
  const dshSurface = new DshSurfaceController(window)
  const externalElements = new ExternalElementStage()
  const recentPicks = new RecentPickStore()
  const harness = new HarnessService(workspace, browser, providers, externalElements, sessionArchive)
  const codexEngine = new CodexCliEngine({ log: (line) => console.log(line) })
  activeCodexEngine = codexEngine
  const engineRouter = new EngineSessionRouter(harness, codexEngine, workspace)
  const organizationStore = new OrganizationStore(join(userData, 'organization.json'))
  const interruptedRuns = await organizationStore.reconcileInterruptedRuns()
  if (interruptedRuns > 0) console.warn(`Recovered ${interruptedRuns} interrupted organization run(s) from the previous app session.`)
  const projectWorkspace = new ProjectWorkspaceCoordinator(organizationStore, workspace, harness)
  await projectWorkspace.initialize()
  const design = new DesignService(workspace, browser)
  const ndPencil = new NdPencilController(window, workspace, projectRoot(), ndPencilPreload)
  await ndPencil.initialize()
  const organization = new OrganizationOrchestrator(organizationStore, harness, workspace, engines, engineRouter)
  const approvalGate = new OrganizationApprovalGate(organizationStore, harness)
  const git = new GitService(workspace)
  const qa = new QaService()
  qa.setProjectRoot(workspace.state().root)
  const disposeIpc = registerIpc({ window, preloadPath: preload, browser, dshSurface, engines, engineRouter, harness, projectWorkspace, workspaces, theme, providers, externalElements, recentPicks, git, qa, sessionArchive })
  const disposeDesignIpc = registerDesignIpc(window, design, ndPencil)
  const disposeOrganizationIpc = registerOrganizationIpc(window, organizationStore, organization, projectWorkspace)
  mainWindow = window
  activeHarness = harness
  activeNdPencil = ndPencil

  organizationStore.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ORGANIZATION_IPC.changed, state)
  })
  let lastWorkspaceRoot = workspace.state().root
  workspace.setStateListener((state) => {
    const rootChanged = lastWorkspaceRoot !== state.root
    lastWorkspaceRoot = state.root
    if (rootChanged) void ndPencil.setVisible(false)
    if (rootChanged) {
      void git.handleWorkspaceChanged().catch((error) => {
        console.warn('Git workspace synchronization failed:', error instanceof Error ? error.message : String(error))
      })
    }
    if (!window.isDestroyed()) window.webContents.send(IPC.workspaceStateEvent, state)
    void design.handleWorkspaceChanged(state).catch((error) => {
      console.warn('Design workspace synchronization failed:', error instanceof Error ? error.message : String(error))
    })
    void ndPencil.handleWorkspaceChanged(state.root).catch((error) => {
      console.warn('ND Pencil workspace synchronization failed:', error instanceof Error ? error.message : String(error))
    })
  })
  git.setStateListener((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.gitStateEvent, state)
  })
  void git.refresh().catch((error) => {
    console.warn('Initial Git status failed:', error instanceof Error ? error.message : String(error))
  })
  qa.setListener((event) => {
    if (window.isDestroyed()) return
    if (event.kind === 'state') window.webContents.send(IPC.qaStateEvent, event.state)
    else window.webContents.send(IPC.qaOutputEvent, event.chunk)
  })
  theme.attach(window, (color) => {
    browser.setBackgroundColor(color)
    dshSurface.setBackgroundColor(color)
    ndPencil.setBackgroundColor(color)
  })
  theme.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.themeChangedEvent, state)
  })
  theme.setOnSurfaceChanged((surface) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.surfaceChangedEvent, { surface, view: dshSurface.state() })
  })

  browser.setStateListener((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.browserStateEvent, state)
  })
  ndPencil.setStateListener((state) => {
    if (!window.isDestroyed()) window.webContents.send(DESIGN_IPC.freeformChanged, state)
  })
  dshSurface.setStateListener((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.dshViewStateEvent, state)
  })
  // Every engine's translated frames share one fan-out: the organization
  // orchestrator consumes run semantics, and the renderer sees the same
  // DshEventFrame vocabulary regardless of which engine produced it.
  const dispatchEngineFrame = (frame: DshEventFrame): void => {
    void organization.handleHarnessEvent(frame).catch((error) => {
      console.error('Organization event handling failed:', error)
    })

    if (frame.kind === 'approval-requested') {
      void approvalGate.shouldForward(frame)
        .then((forward) => {
          if (forward && !window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
        })
        .catch((error) => {
          console.error('Organization approval policy gate failed:', error)
          if (!window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
        })
      return
    }

    if (!window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
  }
  harness.setListeners({
    status: (status) => {
      if (!window.isDestroyed()) window.webContents.send(IPC.harnessStatusEvent, status)
    },
    event: dispatchEngineFrame,
    gatewayReady: (url) => {
      console.log(`ND-DSH gateway ready at ${url}`)
      dshSurface.setTarget(url)
    },
  })
  codexEngine.setEmitter(dispatchEngineFrame)

  const rendererUrl = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL
  const rendererFile = join(currentDirectory, '../renderer/index.html')
  const allowedRenderer = createRendererUrlGuard(rendererUrl, rendererFile)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!allowedRenderer(url)) event.preventDefault()
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!allowedRenderer(url)) event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 's' && input.type === 'keyDown') {
      if (ndPencil.state().visible && ndPencil.state().dirty) {
        event.preventDefault()
        void ndPencil.save().catch((error) => console.error('Shortcut save failed:', error))
      }
    }
  })

  window.once('ready-to-show', () => window.show())
  if (rendererUrl) await window.loadURL(rendererUrl)
  else await window.loadFile(rendererFile)

  await browser.initialize(startUrl).catch((error) => {
    console.warn('Initial browser navigation failed:', error)
  })
  if (theme.surface() === 'dsh') harness.warmup()
  if (!window.isVisible()) window.show()

  let closeAfterFreeformSave = false
  let savingFreeformForClose = false
  window.on('close', (event) => {
    if (shutdownStarted || closeAfterFreeformSave || !ndPencil.state().dirty) return
    event.preventDefault()
    if (savingFreeformForClose) return
    savingFreeformForClose = true
    void ndPencil.close()
      .then(() => {
        closeAfterFreeformSave = true
        if (!window.isDestroyed()) window.close()
      })
      .catch((error) => {
        savingFreeformForClose = false
        console.error('Refusing to close ND with an unsaved Freeform document:', error)
      })
  })

  window.on('closed', () => {
    organizationStore.setOnChanged(undefined)
    workspace.setStateListener(undefined)
    ndPencil.setStateListener(undefined)
    disposeOrganizationIpc()
    disposeDesignIpc()
    disposeIpc()
    void qa.dispose()
    design.destroy()
    if (activeNdPencil === ndPencil) activeNdPencil = undefined
    void ndPencil.destroy()
    browser.destroy()
    dshSurface.destroy()
    if (mainWindow === window) mainWindow = undefined
    if (activeHarness === harness) activeHarness = undefined
    if (activeCodexEngine === codexEngine) activeCodexEngine = undefined
    beginCodexClose(codexEngine)
    beginHarnessClose(harness)
  })
}

if (hasSingleInstanceLock) {
  void (async () => {
    const cdpPort = await resolveCdpPort(requestedCdpPort)
    console.log(`ND-DSH CDP port: ${cdpPort}`)
    app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort))
    app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
    await app.whenReady()
    await createWindow(cdpPort)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(cdpPort).catch(reportFatalStartupError)
    })
  })().catch(reportFatalStartupError)
}

app.on('before-quit', (event) => {
  if (shutdownStarted) return
  const ndPencilForRetry = activeNdPencil
  if (activeHarness) {
    const harness = activeHarness
    activeHarness = undefined
    beginHarnessClose(harness)
  }
  if (activeCodexEngine) {
    const codexEngine = activeCodexEngine
    activeCodexEngine = undefined
    beginCodexClose(codexEngine)
  }
  if (activeNdPencil) {
    const ndPencil = activeNdPencil
    activeNdPencil = undefined
    beginNdPencilClose(ndPencil)
  }
  if (closingServices.size === 0) return
  event.preventDefault()
  shutdownStarted = true
  const pending = [...closingServices]
  void Promise.allSettled(pending).then((results) => {
    if (results.some((result) => result.status === 'rejected')) {
      shutdownStarted = false
      if (ndPencilForRetry) activeNdPencil = ndPencilForRetry
      console.error('ND quit was canceled because the Freeform document could not be saved safely.')
      return
    }
    app.exit(0)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function beginHarnessClose(harness: HarnessService): void {
  trackClose(harness.close().catch((error) => console.error('Failed to close ND runtime cleanly:', error)))
}

function beginCodexClose(codexEngine: CodexCliEngine): void {
  trackClose(codexEngine.close().catch((error) => console.error('Failed to close the Codex engine cleanly:', error)))
}

function beginNdPencilClose(ndPencil: NdPencilController): void {
  trackClose(ndPencil.close()
    .catch((error) => {
      console.error('Failed to save/close ND Pencil cleanly:', error)
      throw error
    })
    .then(() => ndPencil.destroy()))
}

function trackClose(promise: Promise<void>): void {
  let task: Promise<void>
  task = promise.finally(() => closingServices.delete(task))
  closingServices.add(task)
}

function reportFatalStartupError(error: unknown): void {
  console.error('ND-DSH failed to start:', error)
  app.quit()
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1_024 && parsed < 65_536 ? parsed : fallback
}

/**
 * Honor ND_DSH_CDP_PORT only when it is actually bindable. A stale ND-DSH
 * process (or a dev instance) holding the pinned port previously killed
 * Chromium's devtools server, which made the agent-browser binding time out
 * and blocked runtime startup entirely. Fall back to a free port instead.
 */
async function resolveCdpPort(requested: number): Promise<number> {
  if (requested <= 0) return pickFreePort()
  if (await canBindLoopback(requested)) return requested
  console.warn(`ND_DSH_CDP_PORT=${requested} is already in use (another ND-DSH process?); using a free port instead.`)
  return pickFreePort()
}

function canBindLoopback(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

function createRendererUrlGuard(devUrl: string | undefined, rendererFile: string): (url: string) => boolean {
  if (devUrl) {
    const allowedOrigin = new URL(devUrl).origin
    return (url) => {
      try { return new URL(url).origin === allowedOrigin } catch { return false }
    }
  }
  const allowedFile = pathToFileURL(rendererFile).href
  return (url) => url === allowedFile || url.startsWith(`${allowedFile}#`)
}
