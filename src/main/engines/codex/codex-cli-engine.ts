import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  DshEventFrame,
  EngineSessionSummary,
  EngineSessionTranscript,
  SessionEventEnvelope,
} from '../../../shared/contracts.js'
import { CODEX_CLI_ENGINE_ID } from '../../../shared/coding-engines.js'
import { codexBinPath } from '../../app-paths.js'
import { asText, CodexAppServerWire, isObject, pickDecision, type JsonObject } from './codex-wire.js'

/**
 * ND-owned direct Codex engine. One long-lived official `codex app-server`
 * child hosts one thread per ND session; wire activity is translated into the
 * shared `DshEventFrame` vocabulary so the organization orchestrator and the
 * renderer consume it exactly like primary-runtime events. Native Codex
 * authentication, `CODEX_HOME`, and model configuration stay authoritative.
 */

export type CodexRunMode = 'interactive' | 'unattended'

/** Thread policies per run mode. Unattended runs stay fail-closed (`never`). */
const THREAD_POLICY: Record<CodexRunMode, JsonObject> = {
  interactive: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  unattended: { approvalPolicy: 'never' },
}

const TRANSCRIPT_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result'])
const RESULT_SNIPPET_MAX_CHARS = 4_000

interface PendingApproval {
  resolve: (result: JsonObject) => void
  availableDecisions: unknown
}

interface CodexSession {
  sessionId: string
  threadId: string
  cwd?: string
  mode: CodexRunMode
  title: string
  createdAt: number
  updatedAt: number
  running: boolean
  turnId?: string
  sequence: number
  transcript: SessionEventEnvelope[]
  turnSettled?: PromiseWithResolvers<{ status: string; failureMessage?: string }>
}

export interface CodexCliEngineOptions {
  /** Diagnostic sink for app-server stderr and lifecycle warnings. */
  log?: (line: string) => void
}

export class CodexCliEngine {
  private child: ChildProcess | undefined
  private wire: CodexAppServerWire | undefined
  private startPromise: Promise<void> | undefined
  private stopping = false
  private readonly sessions = new Map<string, CodexSession>()
  private readonly sessionsByThread = new Map<string, CodexSession>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private onEvent: ((frame: DshEventFrame) => void) | undefined

  constructor(private readonly options: CodexCliEngineOptions = {}) {}

  /** Frames translated into the shared event vocabulary leave through here. */
  setEmitter(emit: (frame: DshEventFrame) => void): void {
    this.onEvent = emit
  }

  ready(): boolean {
    return codexBinPath() !== undefined
  }

