import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HarnessNotification, HarnessRunResult, HarnessStatus } from '../../shared/contracts.js'
import { cordisConfigPath, harnessRoot, harnessRuntimeBinPath, harnessSdkClientPath, projectRoot } from '../app-paths.js'
import type { BrowserController } from '../browser/browser-controller.js'
import type { ProviderStore } from '../providers.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'

interface UpstreamRunResult {
  sessionId: string
  finalResponse: string
  events: unknown[]
  notifications: unknown[]
}

interface UpstreamHarness {
  run(
    input: string,
    options?: {
      sessionId?: string
      onNotification?: (notification: unknown) => void
    },
  ): Promise<UpstreamRunResult>
  close(): Promise<void>
}

interface UpstreamModule {
  DeepSeekHarness: new (options: {
    launch: {
      command: string
      args: string[]
      cwd: string
      env: NodeJS.ProcessEnv
      shutdownTimeoutMs: number
      disposeEofGraceMs: number
      disposeGraceMs: number
    }
    cwd: string
    provider: string
    model: string
    maxTokens: number
  }) => UpstreamHarness
}

const importModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<UpstreamModule>

const DEFAULT_PROVIDER = 'deepseek-official'
const DEFAULT_MODEL = 'deepseek-v4-flash'

export class HarnessService {
  private instance: UpstreamHarness | undefined
  private sessionId: string | undefined
  private statusValue: HarnessStatus
  private running = false
  private stopRequested = false
  private stopping: Promise<void> | undefined
  private onStatusChanged?: (status: HarnessStatus) => void
  private onNotification?: (notification: HarnessNotification) => void

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly browser: BrowserController,
    private readonly providers: ProviderStore,
  ) {
    this.statusValue = this.computeStatus('stopped')
  }

  setListeners(listeners: {
    status: (status: HarnessStatus) => void
    notification: (notification: HarnessNotification) => void
  }): void {
    this.onStatusChanged = listeners.status
    this.onNotification = listeners.notification
    listeners.status(this.status())
  }

  status(): HarnessStatus {
    return { ...this.statusValue }
  }

  async run(prompt: string): Promise<HarnessRunResult> {
    const cleaned = prompt.trim()
    if (!cleaned) throw new Error('Prompt cannot be empty')
    if (cleaned.length > 100_000) throw new Error('Prompt exceeds the 100,000 character limit')
    if (this.running) throw new Error('The Harness is already running a turn')
    if (this.stopping) await this.stopping

    this.stopRequested = false
    this.running = true
    this.updateStatus(this.instance ? 'running' : 'starting')
    try {
      const harness = await this.ensureStarted()
      this.updateStatus('running')
      const result = await harness.run(cleaned, {
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        onNotification: (notification) => this.onNotification?.(normalizeNotification(notification)),
      })
      this.sessionId = result.sessionId
      this.updateStatus('ready')
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        notificationCount: result.notifications.length,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.updateStatus(this.stopRequested ? 'stopped' : 'error', this.stopRequested ? undefined : message)
      throw error
    } finally {
      this.running = false
    }
  }

  async stop(): Promise<HarnessStatus> {
    this.stopRequested = true
    if (!this.stopping) {
      this.stopping = (async () => {
        const instance = this.instance
        this.instance = undefined
        this.sessionId = undefined
        if (instance) await instance.close()
      })().finally(() => {
        this.stopping = undefined
      })
    }
    await this.stopping
    this.running = false
    this.updateStatus('stopped')
    return this.status()
  }

  async close(): Promise<void> {
    await this.stop()
  }

  private async ensureStarted(): Promise<UpstreamHarness> {
    if (this.instance) return this.instance

    await this.browser.ensureAgentReady()

    const sdkPath = harnessSdkClientPath()
    const runtimePath = harnessRuntimeBinPath()
    const configPath = cordisConfigPath()
    const missing = [sdkPath, runtimePath, configPath].filter((value) => !existsSync(value))
    if (missing.length > 0) {
      throw new Error(`DeepSeek Harness is not bootstrapped. Missing: ${missing.join(', ')}. Run pnpm bootstrap.`)
    }

    const module = await importModule(pathToFileURL(sdkPath).href)
    const workspaceRoot = this.workspace.state().root
    const dshHome = join(app.getPath('userData'), 'dsh-home')
    const sessionRoot = join(app.getPath('userData'), 'sessions')
    await Promise.all([fs.mkdir(dshHome, { recursive: true }), fs.mkdir(sessionRoot, { recursive: true })])

    const provider = process.env.ND_DSH_PROVIDER?.trim() || DEFAULT_PROVIDER
    const configured = this.providers.enabled()
    const model = configured?.models[0]?.id?.trim() || process.env.ND_DSH_MODEL?.trim() || DEFAULT_MODEL
    const maxTokens = parsePositiveInteger(process.env.ND_DSH_MAX_TOKENS, 49_152)
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...(configured?.apiKey ? { DEEPSEEK_API_KEY: configured.apiKey } : {}),
      ...this.browser.agentBrowserEnvironment(),
      DSH_HOME: dshHome,
      DSH_CWD: workspaceRoot,
      DSH_SESSION_ROOT: sessionRoot,
      DSH_PERMISSION_MODE: process.env.ND_DSH_PERMISSION_MODE ?? 'workspace-write',
      DSH_CORDIS_CONFIG: configPath,
      ND_DSH_PROJECT_SKILL_DIR: join(projectRoot(), '.dsh/skills'),
    }

    this.instance = new module.DeepSeekHarness({
      launch: {
        command: process.env.ND_DSH_NODE_BIN?.trim() || 'node',
        args: [runtimePath, configPath],
        cwd: harnessRoot(),
        env: environment,
        shutdownTimeoutMs: 2_000,
        disposeEofGraceMs: 8_000,
        disposeGraceMs: 4_000,
      },
      cwd: workspaceRoot,
      provider,
      model,
      maxTokens,
    })
    return this.instance
  }

  private computeStatus(state: HarnessStatus['state'], error?: string): HarnessStatus {
    const sourceReady =
      existsSync(harnessSdkClientPath()) && existsSync(harnessRuntimeBinPath()) && existsSync(cordisConfigPath())
    const configured = this.providers.enabled()
    const apiKeyPresent = Boolean((configured?.apiKey ?? process.env.DEEPSEEK_API_KEY)?.trim())
    return {
      state,
      sourceReady,
      apiKeyPresent,
      provider: process.env.ND_DSH_PROVIDER?.trim() || DEFAULT_PROVIDER,
      model: configured?.models[0]?.id?.trim() || process.env.ND_DSH_MODEL?.trim() || DEFAULT_MODEL,
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(error ? { error } : {}),
    }
  }

  private updateStatus(state: HarnessStatus['state'], error?: string): void {
    this.statusValue = this.computeStatus(state, error)
    this.onStatusChanged?.(this.status())
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNotification(value: unknown): HarnessNotification {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const method = typeof record.method === 'string' ? record.method : 'harness/notification'
    return { method, ...(record.params === undefined ? {} : { params: record.params }) }
  }
  return { method: 'harness/notification', params: value }
}
