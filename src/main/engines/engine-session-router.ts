import { app } from 'electron'
import { join } from 'node:path'
import type {
  DshEventFrame,
  EngineModelOption,
  EngineSessionSummary,
  EngineSessionTranscript,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessStatus,
} from '../../shared/contracts.js'
import { ANTIGRAVITY_ENGINE_ID, CHATGPT_WEB_ENGINE_ID, CODEX_CLI_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import type { ExtensionRouter } from '../extensions/extension-router.js'
import { GitService } from '../git/git-service.js'
import { tokenSaverRuntime } from '../token-saver/token-saver-runtime.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import { sessionInWorkspace } from '../workspace/path-utils.js'
import type { BrowserController } from '../browser/browser-controller.js'
import type { AntigravityEngine } from './antigravity/antigravity-engine.js'
import { ChatGptWebEngine } from './chatgpt-web/chatgpt-web-engine.js'
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
  private readonly chatGptWeb: ChatGptWebEngine

  constructor(
    private readonly harness: HarnessService,
    private readonly codex: CodexCliEngine,
    private readonly workspace: WorkspaceService,
    private readonly antigravity?: AntigravityEngine,
  ) {
    // HarnessService already owns the canonical visible BrowserController.
    // Reuse that exact instance rather than launching or embedding a second
    // browser; the cast is confined to this adapter boundary until the common
    // engine runtime context becomes an explicit constructor contract.
    const browser = (harness as unknown as { browser: BrowserController }).browser
    this.chatGptWeb = new ChatGptWebEngine({
      browser,
      git: new GitService(workspace),
      workspace,
      storePath: join(app.getPath('userData'), 'chatgpt-web-sessions.json'),
      log: (line) => console.warn(line),
    })
    // The harness already owns ND's canonical engine-event fan-out. Resolve it
    // lazily at event time because index.ts attaches listeners after this router
    // is constructed.
    this.chatGptWeb.setEmitter((frame: DshEventFrame) => {
      const emit = (this.harness as unknown as { onEvent?: (event: DshEventFrame) => void }).onEvent
      emit?.(frame)
    })
  }

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
    // Built-in Token Saver is deliberately applied at the common engine
    // boundary, after ND has added trusted extension context and before either
    // the Harness or direct engines receive the turn.
    const optimizedPrompt = tokenSaverRuntime()?.optimize(routedPrompt, { kind: 'prompt' }).text ?? routedPrompt
    if (requested === CODEX_CLI_ENGINE_ID) {
      return this.codex.run(optimizedPrompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        cwd: this.workspace.state().root,
      })
    }
    if (requested === ANTIGRAVITY_ENGINE_ID && this.antigravity) {
      return this.antigravity.run(optimizedPrompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options?.model !== undefined ? { model: options.model } : {}),
        cwd: this.workspace.state().root,
      })
    }
    if (requested === CHATGPT_WEB_ENGINE_ID) {
      return this.chatGptWeb.run(optimizedPrompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        cwd: this.workspace.state().root,
      })
    }
    return this.harness.run(optimizedPrompt, options)
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
    if (engineId === ANTIGRAVITY_ENGINE_ID && this.antigravity) {
      const sessionId = (await this.antigravity.createSession({ cwd: targetCwd })).sessionId
      this.logicalEngineBySession.set(sessionId, engineId)
      return { engineId, sessionId }
    }
    if (engineId === CHATGPT_WEB_ENGINE_ID) {
      const sessionId = (await this.chatGptWeb.createSession({ cwd: targetCwd })).sessionId
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

  /** Cancel exactly one engine session; unrelated organization workers continue. */
  async stopSession(sessionId: string): Promise<void> {
    const engine = this.engineForSession(sessionId)
    if (engine === CODEX_CLI_ENGINE_ID) {
      await this.codex.stop(sessionId)
      return
    }
    if (engine === ANTIGRAVITY_ENGINE_ID && this.antigravity) {
      await this.antigravity.stop(sessionId)
      return
    }
    if (engine === CHATGPT_WEB_ENGINE_ID) {
      await this.chatGptWeb.stop(sessionId)
      return
    }
    const result = await this.harness.gatewayRpc('session.cancel', { sessionId })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.cancel failed')
  }

  /** Cancel pending turns on every engine; each keeps its runtime available. */
  async stop(): Promise<HarnessStatus> {
    await this.chatGptWeb.stop()
    await this.antigravity?.stop()
    await this.codex.stop()
    return this.harness.stop()
  }

  /** Approval/question answers are routed by who issued the rpcId. */
  respond(rpcId: string, value: unknown): Promise<void> {
    if (this.codex.handlesApproval(rpcId)) return this.codex.respond(rpcId, value)
    if (this.antigravity?.handlesApproval(rpcId)) return this.antigravity.respond(rpcId, value)
    if (this.chatGptWeb.handlesApproval(rpcId)) return this.chatGptWeb.respond(rpcId, value)
    return this.harness.respond(rpcId, value)
  }

  sessions(): EngineSessionSummary[] {
    const workspaceRoot = this.workspace.state().root
    return [
      ...this.chatGptWeb.listSessions(),
      ...this.antigravity?.listSessions() ?? [],
      ...this.codex.listSessions(),
    ].filter((session) => sessionInWorkspace(workspaceRoot, session.cwd))
  }

  transcript(sessionId: string): EngineSessionTranscript {
    if (this.chatGptWeb.ownsSession(sessionId)) return this.chatGptWeb.transcript(sessionId)
    if (this.antigravity?.ownsSession(sessionId)) return this.antigravity.transcript(sessionId)
    return this.codex.transcript(sessionId)
  }

  /**
   * Native model catalog for engines that expose one; engines whose model
   * configuration has no ND-visible picker return an empty list.
   */
  async models(engineId: string): Promise<EngineModelOption[]> {
    if (engineId === ANTIGRAVITY_ENGINE_ID && this.antigravity) return this.antigravity.listModels()
    return []
  }

  private engineForSession(sessionId: string): string {
    const logical = this.logicalEngineBySession.get(sessionId)
    if (logical) return logical
    if (this.chatGptWeb.ownsSession(sessionId)) return CHATGPT_WEB_ENGINE_ID
    if (this.codex.ownsSession(sessionId)) return CODEX_CLI_ENGINE_ID
    if (this.antigravity?.ownsSession(sessionId)) return ANTIGRAVITY_ENGINE_ID
    return ND_HARNESS_ENGINE_ID
  }
}
