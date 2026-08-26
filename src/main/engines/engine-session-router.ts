import type {
  EngineSessionSummary,
  EngineSessionTranscript,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessStatus,
} from '../../shared/contracts.js'
import { CODEX_CLI_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import type { ExtensionRouter } from '../extensions/extension-router.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import type { CodexCliEngine } from './codex/codex-cli-engine.js'
import type { HarnessService } from '../harness/harness-service.js'

/**
 * The single dispatch point between renderer-facing run/respond/stop calls and
 * the engine that owns the target session. Organization workflow and renderer
 * code never branch on engine ids; routing is derived from explicit run
 * options or from which engine registered the session id.
 */
export class EngineSessionRouter {
  private extensions: ExtensionRouter | undefined
  /** Logical engine ids for harness-backed sessions such as delegated Codex. */
  private readonly logicalEngineBySession = new Map<string, string>()

  constructor(
    private readonly harness: HarnessService,
    private readonly codex: CodexCliEngine,
    private readonly workspace: WorkspaceService,
  ) {}

  setExtensionRouter(router: ExtensionRouter): void {
    this.extensions = router
  }

  async run(prompt: string, options?: HarnessRunOptions): Promise<HarnessRunResult> {
    const requested = options?.sessionId
      ? this.engineForSession(options.sessionId)
      : options?.engineId ?? ND_HARNESS_ENGINE_ID
    const providerId = requested === ND_HARNESS_ENGINE_ID
      ? options?.provider ?? this.harness.status().provider
      : undefined
    const routedPrompt = this.extensions
      ? await this.extensions.decoratePrompt(prompt, requested, providerId)
      : prompt
    if (requested === CODEX_CLI_ENGINE_ID) {
      return this.codex.run(routedPrompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        cwd: this.workspace.state().root,
      })
    }
    return this.harness.run(routedPrompt, options)
  }

  /**
   * Create a session on the engine named by a catalog descriptor id. An
   * explicit cwd is the portable isolation seam used by organization task
   * worktrees; interactive chat keeps the active workspace default.
   */
  async createSession(engineId: string, cwd?: string): Promise<{ sessionId: string; engineId: string }> {
    const targetCwd = cwd ?? this.workspace.state().root
    if (engineId === CODEX_CLI_ENGINE_ID) {
      const sessionId = (await this.codex.createSession({ cwd: targetCwd })).sessionId
      this.logicalEngineBySession.set(sessionId, engineId)
      return { engineId, sessionId }
    }
    if (cwd === undefined) {
      const sessionId = await this.harness.createSession()
      this.logicalEngineBySession.set(sessionId, engineId)
      return { engineId, sessionId }
    }
    const result = await this.harness.gatewayRpc('session.create', { cwd: targetCwd })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.create failed')
    const sessionId = (result.value as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Harness session.create returned no session id')
    this.logicalEngineBySession.set(sessionId, engineId)
    return { engineId, sessionId }
  }

  /** Cancel pending turns on every engine; each keeps its runtime available. */
  async stop(): Promise<HarnessStatus> {
    await this.codex.stop()
    return this.harness.stop()
  }

  /** Approval/question answers are routed by who issued the rpcId. */
  respond(rpcId: string, value: unknown): Promise<void> {
    if (this.codex.handlesApproval(rpcId)) return this.codex.respond(rpcId, value)
    return this.harness.respond(rpcId, value)
  }

  sessions(): EngineSessionSummary[] {
    return this.codex.listSessions()
  }

  transcript(sessionId: string): EngineSessionTranscript {
    return this.codex.transcript(sessionId)
  }

  private engineForSession(sessionId: string): string {
    const logical = this.logicalEngineBySession.get(sessionId)
    if (logical) return logical
    if (this.codex.ownsSession(sessionId)) return CODEX_CLI_ENGINE_ID
    return ND_HARNESS_ENGINE_ID
  }
}