  listSessions(): EngineSessionSummary[] {
    return [...this.sessions.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((session) => ({
        sessionId: session.sessionId,
        engineId: CODEX_CLI_ENGINE_ID,
        title: session.title,
        ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        running: session.running,
      }))
  }

  transcript(sessionId: string): EngineSessionTranscript {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Unknown ${CODEX_CLI_ENGINE_ID} session: ${sessionId}`)
    return { sessionId, engineId: CODEX_CLI_ENGINE_ID, events: [...session.transcript] }
  }

  async createSession(input: { cwd?: string; mode?: CodexRunMode } = {}): Promise<{ sessionId: string }> {
    const wire = await this.ensureStarted()
    const sessionId = `codex-${randomUUID()}`
    const threadId = await wire.startThread({
      cwd: input.cwd,
      approvalPolicy: asText(THREAD_POLICY[input.mode ?? 'interactive'].approvalPolicy, 'approval policy'),
      ...('sandbox' in THREAD_POLICY[input.mode ?? 'interactive']
        ? { sandbox: THREAD_POLICY[input.mode ?? 'interactive'].sandbox as string }
        : {}),
    })
    const now = Date.now()
    const session: CodexSession = {
      sessionId,
      threadId,
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      mode: input.mode ?? 'interactive',
      title: 'New Codex chat',
      createdAt: now,
      updatedAt: now,
      running: false,
      sequence: 0,
      transcript: [],
    }
    this.sessions.set(sessionId, session)
    this.sessionsByThread.set(threadId, session)
    this.emitFrame({ kind: 'session-added', sessionId, meta: { engineId: CODEX_CLI_ENGINE_ID } })
    return { sessionId }
  }

  /**
   * Submit one prompt to a codex-backed session (created lazily when no id is
   * given). Progress streams out as frames; the promise settles with the turn.
   */
  async run(prompt: string, options: { sessionId?: string; cwd?: string } = {}): Promise<{ sessionId: string }> {
    const cleaned = prompt.trim()
    if (!cleaned) throw new Error('Prompt cannot be empty')
    if (cleaned.length > 100_000) throw new Error('Prompt exceeds the 100,000 character limit')

    let session = options.sessionId ? this.sessions.get(options.sessionId) : undefined
    if (options.sessionId && !session) throw new Error(`Unknown ${CODEX_CLI_ENGINE_ID} session: ${options.sessionId}`)
    if (!session) session = (await this.createSession({ cwd: options.cwd })).sessionId ? this.sessions.get((await Promise.resolve()) as never) : undefined
    if (!session) throw new Error(`${CODEX_CLI_ENGINE_ID} session could not be created`)
    if (session.running) throw new Error('This Codex chat already has an active turn')
    if (session.turnSettled) throw new Error('This Codex chat is still settling its previous turn')

    const settled = Promise.withResolvers<{ status: string; failureMessage?: string }>()
    session.turnSettled = settled
    try {
      const wire = await this.ensureStarted()
      this.recordUserMessage(session, cleaned)
      if (!session.running) {
        // Title once from the first prompt; later prompts keep it stable.
      }
      if (session.title === 'New Codex chat') session.title = cleaned.slice(0, 80)
      const turnId = await wire.startTurn(session.threadId, [cleaned])
      session.turnId = turnId
      session.running = true
      session.updatedAt = Date.now()
      this.emitFrame({ kind: 'session-status', sessionId: session.sessionId, running: true })
      const terminal = await settled.promise
      session.running = false
      session.turnId = undefined
      session.turnSettled = undefined
      session.updatedAt = Date.now()
      this.emitFrame({ kind: 'session-status', sessionId: session.sessionId, running: false })
      if (terminal.status === 'failed') {
        const message = terminal.failureMessage ?? 'Codex turn failed'
        this.emitFrame({ kind: 'agent-error', sessionId: session.sessionId, message })
        throw new Error(message)
      }
      return { sessionId: session.sessionId }
    } catch (error: unknown) {
      session.running = false
      session.turnId = undefined
      session.turnSettled = undefined
      session.updatedAt = Date.now()
      if (settled.pending) {
        this.emitFrame({ kind: 'session-status', sessionId: session.sessionId, running: false })
        const message = error instanceof Error ? error.message : String(error)
        this.emitFrame({ kind: 'agent-error', sessionId: session.sessionId, message })
      }
      throw error
    }
  }

  /** Interrupt the active turn of one codex-backed session. */
  async stop(sessionId?: string): Promise<void> {
    const targets = sessionId ? [this.sessions.get(sessionId)] : [...this.sessions.values()].filter((item) => item.running)
    for (const session of targets) {
      if (!session?.running || !session.turnId) continue
      this.wire?.interrupt(session.threadId, session.turnId)
    }
  }

  /**
   * Answer a pending interactive approval. The value mirrors the harness
   * contract: `{ outcome: 'allowed-once' | 'rejected' }` (extra fields ignored).
   */
  async respond(rpcId: string, value: unknown): Promise<void> {
    const pending = this.pendingApprovals.get(rpcId)
    if (!pending) throw new Error(`Unknown ${CODEX_CLI_ENGINE_ID} approval: ${rpcId}`)
    this.pendingApprovals.delete(rpcId)
    const outcome = extractOutcome(value)
    pending.resolve({
      decision: pickDecision(pending.availableDecisions, outcome === 'allowed-once'),
    })
    this.emitFrame({ kind: 'approval-resolved', approvalId: rpcId, outcome })
  }

  async close(): Promise<void> {
    this.stopping = true
    for (const [rpcId, pending] of this.pendingApprovals) {
      this.pendingApprovals.delete(rpcId)
      pending.resolve({ decision: 'decline' })
    }
    const child = this.child
    this.wire?.close()
    this.wire = undefined
    this.child = undefined
    for (const session of this.sessions.values()) {
      if (!session.running) continue
      session.running = false
      session.turnId = undefined
      session.turnSettled = undefined
      this.emitFrame({ kind: 'agent-error', sessionId: session.sessionId, message: 'Codex engine stopped before the turn completed.' })
    }
    await killProcessTree(child)
    this.stopping = false
  }

  private async ensureStarted(): Promise<CodexAppServerWire> {
    if (this.wire && this.child) return this.wire
    if (this.startPromise) return this.startPromise.then(() => this.wire as CodexAppServerWire)
    this.startPromise = this.start().finally(() => {
      this.startPromise = undefined
    })
    await this.startPromise
    return this.wire as CodexAppServerWire
  }

  private async start(): Promise<void> {
    const bin = codexBinPath()
    if (!bin) throw new Error('The pinned Codex CLI payload is not installed. Run the product bootstrap to install it.')

    const argv = bin.toLowerCase().endsWith('.js') ? [process.execPath, bin, 'app-server', '--stdio'] : [bin, 'app-server', '--stdio']
    const environment: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('ND_DSH_') || key.startsWith('DSH_')) continue
      environment[key] = value
    }

    const log = this.options.log ?? ((line: string) => console.warn(line))
    const child = spawn(argv[0] as string, argv.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: environment,
      // A process group lets POSIX teardown take the whole tree down; Windows
      // uses taskkill /T instead.
      detached: process.platform !== 'win32',
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => log(`[codex app-server] ${chunk.trimEnd()}`))
    child.once('exit', (code, signal) => {
      const wasExpected = this.stopping || this.child !== child
      this.child = undefined
      this.wire?.close()
      this.wire = undefined
      if (wasExpected) return
      const message = `Codex app-server exited (${signal ?? String(code ?? 'unknown')}).`
      for (const session of this.sessions.values()) {
        if (!session.running) continue
        session.running = false
        session.turnId = undefined
        session.turnSettled?.resolve({ status: 'failed', failureMessage: message })
        session.turnSettled = undefined
      }
      for (const [rpcId, pending] of this.pendingApprovals) {
        this.pendingApprovals.delete(rpcId)
        pending.resolve({ decision: 'decline' })
      }
    })

    const wire = new CodexAppServerWire(child.stdout as NonNullable<typeof child.stdout>, child.stdin as NonNullable<typeof child.stdin>, {
      onNotification: (method, params) => this.handleNotification(method, params),
      onServerRequest: (method, params) => this.handleServerRequest(method, params),
      onProtocolError: (error) => this.handleProtocolError(error),
    })
    wire.start()
    this.wire = wire
  }

  private handleNotification(method: string, params: JsonObject): void {
    const threadId = typeof params.threadId === 'string' ? params.threadId : undefined
    const session = threadId ? this.sessionsByThread.get(threadId) : undefined
    if (!session) return

    if (method === 'turn/started') return

    if (method === 'item/started' || method === 'item/completed') {
      const item = isObject(params.item) ? params.item : undefined
      if (item) this.handleItem(session, method === 'item/started', item)
      return
    }

    if (method === 'turn/completed') {
      const turn = isObject(params.turn) ? params.turn : undefined
      const status = typeof turn?.status === 'string' ? turn.status : 'failed'
      const failure = isObject(turn?.error) ? turn.error : isObject(params.error) ? params.error : undefined
      const failureMessage = failure && typeof failure.message === 'string' ? failure.message : undefined
      if (session.turnSettled && (!session.turnId || turn?.id === undefined || turn.id === session.turnId)) {
        session.turnSettled.resolve({ status, failureMessage })
      }
    }
  }

  private handleItem(session: CodexSession, started: boolean, item: JsonObject): void {
    const type = item.type
    if (type === 'agentMessage') {
      if (started) return
      if (item.phase === 'commentary') return
      const text = typeof item.text === 'string' ? item.text : ''
      if (!text.trim()) return
      this.recordAssistantMessage(session, text)
      return
    }
    if (type === 'reasoning' || type === 'todoList') return

    if (type === 'commandExecution') {
      const callId = typeof item.id === 'string' ? item.id : `${session.sequence + 1}`
      const command = typeof item.command === 'string' ? item.command : 'command'
      if (started) {
        this.recordToolCall(session, callId, 'command execution', { command, ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}) })
        return
      }
      this.recordToolResult(session, callId, describeCommandResult(item))
      return
    }
    if (type === 'fileChange') {
      const callId = typeof item.id === 'string' ? item.id : `${session.sequence + 1}`
      if (started) {
        this.recordToolCall(session, callId, 'file change', { files: item.files ?? item.changes ?? {} })
        return
      }
      this.recordToolResult(session, callId, describeFileChangeResult(item))
      return
    }
    if (type === 'mcpToolCall' || type === 'webSearch' || type === 'tool') {
      const callId = typeof item.id === 'string' ? item.id : `${session.sequence + 1}`
      const name = typeof item.tool === 'string' ? item.tool : type
      if (started) {
        this.recordToolCall(session, callId, name, { arguments: item.arguments ?? item.input ?? null })
        return
      }
      const output = item.result ?? item.output
      this.recordToolResult(session, callId, summarize(output))
      return
    }
    if (type === 'error' && !started) {
      const message = typeof item.message === 'string' ? item.message : 'Codex reported an execution error.'
      this.emitFrame({ kind: 'stream-error', sessionId: session.sessionId, message })
    }
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        return this.requestHumanApproval(method, params)
      case 'item/permissions/requestApproval':
        // ND never grants arbitrary turn permissions; fail closed like unattended runs.
        this.options.log?.('[codex app-server] permission grant denied by ND policy')
        return Promise.resolve({ permissions: {}, scope: 'turn' })
      case 'item/tool/requestUserInput':
        // Interactive question cards for Codex are future work; answer empty.
        return Promise.resolve({ answers: {} })
      case 'mcpServer/elicitation/request':
        return Promise.resolve({ action: 'decline', content: null, _meta: null })
      default:
        return Promise.reject(new Error(`Unsupported Codex app-server request: ${method}`))
    }
  }

  private requestHumanApproval(method: string, params: JsonObject): Promise<JsonObject> {
    const threadId = typeof params.threadId === 'string' ? params.threadId : ''
    const session = this.sessionsByThread.get(threadId)
    if (!session) return Promise.resolve({ decision: 'decline' })

    const rpcId = `codex:${randomUUID()}`
    const toolName = method === 'item/commandExecution/requestApproval' ? 'Command execution' : 'File change'
    const reason = typeof params.reason === 'string'
      ? params.reason
      : method === 'item/commandExecution/requestApproval'
        ? firstLine(typeof params.command === 'string' ? params.command : '')
        : 'Codex wants to modify files in the workspace'
    return new Promise<JsonObject>((resolve) => {
      this.pendingApprovals.set(rpcId, { resolve, availableDecisions: params.availableDecisions })
      this.emitFrame({
        kind: 'approval-requested',
        sessionId: session.sessionId,
        approvalId: rpcId,
        toolName,
        ...(reason ? { reason } : {}),
        rpcId,
      })
    })
  }

  private handleProtocolError(error: Error): void {
    this.options.log?.(`[codex app-server] protocol error: ${error.message}`)
    for (const session of this.sessions.values()) {
      if (!session.running) continue
      session.running = false
      session.turnId = undefined
      session.turnSettled?.resolve({ status: 'failed', failureMessage: error.message })
      session.turnSettled = undefined
      this.emitFrame({ kind: 'session-status', sessionId: session.sessionId, running: false })
    }
    this.child = undefined
    this.wire = undefined
  }

  private recordUserMessage(session: CodexSession, text: string): void {
    this.recordEnvelope(session, {
      type: 'user/message',
      data: { message: { role: 'user', content: [{ type: 'text', text }] } },
    })
  }

  private recordAssistantMessage(session: CodexSession, text: string): void {
    this.recordEnvelope(session, {
      type: 'assistant/message',
      data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
    })
  }

  private recordToolCall(session: CodexSession, callId: string, name: string, args: unknown): void {
    this.recordEnvelope(session, { type: 'tool/call', data: { callId, name, arguments: args } })
  }

  private recordToolResult(session: CodexSession, callId: string, result: string): void {
    this.recordEnvelope(session, { type: 'tool/result', data: { callId, message: { content: [{ type: 'text', text: result }] } } })
  }

  private recordEnvelope(session: CodexSession, partial: { type: string; data?: unknown }): void {
    session.sequence += 1
    const envelope: SessionEventEnvelope = {
      type: partial.type,
      seq: session.sequence,
      time: Date.now(),
      ...(partial.data === undefined ? {} : { data: partial.data }),
    }
    if (TRANSCRIPT_EVENT_TYPES.has(envelope.type)) {
      session.transcript.push(envelope)
      if (session.transcript.length > 500) session.transcript.splice(0, session.transcript.length - 500)
    }
    this.emitFrame({ kind: 'session-event', sessionId: session.sessionId, event: envelope })
  }

  private emitFrame(frame: DshEventFrame): void {
    this.onEvent?.(frame)
  }
}

function extractOutcome(value: unknown): 'allowed-once' | 'rejected' {
  if (isObject(value)) {
    const outcome = value.outcome
    if (outcome === 'allowed-once' || outcome === 'allow' || outcome === true) return 'allowed-once'
  }
  return 'rejected'
}

function describeCommandResult(item: JsonObject): string {
  const status = typeof item.status === 'string' ? item.status : 'completed'
  const exitCode = typeof item.exitCode === 'number' ? ` (exit code ${item.exitCode})` : ''
  const output = isObject(item.aggregatedOutput) && typeof item.aggregatedOutput.text === 'string'
    ? item.aggregatedOutput.text
    : typeof item.aggregatedOutput === 'string'
      ? item.aggregatedOutput
      : ''
  const snippet = output.trim() ? `\n${summarize(output)}` : ''
  return `${status}${exitCode}${snippet}`
}

function describeFileChangeResult(item: JsonObject): string {
  const status = typeof item.status === 'string' ? item.status : 'completed'
  return `file change ${status}`
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? ''
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function summarize(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  const cleaned = (text ?? '').trim()
  if (cleaned.length <= RESULT_SNIPPET_MAX_CHARS) return cleaned
  return `${cleaned.slice(0, RESULT_SNIPPET_MAX_CHARS - 1)}…`
}

/** Terminate the whole child tree; SIGTERM first, then hard teardown. */
async function killProcessTree(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const pid = child.pid as number
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
        } else {
          try { process.kill(-pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      } catch {
        // Already gone.
      }
      resolve()
    }, 3_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    try {
      child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
    } catch {
      clearTimeout(timer)
      resolve()
    }
  })
}
