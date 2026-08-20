import type {
  AppInfo,
  BrowserState,
  DesktopApi,
  HarnessStatus,
  ThemeMode,
  ThemeState,
  WorkspaceEntry,
  WorkspaceState,
} from '../../../shared/contracts'

const DESKTOP_ONLY = 'This feature is only available in the ND-DSH desktop app.'

function systemTheme(): ThemeState {
  const light = window.matchMedia('(prefers-color-scheme: light)').matches
  return { mode: 'system', effective: light ? 'light' : 'dark' }
}

/**
 * Stand-in for Electron's preload bridge so the renderer shell can render in a
 * plain web tab or inside the built-in browser view, where the bridge does not
 * exist. State reads return benign defaults; desktop-only actions fail with a
 * message that the UI surfaces as a toast.
 */
export function installWebBridge(): void {
  const noop = async (): Promise<void> => undefined
  const unavailable = async (): Promise<never> => {
    throw new Error(DESKTOP_ONLY)
  }
  const stopped: HarnessStatus = {
    state: 'stopped',
    sourceReady: false,
    apiKeyPresent: false,
    provider: 'web-preview',
    model: 'web-preview',
  }

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
      state: async (): Promise<BrowserState> => ({
        url: 'about:blank',
        title: 'Browser',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        visible: false,
        cdpPort: 0,
        agentBrowser: 'unavailable',
        agentBrowserError: DESKTOP_ONLY,
      }),
      setBounds: noop,
      setVisible: noop,
      navigate: unavailable,
      back: unavailable,
      forward: unavailable,
      reload: unavailable,
      snapshot: unavailable,
      openExternal: async (url: string): Promise<void> => {
        window.open(url, '_blank', 'noopener,noreferrer')
      },
      onState: () => () => undefined,
    },
    workspace: {
      state: async (): Promise<WorkspaceState> => ({ root: '', name: 'Web Preview' }),
      pick: unavailable,
      list: async (): Promise<WorkspaceEntry[]> => [],
      read: unavailable,
    },
    harness: {
      status: async (): Promise<HarnessStatus> => stopped,
      run: unavailable,
      stop: async (): Promise<HarnessStatus> => stopped,
      onStatus: () => () => undefined,
      onNotification: () => () => undefined,
    },
    theme: {
      state: async (): Promise<ThemeState> => systemTheme(),
      set: async (mode: ThemeMode): Promise<ThemeState> => {
        const next = mode === 'system' ? systemTheme() : { mode, effective: mode }
        document.documentElement.dataset.theme = next.effective
        document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', next.effective)
        return next
      },
      onChanged: () => () => undefined,
    },
  }

  window.ndDsh = bridge
}
