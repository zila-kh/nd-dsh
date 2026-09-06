import type {
  DshEventFrame,
  EngineModelOption,
  EngineSessionSummary,
  EngineSessionTranscript,
  HarnessRunOptions,
  HarnessRunResult,
  HarnessStatus,
} from '../../shared/contracts.js'
import {
  ANTIGRAVITY_ENGINE_ID,
  CHATGPT_WEB_ENGINE_ID,
  CLAUDE_CODE_CLI_ENGINE_ID,
  CODEX_CLI_ENGINE_ID,
  CURSOR_CLI_ENGINE_ID,
  ND_HARNESS_ENGINE_ID,
  PI_CODING_ENGINE_ID,
  ZCODE_CLI_ENGINE_ID,
} from '../../shared/coding-engines.js'
import type { BrowserController } from '../browser/browser-controller.js'
import { appendWorkspaceContext } from '../../shared/workspace-context.js'
import type { ExtensionRouter } from '../extensions/extension-router.js'
import type { GitService } from '../git/git-service.js'
import type { HarnessService } from '../harness/harness-service.js'
import { tokenSaverRuntime } from '../token-saver/token-saver-runtime.js'
import { sessionInWorkspace } from '../workspace/path-utils.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import type { ClaudeCodeCliEngine } from './claude/claude-code-cli-engine.js'
import type { AntigravityEngine } from './antigravity/antigravity-engine.js'
import type { CursorCliEngine } from './cursor/cursor-cli-engine.js'
import { ChatGptWebEngine } from './chatgpt-web/chatgpt-web-engine.js'
import type { CodexCliEngine } from './codex/codex-cli-engine.js'
import type { PiCodingEngine } from './pi/pi-coding-engine.js'
import type { ZcodeCliEngine } from './zcode/zcode-cli-engine.js'

export interface ChatGptWebRuntime {
  browser: BrowserController
  git: GitService
  storePath: string
  log?: (line: string) => void
}

/**
 * The shared surface of every workspace-capable direct engine. The router
 * dispatches to these by catalog id; organization workflow and renderer code
 * never branch on engine ids.
 */
export interface DirectWorkspaceEngine {
  run(prompt: string, options?: { sessionId?: string; cwd?: string; model?: string }): Promise<{ sessionId: string }>
  createSession(input?: { cwd?: string; model?: string }): Promise<{ sessionId: string }>
  stop(sessionId?: string): Promise<void>
  listSessions(): EngineSessionSummary[]
  transcript(sessionId: string): EngineSessionTranscript
  ownsSession(sessionId: string): boolean
  handlesApproval(rpcId: string): boolean
  respond(rpcId: string, value: unknown): Promise<void>
  listModels(): Promise<EngineModelOption[]>
}

/**
 * The single dispatch point between renderer-facing run/respond/stop calls and
 * the engine that owns the target session. Routing is derived from explicit run
 * options or from which engine registered the session id.
 */
export class EngineSessionRouter {
  private extensions: ExtensionRouter | undefined
  /** Logical engine ids for harness-backed sessions such as delegated Codex. */
  private readonly logicalEngineBySession = new Map<string, string>()
  private readonly chatGptWeb: ChatGptWebEngine | undefined
  private readonly chatGptWebBrowser: BrowserController | undefined
  private readonly chatGptWebLog: ((line: string) => void) | undefined
  /** Workspace-capable direct engines by catalog id, in catalog order. */
  private readonly directEngines = new Map<string, DirectWorkspaceEngine>()

