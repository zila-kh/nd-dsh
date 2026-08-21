import type {
  DshEventFrame,
  GatewayRpcResult,
  HarnessRunResult,
  SessionEventEnvelope,
  SessionModels,
  SessionSummary,
} from '../../../shared/contracts'

/**
 * In-memory session runtime behind the web mocks so the ChatPanel behaves like
 * the desktop app without a sidecar: session list/history/create, model
 * pickers, and a believable streaming assistant event stream on run.
 */
export class MockSessionRuntime {
  private sessions = new Map<string, WebChatSession>()
  private seq = 0
  private listeners = new Set<(frame: DshEventFrame) => void>()
  private permissionMode = 'workspace-write'
  private currentModel = { provider: 'deepseek', model: 'deepseek-v4-flash' }

  constructor() {
    const seeded = this.createSessionValue('Seed the "AI Company OS" dashboard from the Company tab overview.', 'Demo thread')
    this.sessions.set(seeded.id, seeded)
  }

  onFrame(listener: (frame: DshEventFrame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async rpc(method: string, payload: unknown = {}): Promise<GatewayRpcResult> {
    const record = (payload ?? {}) as Record<string, unknown>
    switch (method) {
      case 'session.list':
        return { ok: true, value: { items: this.list() } }
      case 'session.create': {
        const id = record.sessionId ?? crypto.randomUUID()
        const session = this.createSessionValue('', 'New Chat Thread')
        this.sessions.set(session.id, session)
        this.emitFrame({ kind: 'session-added', sessionId: session.id })
        return { ok: true, value: { sessionId: session.id } }
      }
      case 'session.history': {
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
        const session = this.sessions.get(sessionId)
        return { ok: true, value: { events: (session?.events ?? []).map((event) => ({ event })) } }
      }
      case 'session.models': {
        return { ok: true, value: this.models() }
      }
      case 'session.selectModel': {
        if (typeof record.provider === 'string') this.currentModel.provider = record.provider
        if (typeof record.model === 'string') this.currentModel.model = record.model
        this.currentModel = { provider: this.currentModel.provider, model: this.currentModel.model }
        return { ok: true, value: { provider: this.currentModel.provider, model: this.currentModel.model } }
      }
      case 'session.prompt': {
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
        const content = Array.isArray(record.content) ? record.content : []
        const text = content.map((block) => (block as { text?: unknown })?.text).filter((text): text is string => typeof text === 'string').join('\n')
        if (text) {
          const result = await this.run(text, sessionId ? { sessionId } : undefined)
          return { ok: true, value: { sessionId: result.sessionId } }
        }
        return { ok: false, error: { code: 'missing-prompt', message: 'No text content in prompt' } }
      }
      case 'session.cancel': {
        return { ok: true, value: {} }
      }
      case 'agentPreset.list': {
        return { ok: true, value: { presets: WEB_PRESETS } }
      }
      case 'settings.update': {
        return { ok: true, value: {} }
      }
      default:
        return { ok: false, error: { code: 'unknown-method', message: `Mock runtime has no handler for ${method}` } }
    }
  }

  async run(prompt: string, options?: { sessionId?: string }): Promise<HarnessRunResult> {
    const id = options?.sessionId?.trim() || crypto.randomUUID()
    let session = this.sessions.get(id)
    if (!session) {
      session = this.createSessionValue('', 'New Chat Thread')
      this.sessions.set(id, session)
      this.emitFrame({ kind: 'session-added', sessionId: id })
    }
    session.blank = false
    session.updatedAt = Date.now()
    session.events.push(this.envelope('user/message', { message: { role: 'user', content: prompt } }))
    this.emitFrame({ kind: 'session-status', sessionId: id, running: true })

    const reply = mockReply(prompt)
    const parts = splitForStreaming(reply)
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? ''
      session.events.push(this.envelope('assistant/chunk', { chunk: { role: 'assistant', content: part } }))
      this.emitFrame({ kind: 'session-event', sessionId: id, event: lastEvent(session) })
      await delay(160)
    }
    session.events.push(this.envelope('assistant/message', { message: { role: 'assistant', content: reply } }))
    this.emitFrame({ kind: 'session-event', sessionId: id, event: lastEvent(session) })

    session.title = titleFor(prompt) ?? 'New Chat Thread'
    session.events.push(this.envelope('session/title', { title: session.title }))
    this.emitFrame({ kind: 'session-event', sessionId: id, event: lastEvent(session) })

    session.updatedAt = Date.now()
    this.emitFrame({ kind: 'session-status', sessionId: id, running: false })
    return { sessionId: id, messageId: crypto.randomUUID() }
  }

  async stop(): Promise<void> {
    // Cancellation is best-effort in the mock; the stream always completes.
  }

  /** Records pending rpcIds so respond() can translate them; approvals stay resolved client-side. */
  private pendingResponses = new Set<string>()

  getPermissionMode(): string {
    return this.permissionMode
  }

  setPermissionMode(mode: string): string {
    this.permissionMode = mode
    return mode
  }

  async respond(rpcId: string, _value: unknown): Promise<void> {
    this.pendingResponses.add(rpcId)
  }

  private list(): SessionSummary[] {
    return [...this.sessions.values()]
      .map((session) => ({
        sessionId: session.id,
        updatedAt: session.updatedAt,
        running: false,
        blank: session.blank,
        ...(session.title ? { projections: { asOfSeq: session.events.length, values: { title: session.title } } } : {}),
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  private models(): SessionModels {
    return {
      current: { ...this.currentModel },
      routable: true,
      groups: MOCK_MODEL_GROUPS,
      failures: [],
    }
  }

  private createSessionValue(title: string, fallbackTitle: string): WebChatSession {
    const id = crypto.randomUUID()
    return {
      id,
      title: title.trim() || fallbackTitle,
      blank: true,
      events: [
        this.envelope('session/title', { title: title.trim() || fallbackTitle }),
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  private envelope(type: SessionEventEnvelope['type'], data: unknown): SessionEventEnvelope {
    this.seq += 1
    return { type, seq: this.seq, time: Date.now(), data }
  }

  private emitFrame(frame: DshEventFrame): void {
    for (const listener of this.listeners) listener(frame)
  }
}

interface WebChatSession {
  id: string
  title: string
  blank: boolean
  events: SessionEventEnvelope[]
  createdAt: number
  updatedAt: number
}

const MOCK_MODEL_GROUPS: SessionModels['groups'] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      {
        id: 'deepseek-reasoner-v4',
        name: 'DeepSeek Reasoner V4',
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
          ],
          defaultEffort: 'medium',
        },
      },
    ],
  },
  {
    id: 'pi-ai',
    name: 'Pi AI',
    models: [{ id: 'pi-ai-3.5', name: 'Pi AI 3.5' }],
  },
]

const WEB_PRESETS: Array<{ id: string; name: string; description?: string; trust?: string }> = [
  { id: 'cordis', name: 'Creator', description: 'Create and edit custom agent presets.', trust: 'system' },
  { id: 'code', name: 'Code', description: 'Plan-then-code workflow (PTC).', trust: 'system' },
  { id: 'minimal', name: 'Minimal', description: 'A single focused agent.', trust: 'system' },
]

function mockReply(prompt: string): string {
  const summary = summarize([...setOf(prompt)])
  return [
    `I read the workspace in the context of “${clamp(prompt, 80)}”.`,
    summary,
    'You can iterate on this in the Company tab, or ask me to open the built-in browser and work through it live.',
  ].join('\n\n')
}

function splitForStreaming(text: string): string[] {
  const words = text.split(/(?<=\s)/)
  const parts: string[] = []
  let buffer = ''
  for (const word of words) {
    buffer += word
    if (buffer.length >= 56) {
      parts.push(buffer)
      buffer = ''
    }
  }
  if (buffer) parts.push(buffer)
  return parts.length > 0 ? parts : [text]
}

function summarize(set: string[]): string {
  const topics = set.slice(0, 3).join(', ')
  const tail = set.length > 3 ? `, and ${set.length - 3} more topics` : ''
  return `The key threads I would pull on cover ${topics || 'the objective at hand'}${tail}.`
}

function setOf(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{3,})\b/g)) {
    const word = match[1]?.toLowerCase()
    if (word) seen.add(word)
    if (seen.size >= 6) break
  }
  return [...seen]
}

function titleFor(prompt: string): string | undefined {
  const words = prompt.trim().split(/\s+/).filter(Boolean)
  const slice = words.slice(0, 6).join(' ')
  return slice.length > 0 ? `${slice.slice(0, 60)}${words.length > 6 ? '…' : ''}` : undefined
}

function clamp(text: string, length: number): string {
  const trimmed = text.trim()
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function lastEvent(session: WebChatSession): SessionEventEnvelope {
  return session.events[session.events.length - 1]!
}
