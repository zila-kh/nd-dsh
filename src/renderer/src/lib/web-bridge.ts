import type {
  AppInfo,
  BrowserState,
  DesktopApi,
  DshEventFrame,
  DshViewState,
  EffectiveTheme,
  GatewayRpcResult,
  HarnessRunResult,
  HarnessStatus,
  ModelProvider,
  SurfaceState,
  ThemeMode,
  ThemeState,
} from '../../../shared/contracts'
import { MockWorkspaceService } from './web-mock'

const THEME_STORAGE_KEY = 'nd-dsh:theme'
const VALID_THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']

function systemEffectiveTheme(): EffectiveTheme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function readStoredThemeMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY)
    return VALID_THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : null
  } catch {
    return null
  }
}

function persistThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Storage unavailable (e.g. disabled); the choice still applies for this session.
  }
}

function webThemeState(): ThemeState {
  const mode = readStoredThemeMode() ?? 'system'
  const effective = mode === 'system' ? systemEffectiveTheme() : mode
  return { mode, effective }
}

function applyEffectiveTheme(effective: EffectiveTheme): void {
  document.documentElement.dataset.theme = effective
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', effective)
}

const PROVIDERS_STORAGE_KEY = 'nd-dsh:providers'

function defaultWebProvider(): ModelProvider {
  return {
    id: 'deepseek',
    name: 'deepseek',
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
    apiFormat: 'Chat completions (/chat/completions)',
    apiKey: '',
    models: [{ id: 'deepseek-v4-flash', context: '1M' }],
  }
}

function isProvider(value: unknown): value is ModelProvider {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.name === 'string'
}

// Provider settings in web mode persist to localStorage; the desktop app uses
// the main-process store instead. Default is the single real deepseek provider.
const webProviders = {
  list(): ModelProvider[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROVIDERS_STORAGE_KEY) ?? '[]') as unknown
      const providers = Array.isArray(parsed) ? parsed.filter(isProvider) : []
      return providers.length > 0 ? providers : [defaultWebProvider()]
    } catch {
      return [defaultWebProvider()]
    }
  },
  save(next: ModelProvider[]): ModelProvider[] {
    const providers = Array.isArray(next) ? next.filter(isProvider) : []
    const saved = providers.length > 0 ? providers : [defaultWebProvider()]
    try {
      localStorage.setItem(PROVIDERS_STORAGE_KEY, JSON.stringify(saved))
    } catch {
      // Storage unavailable; the choice still applies for this session.
    }
    return saved
  },
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

/** Restore the persisted web-mode theme before the first paint. */
export function applyStoredWebTheme(): void {
  applyEffectiveTheme(webThemeState().effective)
}

/**
 * Stand-in for Electron's preload bridge so the renderer shell can render in a
 * plain web tab or inside the built-in browser view, where the bridge does not
 * exist. The browser and harness services run against fixture data so every
 * panel is explorable for UI work. The workspace runs against fixture trees,
 * except that typed paths open a generic tree, and — where the browser exposes
 * the File System Access API — "Change folder" reads the picked directory for
 * real.
 */