  constructor(
    private readonly harness: HarnessService,
    codex: CodexCliEngine,
    private readonly workspace: WorkspaceService,
    antigravity?: AntigravityEngine,
    chatGptWebRuntime?: ChatGptWebRuntime,
    zcode?: ZcodeCliEngine,
    pi?: PiCodingEngine,
    cursor?: CursorCliEngine,
    claude?: ClaudeCodeCliEngine,
  ) {
    this.directEngines.set(CODEX_CLI_ENGINE_ID, codex)
    if (antigravity) this.directEngines.set(ANTIGRAVITY_ENGINE_ID, antigravity)
    if (zcode) this.directEngines.set(ZCODE_CLI_ENGINE_ID, zcode)
    if (pi) this.directEngines.set(PI_CODING_ENGINE_ID, pi)
    if (cursor) this.directEngines.set(CURSOR_CLI_ENGINE_ID, cursor)
    if (claude) this.directEngines.set(CLAUDE_CODE_CLI_ENGINE_ID, claude)
    if (chatGptWebRuntime) {
      this.chatGptWebBrowser = chatGptWebRuntime.browser
      this.chatGptWebLog = chatGptWebRuntime.log
      this.chatGptWeb = new ChatGptWebEngine({
        browser: chatGptWebRuntime.browser,
        git: chatGptWebRuntime.git,
        workspace,
        storePath: chatGptWebRuntime.storePath,
        ...(chatGptWebRuntime.log ? { log: chatGptWebRuntime.log } : {}),
      })
    }
  }

  setExtensionRouter(router: ExtensionRouter): void {
    this.extensions = router
  }

  /** Every direct engine emits through the same ND organization/renderer fan-out. */
  setEmitter(emit: (frame: DshEventFrame) => void): void {
    this.chatGptWeb?.setEmitter(emit)
    this.zcode?.setEmitter(emit)
    this.pi?.setEmitter(emit)
    this.cursor?.setEmitter(emit)
    this.claude?.setEmitter(emit)
  }

  private get zcode(): ZcodeCliEngine | undefined {
    return this.directEngines.get(ZCODE_CLI_ENGINE_ID) as ZcodeCliEngine | undefined
  }

  private get pi(): PiCodingEngine | undefined {
    return this.directEngines.get(PI_CODING_ENGINE_ID) as PiCodingEngine | undefined
  }

  private get cursor(): CursorCliEngine | undefined {
    return this.directEngines.get(CURSOR_CLI_ENGINE_ID) as CursorCliEngine | undefined
  }

