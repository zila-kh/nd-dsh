import type {
  AppInfo,
  BrowserState,
  DesktopApi,
  DshEventFrame,
  DshViewState,
  GatewayRpcResult,
  HarnessRunResult,
  HarnessStatus,
  ModelProvider,
  SessionEventEnvelope,
  SurfaceState,
  ThemeMode,
  ThemeState,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceState,
} from '../../../shared/contracts'
import {
  WEB_SIDECAR_DEFAULT_URL,
  WEB_SIDECAR_HEALTH_PATH,
  WEB_SIDECAR_PROBE_TIMEOUT_MS,
  type WebSidecarHealth,
} from '../../../shared/web-sidecar'

/**
 * Browser-side client for the web sidecar: the same DesktopApi shape the
 * Electron preload exposes, backed by sidecar HTTP endpoints that front the
 * DeepSeek Harness gateway with CORS. Used only in web mode, when the sidecar
 * answers /api/health; otherwise the in-memory mocks take over.
 */
export class WebSidecarClient implements DesktopApi {
  private constructor(readonly baseUrl: string) {}

  /** Probe the sidecar; returns a client when it answers, otherwise null (mocks). */
  static async detect(): Promise<WebSidecarClient | null> {
    const base = typeof window !== 'undefined' && window.__ND_DSH_WEB_SIDECAR_URL
      ? window.__ND_DSH_WEB_SIDECAR_URL
      : WEB_SIDECAR_DEFAULT_URL
    try {
      const response = await fetch(`${base}${WEB_SIDECAR_HEALTH_PATH}`, {
        signal: AbortSignal.timeout(WEB_SIDECAR_PROBE_TIMEOUT_MS),
      })
      if (!response.ok) return null
      const health = (await response.json()) as WebSidecarHealth
      return health?.ok === true ? new WebSidecarClient(base) : null
    } catch {
      return null
    }
  }

  // ── dsh / gateway protocol ────────────────────────────────────────────────

