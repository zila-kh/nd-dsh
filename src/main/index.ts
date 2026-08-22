import 'dotenv/config'
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IPC } from '../shared/contracts.js'
import { ORGANIZATION_IPC } from '../shared/organization.js'
import { projectRoot } from './app-paths.js'
import { BrowserController } from './browser/browser-controller.js'
import { DEFAULT_BROWSER_URL } from './browser/browser-url.js'
import { DshSurfaceController } from './dsh/dsh-surface.js'
import { pickFreePort } from './dsh/gateway-client.js'
import { EngineAssignmentStore } from './engines/engine-assignment-store.js'
import { CodingEngineRegistry } from './engines/coding-engine-registry.js'
import { HarnessService } from './harness/harness-service.js'
import { registerIpc } from './ipc.js'
import { OrganizationApprovalGate } from './organization/approval-gate.js'
import { registerOrganizationIpc } from './organization/ipc.js'
import { OrganizationOrchestrator } from './organization/orchestrator.js'
import { OrganizationStore } from './organization/store.js'
import { ProviderStore } from './providers.js'
import { ThemeService } from './theme.js'
import { WorkspaceService } from './workspace/workspace-service.js'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const requestedCdpPort = parsePort(process.env.ND_DSH_CDP_PORT, 0)
const startUrl = process.env.ND_DSH_BROWSER_URL?.trim() || DEFAULT_BROWSER_URL

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.enableSandbox()

let mainWindow: BrowserWindow | undefined
let activeHarness: HarnessService | undefined
let shutdownStarted = false
const closingHarnesses = new Set<Promise<void>>()

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
  const workspace = new WorkspaceService(process.env.ND_DSH_WORKSPACE?.trim() || process.cwd())
  const providers = new ProviderStore()
  const userData = app.getPath('userData')
  const engines = new CodingEngineRegistry(new EngineAssignmentStore(join(userData, 'engine-assignments.json')))
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

  const browser = new BrowserController(window, cdpPort, projectRoot())
  const dshSurface = new DshSurfaceController(window)
  const harness = new HarnessService(workspace, browser, providers)
  const organizationStore = new OrganizationStore(join(userData, 'organization.json'))
  const interruptedRuns = await organizationStore.reconcileInterruptedRuns()
  if (interruptedRuns > 0) console.warn(`Recovered ${interruptedRuns} interrupted organization run(s) from the previous app session.`)
  const organization = new OrganizationOrchestrator(organizationStore, harness, workspace, engines)
  const approvalGate = new OrganizationApprovalGate(organizationStore, harness)
  const disposeIpc = registerIpc({ window, browser, dshSurface, engines, harness, workspace, theme, providers })
  const disposeOrganizationIpc = registerOrganizationIpc(window, organizationStore, organization)
  mainWindow = window
  activeHarness = harness

  organizationStore.setOnChanged((state) => {
    if (!window.isDestroyed()) window.webContents.send(ORGANIZATION_IPC.changed, state)
  })
  theme.attach(window, (color) => {
    browser.setBackgroundColor(color)
    dshSurface.setBackgroundColor(color)
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
  dshSurface.setStateListener((state) => {
    if (!window.isDestroyed()) window.webContents.send(IPC.dshViewStateEvent, state)
  })
  harness.setListeners({
    status: (status) => {
      if (!window.isDestroyed()) window.webContents.send(IPC.harnessStatusEvent, status)
    },
    event: (frame) => {
      void organization.handleHarnessEvent(frame).catch((error) => {
        console.error('Organization event handling failed:', error)
      })

      if (frame.kind === 'approval-requested') {
        void approvalGate.shouldForward(frame)
          .then((forward) => {
            if (forward && !window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
          })
          .catch((error) => {
            // Fail safe to the human approval UI; a policy-gate failure must
            // never become an implicit allow.
            console.error('Organization approval policy gate failed:', error)
            if (!window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
          })
        return
      }

      if (!window.isDestroyed()) window.webContents.send(IPC.dshEvent, frame)
    },
    gatewayReady: (url) => {
      console.log(`ND-DSH gateway ready at ${url}`)
      dshSurface.setTarget(url)
    },
  })

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

  window.once('ready-to-show', () => window.show())
  if (rendererUrl) await window.loadURL(rendererUrl)
  else await window.loadFile(rendererFile)

  await browser.initialize(startUrl).catch((error) => {
    console.warn('Initial browser navigation failed:', error)
  })
  if (theme.surface() === 'dsh') harness.warmup()
  if (!window.isVisible()) window.show()

  window.on('closed', () => {
    organizationStore.setOnChanged(undefined)
    disposeOrganizationIpc()
    disposeIpc()
    browser.destroy()
    dshSurface.destroy()
    if (mainWindow === window) mainWindow = undefined
    if (activeHarness === harness) activeHarness = undefined
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
  if (activeHarness) {
    const harness = activeHarness
    activeHarness = undefined
    beginHarnessClose(harness)
  }
  if (closingHarnesses.size === 0) return
  event.preventDefault()
  shutdownStarted = true
  void Promise.allSettled([...closingHarnesses]).finally(() => app.exit(0))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function beginHarnessClose(harness: HarnessService): void {
  let task: Promise<void>
  task = harness.close()
    .catch((error) => console.error('Failed to close ND runtime cleanly:', error))
    .finally(() => closingHarnesses.delete(task))
  closingHarnesses.add(task)
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