  private get claude(): ClaudeCodeCliEngine | undefined {
    return this.directEngines.get(CLAUDE_CODE_CLI_ENGINE_ID) as ClaudeCodeCliEngine | undefined
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
    const direct = this.directEngines.get(requested)
    if (direct) {
      this.workspace.assertUsable()
      const workspace = this.workspace.state()
      return direct.run(appendWorkspaceContext(optimizedPrompt, workspace), {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        ...(options?.model !== undefined ? { model: options.model } : {}),
        cwd: workspace.root,
      })
    }
    if (requested === CHATGPT_WEB_ENGINE_ID) {
      const harnessState = this.harness.status().state
      if (harnessState === 'running' || harnessState === 'starting') {
        throw new Error('ChatGPT Web and ND Harness share the visible browser. Finish the active ND Harness turn before starting ChatGPT Web.')
      }
      const engine = this.requireChatGptWeb()
      const workspaceRoot = this.workspace.state().root
      if (options?.sessionId) {
        const session = engine.listSessions().find((candidate) => candidate.sessionId === options.sessionId)
        if (session?.cwd && session.cwd !== workspaceRoot) {
          throw new Error('This ChatGPT Web chat belongs to a different project workspace. Reopen that project before continuing the chat.')
        }
      }
      const browser = this.chatGptWebBrowser
      const returnUrl = browser?.state().url
      const result = await engine.run(optimizedPrompt, {
        ...(options?.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        cwd: workspaceRoot,
      })
      // ChatGPT temporarily owns the canonical visible browser while the turn
      // is active. After a successful turn, restore the user's app preview so
      // any Git fast-forward becomes visible immediately. On auth/setup errors
      // leave ChatGPT visible so the user can fix the page and retry.
      // `about:blank` is the browser's empty initial state, not a preview to
      // restore. Leaving ChatGPT visible in that case keeps the completed
      // conversation open instead of erasing it immediately after the turn.
      if (browser && returnUrl && isRestorableBrowserUrl(returnUrl)) {
        await browser.navigate(returnUrl).catch((error) => {
          this.chatGptWebLog?.(`[chatgpt-web] could not restore previous browser URL: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      return result
    }
    if (this.chatGptWeb?.listSessions().some((session) => session.running)) {
      throw new Error('ND Harness and ChatGPT Web share the visible browser. Finish the active ChatGPT Web turn before starting ND Harness.')
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
    const direct = this.directEngines.get(engineId)
    if (direct) {
      const sessionId = (await direct.createSession({ cwd: targetCwd })).sessionId
      this.logicalEngineBySession.set(sessionId, engineId)
      return { engineId, sessionId }
    }
    if (engineId === CHATGPT_WEB_ENGINE_ID) {
      const sessionId = (await this.requireChatGptWeb().createSession({ cwd: targetCwd })).sessionId
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
    const direct = this.directEngines.get(engine)
    if (direct) {
      await direct.stop(sessionId)
      return
    }
    if (engine === CHATGPT_WEB_ENGINE_ID) {
      await this.requireChatGptWeb().stop(sessionId)
      return
    }
    const result = await this.harness.gatewayRpc('session.cancel', { sessionId })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.cancel failed')
  }

  /** Cancel pending turns on every engine; each keeps its runtime available. */
  async stop(): Promise<HarnessStatus> {
    await this.chatGptWeb?.stop()
    for (const direct of this.directEngines.values()) await direct.stop()
    return this.harness.stop()
  }

  /** Release router-owned resources without double-closing the other engines. */
  async close(): Promise<void> {
    await this.chatGptWeb?.close()
  }

  /** Approval/question answers are routed by who issued the rpcId. */
  respond(rpcId: string, value: unknown): Promise<void> {
    for (const direct of this.directEngines.values()) {
      if (direct.handlesApproval(rpcId)) return direct.respond(rpcId, value)
    }
    if (this.chatGptWeb?.handlesApproval(rpcId)) return this.chatGptWeb.respond(rpcId, value)
    return this.harness.respond(rpcId, value)
  }

  sessions(): EngineSessionSummary[] {
    const workspaceRoot = this.workspace.state().root
    const directSessions = [...this.directEngines.values()].flatMap((direct) => direct.listSessions())
    return [
      ...this.chatGptWeb?.listSessions() ?? [],
      ...directSessions,
    ].filter((session) => sessionInWorkspace(workspaceRoot, session.cwd))
  }

  transcript(sessionId: string): EngineSessionTranscript {
    for (const direct of this.directEngines.values()) {
      if (direct.ownsSession(sessionId)) return direct.transcript(sessionId)
    }
    if (this.chatGptWeb?.ownsSession(sessionId)) return this.chatGptWeb.transcript(sessionId)
    throw new Error(`No engine owns session: ${sessionId}`)
  }

  /**
   * Native model catalog for engines that expose one; engines whose model
   * configuration has no ND-visible picker return an empty list.
   */
  async models(engineId: string): Promise<EngineModelOption[]> {
    const direct = this.directEngines.get(engineId)
    if (direct) return direct.listModels()
    return []
  }

  private engineForSession(sessionId: string): string {
    const logical = this.logicalEngineBySession.get(sessionId)
    if (logical) return logical
    for (const [engineId, direct] of this.directEngines) {
      if (direct.ownsSession(sessionId)) return engineId
    }
    if (this.chatGptWeb?.ownsSession(sessionId)) return CHATGPT_WEB_ENGINE_ID
    return ND_HARNESS_ENGINE_ID
  }

  private requireChatGptWeb(): ChatGptWebEngine {
    if (!this.chatGptWeb) {
      throw new Error('ChatGPT Web is unavailable because ND did not initialize its visible-browser Git-sync runtime.')
    }
    return this.chatGptWeb
  }
}

function isChatGptUrl(value: string): boolean {
  try {
    return new URL(value).origin === 'https://chatgpt.com'
  } catch {
    return false
  }
}

export function isRestorableBrowserUrl(value: string): boolean {
  return value.trim().toLowerCase() !== 'about:blank' && !isChatGptUrl(value)
}