  dsh = {
    rpc: async (method: string, payload: unknown = {}): Promise<GatewayRpcResult> => {
      const rpcId = crypto.randomUUID()
      const response = await fetch(`${this.baseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      if (!response.ok) throw new Error(`gateway ${method}: HTTP ${response.status}`)
      const frame = (await response.json()) as ServerResponseFrame
      if (!frame || frame.type !== 'server-response') throw new Error(`gateway ${method}: unexpected response shape`)
      return frame.result.ok
        ? { ok: true, value: frame.result.value }
        : { ok: false, error: normalizeError(frame.result.error) }
    },
    respond: async (rpcId: string, value: unknown): Promise<void> => {
      const response = await fetch(`${this.baseUrl}/api/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }),
      })
      if (!response.ok) throw new Error(`gateway respond: HTTP ${response.status}`)
      const receipt = (await response.json()) as { accepted?: boolean; reason?: string }
      if (receipt?.accepted !== true) throw new Error(`gateway respond rejected: ${receipt?.reason ?? 'unknown reason'}`)
    },
    onEvent: (listener: (frame: DshEventFrame) => void): (() => void) => {
      const streams = ['/api/events.mux', '/api/events.host'].map((path) => this.openEventStream(path, listener))
      return () => { for (const close of streams) close() }
    },
  }

  private openEventStream(path: string, listener: (frame: DshEventFrame) => void): () => void {
    const source = new EventSource(`${this.baseUrl}${path}`)
    const onMessage = (event: MessageEvent): void => {
      try {
        const message = JSON.parse(String(event.data)) as ServerRequestFrame
        if (!message || message.type !== 'server-request') return
        const frame = translateFrame(message)
        if (frame) listener(frame)
      } catch {
        // A malformed frame is dropped; EventSource reconnects itself.
      }
    }
    source.addEventListener('message', onMessage)
    return () => source.close()
  }

  // ── harness ────────────────────────────────────────────────────────────────

  harness = {
    status: async (): Promise<HarnessStatus> => {
      const response = await fetch(`${this.baseUrl}/api/harness/status`)
      if (!response.ok) throw new Error(`harness status: HTTP ${response.status}`)
      return (await response.json()) as HarnessStatus
    },
    run: async (prompt: string, options?: { sessionId?: string }): Promise<HarnessRunResult> => {
      const response = await this.post('/api/harness/run', { prompt, sessionId: options?.sessionId })
      return (response as HarnessRunResult)
    },
    stop: async (): Promise<HarnessStatus> => {
      const response = await this.post('/api/harness/stop', {})
      return (response as HarnessStatus)
    },
    getPermissionMode: async (): Promise<string> => {
      const response = await fetch(`${this.baseUrl}/api/harness/permission/get`)
      if (!response.ok) throw new Error(`permission get: HTTP ${response.status}`)
      return ((await response.json()) as { mode?: string }).mode ?? 'workspace-write'
    },
    setPermissionMode: async (mode: string): Promise<string> => {
      const response = await this.post('/api/harness/permission/set', { mode })
      return typeof response === 'string' ? response : (response as { mode?: string }).mode ?? mode
    },
    onStatus: (listener: (status: HarnessStatus) => void): (() => void) => {
      let cancelled = false
      const tick = async (): Promise<void> => {
        if (cancelled) return
        try {
          listener(await this.harness.status())
        } catch {
          // The sidecar may be restarting; keep polling.
        }
        window.setTimeout(() => void tick(), 1_500)
      }
      void tick()
      return () => { cancelled = true }
    },
  }

  // ── workspace ──────────────────────────────────────────────────────────────

  workspace = {
    state: async (): Promise<WorkspaceState> => {
      const response = await fetch(`${this.baseUrl}/api/workspace/state`)
      if (!response.ok) throw new Error(`workspace state: HTTP ${response.status}`)
      return (await response.json()) as WorkspaceState
    },
    pick: async (): Promise<WorkspaceState> => this.workspace.state(),
    setRoot: async (path: string): Promise<WorkspaceState> => {
      const response = await this.post('/api/workspace/set-root', { path })
      return (response as WorkspaceState)
    },
    list: async (relativePath = '.'): Promise<WorkspaceEntry[]> => {
      const url = `${this.baseUrl}/api/workspace/list?path=${encodeURIComponent(relativePath)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`workspace list: HTTP ${response.status}`)
      return (await response.json()) as WorkspaceEntry[]
    },
    read: async (relativePath: string): Promise<WorkspaceFile> => {
      const url = `${this.baseUrl}/api/workspace/read?path=${encodeURIComponent(relativePath)}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`workspace read: HTTP ${response.status}`)
      return (await response.json()) as WorkspaceFile
    },
  }

  // ── providers / theme / surface (sidecar-hosted settings) ─────────────────

  providers = {
    list: async (): Promise<ModelProvider[]> => {
      const response = await fetch(`${this.baseUrl}/api/providers/list`)
      if (!response.ok) throw new Error(`providers list: HTTP ${response.status}`)
      return (await response.json()) as ModelProvider[]
    },
    save: async (providers: ModelProvider[]): Promise<ModelProvider[]> => {
      const response = await this.post('/api/providers/save', { providers })
      return (response as ModelProvider[])
    },
  }

  theme = {
    state: async (): Promise<ThemeState> => {
      const response = await fetch(`${this.baseUrl}/api/theme/state`)
      if (!response.ok) throw new Error(`theme state: HTTP ${response.status}`)
      return (await response.json()) as ThemeState
    },
    set: async (mode: ThemeMode): Promise<ThemeState> => {
      const response = await this.post('/api/theme/set', { mode })
      return (response as ThemeState)
    },
    onChanged: (): (() => void) => () => undefined,
  }

  surface = {
    state: async (): Promise<SurfaceState> => {
      const response = await fetch(`${this.baseUrl}/api/surface/state`)
      if (!response.ok) throw new Error(`surface state: HTTP ${response.status}`)
      return (await response.json()) as SurfaceState
    },
    set: async (surface: SurfaceState['surface']): Promise<SurfaceState> => {
      const response = await this.post('/api/surface/set', { surface })
      return (response as SurfaceState)
    },
    onChanged: (): (() => void) => () => undefined,
  }

  // ── native-only surfaces (WebContentsView cannot exist in a browser tab) ───

  browser = {
    state: async (): Promise<BrowserState> => ({ ...WEB_BROWSER_STATE }),
    setBounds: async (): Promise<void> => undefined,
    setVisible: async (): Promise<void> => undefined,
    navigate: async (url: string): Promise<BrowserState> => ({ ...WEB_BROWSER_STATE, url }),
    back: async (): Promise<BrowserState> => ({ ...WEB_BROWSER_STATE }),
    forward: async (): Promise<BrowserState> => ({ ...WEB_BROWSER_STATE }),
    reload: async (): Promise<BrowserState> => ({ ...WEB_BROWSER_STATE }),
    snapshot: async (): Promise<string> => 'Web preview: the live browser only exists in the desktop app.',
    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onState: (): (() => void) => () => undefined,
  }

  dshView = {
    setBounds: async (): Promise<void> => undefined,
    setVisible: async (): Promise<void> => undefined,
    reload: async (): Promise<void> => undefined,
    onState: (): (() => void) => () => undefined,
  }

  app = {
    info: async (): Promise<AppInfo> => ({
      name: 'ND-DSH',
      version: '0.0.0-web-sidecar',
      platform: 'web',
      projectRoot: (await this.workspace.state()).root,
    }),
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
    return response.json() as Promise<unknown>
  }
}