export function installWebBridge(): void {
  document.documentElement.dataset.webMode = 'true'

  const workspace = new MockWorkspaceService()

  // --- theme ---
  let themeChanged: ((state: ThemeState) => void) | undefined
  const systemMediaQuery = window.matchMedia('(prefers-color-scheme: light)')
  const onSystemThemeChange = (): void => {
    const state = webThemeState()
    if (state.mode !== 'system') return
    applyEffectiveTheme(state.effective)
    themeChanged?.(state)
  }
  systemMediaQuery.addEventListener('change', onSystemThemeChange)

  // --- harness ---
  const READY_HARNESS: HarnessStatus = {
    state: 'ready',
    sourceReady: true,
    apiKeyPresent: true,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  }
  let harnessStatus: HarnessStatus = READY_HARNESS
  const statusListeners = new Set<(status: HarnessStatus) => void>()
  const eventListeners = new Set<(frame: DshEventFrame) => void>()
  const emitStatus = (status: HarnessStatus): void => {
    harnessStatus = status
    for (const listener of statusListeners) listener(status)
  }
  const emitEvent = (frame: DshEventFrame): void => {
    for (const listener of eventListeners) listener(frame)
  }

  // --- browser ---
  const INITIAL_BROWSER: BrowserState = {
    url: 'http://localhost:5173/',
    title: 'ND · DeepSeek IDE',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    visible: true,
    cdpPort: 9922,
    agentBrowser: 'ready',
  }
  let browserState: BrowserState = INITIAL_BROWSER
  const visited: string[] = [INITIAL_BROWSER.url]
  let visitedIndex = 0
  const browserListeners = new Set<(state: BrowserState) => void>()
  const emitBrowser = (): void => {
    for (const listener of browserListeners) listener(browserState)
  }
  const applyUrl = (url: string): void => {
    browserState = {
      ...browserState,
      url,
      title: hostLabel(url),
      loading: true,
      canGoBack: visitedIndex > 0,
      canGoForward: visitedIndex < visited.length - 1,
    }
    emitBrowser()
  }
  const settleLoad = async (): Promise<void> => {
    await delay(550)
    browserState = { ...browserState, loading: false }
    emitBrowser()
  }

  // --- surface + DSH view (web preview shows the workbench, no native view) ---
  let surfaceValue: SurfaceState['surface'] = 'workbench'
  let surfaceChanged: ((state: SurfaceState) => void) | undefined
  const dshView: DshViewState = { ready: false, loading: false, title: 'DeepSeek', visible: false }
  const dshViewListeners = new Set<(state: DshViewState) => void>()

  const bridge: DesktopApi = {
    app: {
      info: async (): Promise<AppInfo> => ({
        name: 'ND-DSH',
        version: '0.0.0-web',
        platform: 'web',
        projectRoot: '',
      }),
    },
    browser: {
      state: async (): Promise<BrowserState> => ({ ...browserState }),
      setBounds: async (): Promise<void> => undefined,
      setVisible: async (): Promise<void> => undefined,
      navigate: async (input: string): Promise<BrowserState> => {
        const url = input.includes('://') ? input : `https://${input}`
        visited.splice(visitedIndex + 1)
        visited.push(url)
        visitedIndex += 1
        applyUrl(url)
        void settleLoad()
        return browserState
      },
      back: async (): Promise<BrowserState> => {
        if (visitedIndex <= 0) return browserState
        visitedIndex -= 1
        applyUrl(visited[visitedIndex] ?? 'about:blank')
        void settleLoad()
        return browserState
      },
      forward: async (): Promise<BrowserState> => {
        if (visitedIndex >= visited.length - 1) return browserState
        visitedIndex += 1
        applyUrl(visited[visitedIndex] ?? 'about:blank')
        void settleLoad()
        return browserState
      },
      reload: async (): Promise<BrowserState> => {
        browserState = { ...browserState, loading: true }
        emitBrowser()
        void settleLoad()
        return browserState
      },
      snapshot: async (): Promise<string> => {
        await delay(300)
        return `Web preview snapshot of ${browserState.url}\n\nIn the desktop app this captures the visible browser page via the agent-browser bridge.`
      },
      openExternal: async (url: string): Promise<void> => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
      onState: (listener) => {
        browserListeners.add(listener)
        return () => browserListeners.delete(listener)
      },
    },
    workspace: {
      state: async () => workspace.state(),
      pick: async () => workspace.pick(),
      setRoot: async (path) => workspace.setRoot(path),
      list: async (relativePath) => workspace.list(relativePath),
      read: async (relativePath) => workspace.read(relativePath),
    },
    providers: {
      list: async () => webProviders.list(),
      save: async (next) => webProviders.save(next),
    },
    harness: {
      status: async (): Promise<HarnessStatus> => ({ ...harnessStatus }),
      run: async (prompt: string, options?: { sessionId?: string }): Promise<HarnessRunResult> => {
        const sessionId = options?.sessionId ?? 'web-preview'
        emitStatus({ ...READY_HARNESS, state: 'running' })
        await delay(900)
        emitEvent({
          kind: 'session-event',
          sessionId,
          event: {
            type: 'assistant/message',
            seq: 1,
            time: Date.now(),
            data: { message: { role: 'assistant', content: [{ type: 'text', text: `Simulated agent reply (web preview).\n\nYou asked: "${prompt}"\n\nThe desktop app runs this through the DeepSeek Harness and drives the visible browser.` }] } },
          },
        })
        emitStatus(READY_HARNESS)
        return { sessionId }
      },
      stop: async (): Promise<HarnessStatus> => {
        emitStatus(READY_HARNESS)
        return { ...harnessStatus }
      },
      getPermissionMode: async (): Promise<string> => 'workspace-write',
      setPermissionMode: async (mode: string): Promise<string> => mode,
      onStatus: (listener) => {
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
    },
    dsh: {
      rpc: async (): Promise<GatewayRpcResult> => ({ ok: true, value: { items: [] } }),
      respond: async (): Promise<void> => undefined,
      onEvent: (listener) => {
        eventListeners.add(listener)
        return () => eventListeners.delete(listener)
      },
    },
    surface: {
      state: async (): Promise<SurfaceState> => ({ surface: surfaceValue, view: { ...dshView } }),
      set: async (surface: SurfaceState['surface']): Promise<SurfaceState> => {
        surfaceValue = surface
        surfaceChanged?.({ surface, view: { ...dshView } })
        return { surface, view: { ...dshView } }
      },
      onChanged: (listener) => {
        surfaceChanged = listener
        return () => {
          if (surfaceChanged === listener) surfaceChanged = undefined
        }
      },
    },
    dshView: {
      setBounds: async (): Promise<void> => undefined,
      setVisible: async (): Promise<void> => undefined,
      reload: async (): Promise<void> => undefined,
      onState: (listener) => {
        dshViewListeners.add(listener)
        return () => dshViewListeners.delete(listener)
      },
    },
    theme: {
      state: async (): Promise<ThemeState> => webThemeState(),
      set: async (mode: ThemeMode): Promise<ThemeState> => {
        persistThemeMode(mode)
        const next = webThemeState()
        applyEffectiveTheme(next.effective)
        themeChanged?.(next)
        return next
      },
      onChanged: (listener) => {
        themeChanged = listener
        return () => {
          if (themeChanged === listener) themeChanged = undefined
        }
      },
    },
  }

  window.ndDsh = bridge
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}
