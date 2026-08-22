import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  DshEventFrame,
  GatewayRpcResult,
  HarnessRunResult,
  HarnessStatus,
} from '../../shared/contracts.js'
import { dshPatchPath, harnessCliBinPath, harnessRoot, presetSourceDir } from '../app-paths.js'
import type { BrowserController } from '../browser/browser-controller.js'
import { GatewayClient, pickFreePort } from '../dsh/gateway-client.js'
import type { ProviderStore } from '../providers.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'

const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const READY_TIMEOUT_MS = 120_000
const READY_POLL_MS = 300
const READY_URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/

export class HarnessService {
  private child: ChildProcess | undefined
  private gateway: GatewayClient | undefined
  private baseUrl: string | undefined
  private activeSessionId: string | undefined
  private statusValue: HarnessStatus
  private startPromise: Promise<GatewayClient> | undefined
  private stopping = false
  private canceledSessions = new Set<string>()
  private onStatusChanged?: (status: HarnessStatus) => void
  private onEvent?: (frame: DshEventFrame) => void
  private onGatewayReady?: (url: string) => void

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly browser: BrowserController,
    private readonly providers: ProviderStore,
  ) {
    this.statusValue = this.computeStatus('stopped')
  }

  setListeners(listeners: {
    status: (status: HarnessStatus) => void
    event: (frame: DshEventFrame) => void
    gatewayReady: (url: string) => void
  }): void {
    this.onStatusChanged = listeners.status
    this.onEvent = listeners.event
    this.onGatewayReady = listeners.gatewayReady
    listeners.status(this.status())
  }

  status(): HarnessStatus {
    return { ...this.statusValue }
  }

  /** Consume the user's cancellation intent for one session exactly once. */
  consumeCanceledSession(sessionId: string): boolean {
    return this.canceledSessions.delete(sessionId)
  }

  /**
   * Send one prompt to the active session (created lazily on first use).
   * The turn's progress arrives over the gateway event stream; the result
   * carries the durable message receipt.
   */
  async run(prompt: string, options?: { sessionId?: string }): Promise<HarnessRunResult> {
    const cleaned = prompt.trim()
    if (!cleaned) throw new Error('Prompt cannot be empty')
    if (cleaned.length > 100_000) throw new Error('Prompt exceeds the 100,000 character limit')

    const gateway = await this.ensureStarted()
    const sessionId = options?.sessionId?.trim() || this.activeSessionId || await this.createSession()
    this.activeSessionId = sessionId
    this.canceledSessions.delete(sessionId)

    const result = await gateway.rpc('session.prompt', {
      sessionId,
      content: [{ type: 'text', text: cleaned }],
    })
    if (!result.ok) throw new Error(rpcFailureMessage('session.prompt', result))
    const value = result.value as { messageId?: unknown } | undefined
    this.updateStatus('running')
    return { sessionId, ...(typeof value?.messageId === 'string' ? { messageId: value.messageId } : {}) }
  }

  /** Create a session on the workspace root (the deployment default preset applies). */
  async createSession(): Promise<string> {
    const gateway = await this.ensureStarted()
    const result = await gateway.rpc('session.create', { cwd: this.workspace.state().root })
    if (!result.ok) throw new Error(rpcFailureMessage('session.create', result))
    const sessionId = (result.value as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId !== 'string') throw new Error('session.create returned no session id')
    this.activeSessionId = sessionId
    this.updateStatus(this.statusValue.state === 'running' ? 'running' : 'ready')
    return sessionId
  }

  /** Whitelisted gateway call for read-oriented UI needs (sessions, models, presets…). */
  async gatewayRpc(method: string, payload?: unknown): Promise<GatewayRpcResult> {
    const gateway = await this.ensureStarted()
    return gateway.rpc(method, payload)
  }

  /** Boot the runtime eagerly (the DSH surface needs the UI as soon as it is active). */
  warmup(): void {
    void this.ensureStarted().catch((error) => {
      console.warn('ND-DSH harness warmup failed:', error instanceof Error ? error.message : String(error))
    })
  }

  /** Answer a pending approval or user question frame. */
  async respond(rpcId: string, value: unknown): Promise<void> {
    const gateway = await this.ensureStarted()
    await gateway.respond(rpcId, value)
  }

  /** Cancel the active session's pending turn; the runtime stays up. */
  async stop(): Promise<HarnessStatus> {
    if (this.activeSessionId && this.gateway) {
      const sessionId = this.activeSessionId
      // Mark intent before the RPC: the gateway may emit running:false before
      // the cancellation response reaches this process.
      this.canceledSessions.add(sessionId)
      try {
        const result = await this.gateway.rpc('session.cancel', { sessionId })
        if (!result.ok) this.canceledSessions.delete(sessionId)
      } catch {
        this.canceledSessions.delete(sessionId)
        // Cancellation is best-effort; the runtime remains available.
      }
    }
    this.updateStatus('ready')
    return this.status()
  }

  /**
   * Apply a new sandbox permission mode: it is a launch-time policy, so the
   * runtime restarts with the new DSH_PERMISSION_MODE (sessions are durable
   * and survive the restart).
   */
  async restartWithPermissionMode(mode: string): Promise<string> {
    process.env.ND_DSH_PERMISSION_MODE = mode
    await this.close()
    return mode
  }

  /** Tear down the runtime subprocess (app shutdown / workspace change). */
  async close(): Promise<void> {
    this.stopping = true
    const child = this.child
    const gateway = this.gateway
    this.child = undefined
    this.gateway = undefined
    this.baseUrl = undefined
    gateway?.close()
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {
            // Already gone.
          }
          resolve()
        }, 4_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        try {
          // The CLI handles SIGTERM/SIGINT with a graceful dispose; on Windows
          // kill() terminates directly, and durable sessions survive either way.
          child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
        } catch {
          clearTimeout(timer)
          resolve()
        }
      })
    }
    this.activeSessionId = undefined
    this.updateStatus('stopped')
  }

  private async ensureStarted(): Promise<GatewayClient> {
    if (this.gateway) return this.gateway
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start().finally(() => {
      this.startPromise = undefined
    })
    return this.startPromise
  }

  private async start(): Promise<GatewayClient> {
    // close() marks the current child as expected-to-stop; a fresh child must
    // return to normal unexpected-exit detection.
    this.stopping = false
    await this.browser.ensureAgentReady()

    const cliBin = harnessCliBinPath()
    const patchPath = dshPatchPath()
    const presetsDir = presetSourceDir()
    const missing = [cliBin, patchPath, presetsDir].filter((value) => !existsSync(value))
    if (missing.length > 0) {
      throw new Error(`DeepSeek Harness is not bootstrapped. Missing: ${missing.join(', ')}. Run pnpm bootstrap.`)
    }

    const workspaceRoot = this.workspace.state().root
    const dshHome = join(app.getPath('userData'), 'dsh-home')
    await fs.mkdir(join(dshHome, '.agent-presets'), { recursive: true })
    // The nd-dsh preset ships with the desktop; a fresh copy keeps it current.
    await fs.cp(presetsDir, join(dshHome, '.agent-presets'), { recursive: true, force: true })

    const configured = this.providers.enabled()
    const port = await pickFreePort()
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...(configured?.apiKey ? { DEEPSEEK_API_KEY: configured.apiKey } : {}),
      ...this.browser.agentBrowserEnvironment(),
      DSH_HOME: dshHome,
      DSH_CWD: workspaceRoot,
      DSH_PERMISSION_MODE: process.env.ND_DSH_PERMISSION_MODE ?? 'workspace-write',
      DSH_SESSION_ROOT: join(app.getPath('userData'), 'sessions'),
    }

    this.updateStatus('starting')
    const child = spawn(process.env.ND_DSH_NODE_BIN?.trim() || 'node', [
      cliBin,
      '--profile', 'web',
      '--patch', patchPath,
      '--no-open',
      '--port', String(port),
    ], {
      cwd: harnessRoot(),
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    if (child.stdout) child.stdout.setEncoding('utf8')
    if (child.stderr) child.stderr.setEncoding('utf8')

    let childError = ''
    child.stderr?.on('data', (chunk: string) => {
      childError = `${childError}${chunk}`.slice(-16_384)
    })
    child.once('exit', (code, signal) => {
      const wasExpected = this.stopping
      const gateway = this.gateway
      this.child = undefined
      this.gateway = undefined
      this.baseUrl = undefined
      gateway?.close()
      const reason = wasExpected ? undefined : `Harness exited (${signal ?? String(code ?? 'unknown')}): ${childError.split(/\r?\n/).at(-1) ?? ''}`.trim()
      this.updateStatus(wasExpected ? 'stopped' : 'error', wasExpected ? undefined : reason)
    })

    const baseUrl = `http://127.0.0.1:${port}`
    await this.waitUntilReady(child, baseUrl)
    const gateway = new GatewayClient(baseUrl)
    gateway.openEvents((frame) => this.handleEvent(frame))
    this.gateway = gateway
    this.baseUrl = baseUrl
    this.updateStatus('ready')
    this.onGatewayReady?.(baseUrl)
    return gateway
  }

  private async waitUntilReady(child: ChildProcess, baseUrl: string): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    const printedUrl = new Promise<void>((resolve) => {
      if (!child.stdout) return resolve()
      const onData = (chunk: string): void => {
        const match = READY_URL_PATTERN.exec(chunk)
        if (match) {
          child.stdout?.off('data', onData)
          resolve()
        }
      }
      child.stdout.on('data', onData)
      // The URL line is a readiness signal only; a child that never prints it
      // still resolves through the poll below, so keep the listener harmless.
    })
    const polled = (async () => {
      while (Date.now() < deadline) {
        if (child.exitCode !== null) break
        try {
          const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) })
          if (response.status < 500) return
        } catch {
          // Not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
      }
      throw new Error('Harness did not become ready within the timeout')
    })()
    await Promise.race([printedUrl, polled])
  }

  private handleEvent(frame: DshEventFrame): void {
    if (frame.kind === 'session-status' && frame.sessionId === this.activeSessionId) {
      this.updateStatus(frame.running ? 'running' : 'ready')
    }
    this.onEvent?.(frame)
  }

  private computeStatus(state: HarnessStatus['state'], error?: string): HarnessStatus {
    const sourceReady = existsSync(harnessCliBinPath()) && existsSync(dshPatchPath()) && existsSync(presetSourceDir())
    const configured = this.providers.enabled()
    const apiKeyPresent = Boolean((configured?.apiKey ?? process.env.DEEPSEEK_API_KEY)?.trim())
    return {
      state,
      sourceReady,
      apiKeyPresent,
      provider: process.env.ND_DSH_PROVIDER?.trim() || DEFAULT_PROVIDER,
      model: configured?.models[0]?.id?.trim() || process.env.ND_DSH_MODEL?.trim() || DEFAULT_MODEL,
      ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
      ...(this.baseUrl ? { url: this.baseUrl, port: Number(new URL(this.baseUrl).port) } : {}),
      ...(error ? { error } : {}),
    }
  }

  private updateStatus(state: HarnessStatus['state'], error?: string): void {
    this.statusValue = this.computeStatus(state, error)
    this.onStatusChanged?.(this.status())
  }
}

function rpcFailureMessage(method: string, result: GatewayRpcResult): string {
  return `${method} failed: ${result.error?.message ?? result.error?.code ?? 'unknown error'}`
}