/** The sidecar URL can be force-set at runtime (devtools/localStorage) for tests. */
declare global {
  interface Window {
    __ND_DSH_WEB_SIDECAR_URL?: string
  }
}

// The browser surface is native-only; this keeps the shape desktop UI expects.
const WEB_BROWSER_STATE: BrowserState = {
  url: 'about:blank',
  title: 'Web preview',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  visible: false,
  cdpPort: 0,
  agentBrowser: 'unavailable',
}

interface ServerResponseFrame {
  type: 'server-response'
  rpcId: string
  result: { ok: true; value: unknown } | { ok: false; error: unknown }
}

interface ServerRequestFrame {
  type: 'server-request'
  rpcId: string
  method: string
  payload: unknown
}

/** Ported from src/main/dsh/gateway-client.ts (browser copy, same wire contract). */
function translateFrame(message: ServerRequestFrame): DshEventFrame | undefined {
  const payload = (message.payload ?? {}) as Record<string, unknown>
  const sessionId = asString(payload.sessionId)
  const withSession = sessionId === undefined ? {} : { sessionId }
  switch (payload.type) {
    case 'session/event':
      return { kind: 'session-event', ...withSession, event: payload.event as SessionEventEnvelope }
    case 'approval/requested': {
      const approvalId = asString(payload.approvalId)
      const toolName = asString(payload.toolName)
      const callId = asString(payload.callId)
      const reason = asString(payload.reason)
      return {
        kind: 'approval-requested',
        ...withSession,
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(toolName === undefined ? {} : { toolName }),
        ...(callId === undefined ? {} : { callId }),
        ...(reason === undefined ? {} : { reason }),
        rpcId: message.rpcId,
      }
    }
    case 'approval/resolved': {
      const approvalId = asString(payload.approvalId)
      const outcome = asString(payload.outcome)
      return {
        kind: 'approval-resolved',
        ...withSession,
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(outcome === undefined ? {} : { outcome }),
      }
    }
    case 'question/requested':
      return { kind: 'question-requested', ...withSession, questions: payload.questions, rpcId: message.rpcId }
    case 'question/resolved': {
      const outcome = asString(payload.outcome)
      return { kind: 'question-resolved', ...withSession, ...(outcome === undefined ? {} : { outcome }), rpcId: message.rpcId }
    }
    case 'host/session-status':
      return { kind: 'session-status', ...withSession, running: payload.running === true }
    case 'host/session-added':
      return { kind: 'session-added', ...withSession, meta: payload }
    case 'host/session-removed':
      return { kind: 'session-removed', ...withSession }
    case 'host/agent-error':
      return { kind: 'agent-error', ...withSession, message: asString(payload.message) ?? 'Agent error' }
    case 'stream/error': {
      const error = (payload.error ?? {}) as { message?: unknown }
      return { kind: 'stream-error', message: asString(error.message) ?? 'Event stream error' }
    }
    default:
      return { kind: 'other', ...withSession, meta: payload }
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function normalizeError(error: unknown): { code: string; message: string } {
  const record = (error ?? {}) as Record<string, unknown>
  return {
    code: typeof record.code === 'string' ? record.code : 'internal',
    message: typeof record.message === 'string' ? record.message : 'Gateway request failed',
  }
}
