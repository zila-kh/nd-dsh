import { BrowserWindow, WebContentsView, session, type Rectangle } from 'electron'
import type { BrowserBounds, BrowserState, UiAnnotation, UiTarget } from '../../shared/contracts.js'
import { AgentBrowserClient } from './agent-browser-client.js'
import { DEFAULT_BROWSER_URL, isAllowedBrowserUrl, normalizeBrowserUrl } from './browser-url.js'
import { UiAnnotator, type UiAnnotationImage } from './ui-annotator.js'
import { UiInspector } from './ui-inspector.js'

const BROWSER_PARTITION = 'persist:nd-dsh-browser'

export class BrowserController {
  private readonly view: WebContentsView
  private readonly agentBrowser: AgentBrowserClient
  private readonly inspector: UiInspector
  private readonly annotator: UiAnnotator
  private annotationImage: UiAnnotationImage | undefined
  private stateValue: BrowserState
  private onStateChanged?: (state: BrowserState) => void
  private binding: Promise<void> | undefined
  private lastBoundTarget: string | undefined

  constructor(
    private readonly window: BrowserWindow,
    cdpPort: number,
    projectRoot: string,
  ) {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)

    this.view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
    this.window.contentView.addChildView(this.view)
    this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    this.view.setVisible(false)

    this.agentBrowser = new AgentBrowserClient(cdpPort, projectRoot)
    this.inspector = new UiInspector(this.view.webContents, {
      selected: (target) => {
        this.stateValue.inspectMode = false
        delete this.stateValue.agentBrowserError
        this.stateValue.selectedTarget = target
        this.emitState()
      },
      canceled: () => {
        this.stateValue.inspectMode = false
        this.emitState()
      },
      error: (error) => {
        this.stateValue.inspectMode = false
        this.stateValue.agentBrowserError = `UI inspection failed: ${error.message}`
        this.emitState()
      },
    })
    this.annotator = new UiAnnotator(this.view.webContents, {
      canceled: () => {
        this.annotationImage = undefined
        this.stateValue.annotationMode = false
        delete this.stateValue.annotation
        this.emitState()
      },
    })
    this.stateValue = {
      url: 'about:blank',
      title: 'Browser',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      visible: false,
      cdpPort,
      agentBrowser: 'binding',
      inspectMode: false,
      annotationMode: false,
    }
    this.installListeners()
  }

  async initialize(initialUrl = DEFAULT_BROWSER_URL): Promise<void> {
    try {
      await this.navigate(initialUrl)
    } catch {
      // A local development server may not be running yet. The native pane
      // records the load failure and remains available for later navigation.
    }
    await this.ensureAgentBinding()
  }

  setStateListener(listener: (state: BrowserState) => void): void {
    this.onStateChanged = listener
    listener(this.state())
  }

  state(): BrowserState {
    const agentStatus = this.agentBrowser.status()
    return {
      ...this.stateValue,
      agentBrowser: agentStatus.state,
      ...(agentStatus.error ? { agentBrowserError: agentStatus.error } : {}),
    }
  }

  selectedUiTarget(): UiTarget | undefined {
    return this.stateValue.selectedTarget
  }

  selectedUiAnnotation(): UiAnnotation | undefined {
    return this.stateValue.annotation
  }

  selectedUiAnnotationImage(expectedAnnotationId?: string): UiAnnotationImage | undefined {
    if (expectedAnnotationId && this.stateValue.annotation?.id !== expectedAnnotationId) return undefined
    return this.annotationImage
  }

  agentBrowserEnvironment(): NodeJS.ProcessEnv {
    return this.agentBrowser.environment()
  }

  async setBounds(bounds: BrowserBounds): Promise<void> {
    const safe: Rectangle = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    }
    this.view.setBounds(safe)
  }

  async setVisible(visible: boolean): Promise<void> {
    this.view.setVisible(visible)
    this.stateValue.visible = visible
    this.emitState()
  }

  setBackgroundColor(color: string): void {
    this.view.setBackgroundColor(color)
  }

  async navigate(input: string): Promise<BrowserState> {
    const url = normalizeBrowserUrl(input)
    await this.view.webContents.loadURL(url)
    return this.state()
  }

  async back(): Promise<BrowserState> {
    const history = this.view.webContents.navigationHistory
    if (history.canGoBack()) history.goBack()
    return this.state()
  }

  async forward(): Promise<BrowserState> {
    const history = this.view.webContents.navigationHistory
    if (history.canGoForward()) history.goForward()
    return this.state()
  }

  async reload(): Promise<BrowserState> {
    this.view.webContents.reload()
    return this.state()
  }

  async snapshot(): Promise<unknown> {
    await this.ensureAgentReady()
    return this.agentBrowser.snapshot()
  }

  async setInspectMode(enabled: boolean): Promise<BrowserState> {
    if (enabled) {
      if (this.stateValue.annotationMode) {
        await this.annotator.cancel()
        this.stateValue.annotationMode = false
      }
      delete this.stateValue.selectedTarget
      delete this.stateValue.agentBrowserError
      await this.inspector.start()
      this.stateValue.inspectMode = true
    } else {
      await this.inspector.stop()
      this.stateValue.inspectMode = false
    }
    this.emitState()
    return this.state()
  }

  clearSelection(expectedTargetId?: string): BrowserState {
    if (expectedTargetId && this.stateValue.selectedTarget?.id !== expectedTargetId) return this.state()
    delete this.stateValue.selectedTarget
    this.emitState()
    return this.state()
  }

  async setAnnotationMode(enabled: boolean): Promise<BrowserState> {
    if (enabled) {
      if (this.stateValue.inspectMode) {
        await this.inspector.stop()
        this.stateValue.inspectMode = false
      }
      this.annotationImage = undefined
      delete this.stateValue.annotation
      delete this.stateValue.agentBrowserError
      await this.annotator.start()
      this.stateValue.annotationMode = true
      this.emitState()
      return this.state()
    }

    if (!this.stateValue.annotationMode) return this.state()
    try {
      const capture = await this.annotator.finish()
      this.stateValue.annotationMode = false
      if (capture) {
        this.stateValue.annotation = capture.annotation
        this.annotationImage = capture.image
      } else {
        delete this.stateValue.annotation
        this.annotationImage = undefined
      }
      this.emitState()
      return this.state()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.stateValue.annotationMode = false
      this.annotationImage = undefined
      delete this.stateValue.annotation
      this.stateValue.agentBrowserError = `UI annotation failed: ${error.message}`
      this.emitState()
      throw error
    }
  }

  async clearAnnotation(expectedAnnotationId?: string): Promise<BrowserState> {
    if (expectedAnnotationId && this.stateValue.annotation?.id !== expectedAnnotationId) return this.state()
    if (this.stateValue.annotationMode) await this.annotator.cancel()
    this.stateValue.annotationMode = false
    this.annotationImage = undefined
    delete this.stateValue.annotation
    this.emitState()
    return this.state()
  }

  async ensureAgentReady(): Promise<void> {
    await this.ensureAgentBinding()
    const status = this.agentBrowser.status()
    if (status.state !== 'ready') {
      throw new Error(status.error ?? 'agent-browser could not bind to the visible browser target')
    }
  }

  destroy(): void {
    void this.inspector.stop()
    void this.annotator.cancel()
    if (!this.window.isDestroyed()) {
      try {
        this.window.contentView.removeChildView(this.view)
      } catch {
        // The BrowserWindow may already be tearing down its content view.
      }
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }

  private installListeners(): void {
    const contents = this.view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      void this.navigate(url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('console-message', (details) => {
      this.inspector.handleConsoleMessage(details.message)
      this.annotator.handleConsoleMessage(details.message)
    })
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault()
    })
    contents.on('did-start-loading', () => {
      this.inspector.reset()
      this.annotator.reset()
      this.stateValue.inspectMode = false
      this.stateValue.annotationMode = false
      this.annotationImage = undefined
      delete this.stateValue.selectedTarget
      delete this.stateValue.annotation
      this.stateValue.loading = true
      this.emitState()
    })
    contents.on('did-stop-loading', () => {
      this.stateValue.loading = false
      this.refreshNavigationState()
      this.emitState()
      void this.ensureAgentBinding()
    })
    contents.on('did-navigate', (_event, url) => {
      this.stateValue.url = url
      this.refreshNavigationState()
      this.emitState()
    })
    contents.on('did-navigate-in-page', (_event, url) => {
      if (this.stateValue.annotationMode) void this.annotator.cancel()
      this.stateValue.annotationMode = false
      this.annotationImage = undefined
      delete this.stateValue.selectedTarget
      delete this.stateValue.annotation
      this.stateValue.url = url
      this.refreshNavigationState()
      this.emitState()
    })
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault()
      this.stateValue.title = title || 'Browser'
      this.emitState()
    })
    contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      this.stateValue.loading = false
      this.stateValue.title = `Load failed: ${errorDescription}`
      this.stateValue.url = validatedURL
      this.emitState()
    })
    contents.on('render-process-gone', (_event, details) => {
      this.inspector.reset()
      this.annotator.reset()
      this.stateValue.inspectMode = false
      this.stateValue.annotationMode = false
      this.annotationImage = undefined
      delete this.stateValue.selectedTarget
      delete this.stateValue.annotation
      this.stateValue.loading = false
      this.stateValue.title = `Browser renderer exited: ${details.reason}`
      delete this.stateValue.targetId
      this.lastBoundTarget = undefined
      this.agentBrowser.resetBinding()
      this.emitState()
    })
  }

  private refreshNavigationState(): void {
    const history = this.view.webContents.navigationHistory
    this.stateValue.url = this.view.webContents.getURL() || this.stateValue.url
    this.stateValue.canGoBack = history.canGoBack()
    this.stateValue.canGoForward = history.canGoForward()
  }

  private async ensureAgentBinding(): Promise<void> {
    if (this.binding) return this.binding
    this.binding = (async () => {
      try {
        const targetId = this.stateValue.targetId ?? await this.getTargetId()
        this.stateValue.targetId = targetId
        this.emitState()
        if (this.lastBoundTarget !== targetId || this.agentBrowser.status().state !== 'ready') {
          await this.agentBrowser.bindTarget(targetId)
          this.lastBoundTarget = targetId
        }
      } catch (error) {
        this.agentBrowser.recordFailure(error)
      } finally {
        this.emitState()
      }
    })().finally(() => {
      this.binding = undefined
    })
    return this.binding
  }

  private async getTargetId(): Promise<string> {
    const debuggerApi = this.view.webContents.debugger
    const attachedHere = !debuggerApi.isAttached()
    if (attachedHere) debuggerApi.attach('1.3')
    try {
      const response = (await debuggerApi.sendCommand('Target.getTargetInfo')) as {
        targetInfo?: { targetId?: string }
      }
      const targetId = response.targetInfo?.targetId
      if (!targetId) throw new Error('Electron did not return a CDP target id for the browser pane')
      return targetId
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }

  private emitState(): void {
    this.onStateChanged?.(this.state())
  }
}
