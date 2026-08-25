import type {
  EngineSessionSummary,
  EngineSessionTranscript,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessStatus,
} from '../../shared/contracts.js'
import { CODEX_CLI_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
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
  constructor(
    private readonly harness: HarnessService,
    private readonly codex: CodexCliEngine,
    private readonly workspace: WorkspaceService,
  ) {}

  async run(prompt: string, options?: HarnessRunOptions): Promise<HarnessRunResult> {
    const requested = options?.sessionId
      ? this.engineForSession(options.sessionId)
      : options?.engineId ?? ND_HARNESS_ENGINE_ID
    if (requested === CODEX_CLI_ENGINE_ID) {
      return this.codex.run(prompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        cwd: this.workspace.state().root,
      })
    }
    return this.harness.run(prompt, options)
  }

  /**
   * Create a session on the engine named by a catalog descriptor id. An
   * explicit cwd is the portable isolation seam used by organization task
   * worktrees; interactive chat keeps the active workspace default.
   */
  async createSession(engineId: string, cwd?: string): Promise<{ sessionId: string; engineId: string }> {
    const targetCwd = cwd ?? this.workspace.state().root
    if (engineId === CODEX_CLI_ENGINE_ID) {
      return { engineId, sessionId: (await this.codex.createSession({ cwd: targetCwd })).sessionId }
    }
    if (cwd === undefined) {
      return { engineId: ND_HARNESS_ENGINE_ID, sessionId: await this.harness.createSession() }
    }
    const result = await this.harness.gatewayRpc('session.create', { cwd: targetCwd })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.create failed')
    const sessionId = (result.value as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Harness session.create returned no session id')
    return { engineId: ND_HARNESS_ENGINE_ID, sessionId }
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

  private engineForSession(sessionId: string): string | undefined {
    if (this.codex.ownsSession(sessionId)) return CODEX_CLI_ENGINE_ID
    return ND_HARNESS_ENGINE_ID
  }
}
