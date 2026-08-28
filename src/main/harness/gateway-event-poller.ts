import type { DshEventFrame, GatewayRpcResult } from '../../shared/contracts.js'

/** Fast cadence while any known session has a turn in flight. */
const RUNNING_POLL_MS = 700
/** Idle cadence: still catches session add/remove and title-level changes. */
const IDLE_POLL_MS = 2_500
/** How long after the last observed running flag (or prompt) a session keeps being polled. */
const RECENT_WINDOW_MS = 20_000

interface PollerSessionListItem {
  sessionId?: unknown
  running?: unknown
}

/**
 * Event transport for the desktop gateway.
 *
 * The pinned runtime's `web` profile never registers its WebSocket event
 * downlinks (`/api/events.mux` + `/api/events.host`): upgrade requests are
 * destroyed on both pinned releases, stock and patched, while unary RPCs work
 * (verified by direct wire probes). Its SSE face is shadowed by an
 * "upgrade required" guard on the same paths. Rather than patch the vendored
 * core, this poller synthesizes the exact DshEventFrame vocabulary the
 * renderer already folds — session add/remove, running flips, and per-session
 * event deltas read from `session.history` with per-session sequence
 * baselines, so replays never duplicate thread entries.
 *
 * Baselines are adopted silently at a session's first sight, so every later
 * history change — however the turn was started — emits as a delta. Ticks are
 * serialized, never dropped: a tick requested mid-poll runs after it.
 */
export class GatewayEventPoller {
  private timer: ReturnType<typeof setInterval> | undefined
  private currentInterval = IDLE_POLL_MS
  /** Tail of the serialized tick chain; keeps every requested tick. */
  private tickChain: Promise<void> = Promise.resolve()
  private primed = false
  /** Highest event seq already delivered (or adopted) per session. */
  private readonly baselines = new Map<string, number>()
  /** Last observed running flag per session; drives session-status frames. */
  private readonly runningFlags = new Map<string, boolean>()
  /** Session → timestamp until which it stays on the history-delta fast path. */
  private readonly recentUntil = new Map<string, number>()
  /**
   * Prompted sessions whose turn has not been observed running yet. A queued
   * turn spins up asynchronously, so polls right after a prompt still see
   * running=false; that false must never be emitted as a completion signal
   * (the orchestrator fails runs on it). Until the first running=true is
   * observed (or the recent window expires), running=false is suppressed.
   */
  private readonly awaitingStart = new Set<string>()

  constructor(
    private readonly rpc: (method: string, payload?: unknown) => Promise<GatewayRpcResult>,
    private readonly emit: (frame: DshEventFrame) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.requestTick(), this.currentInterval)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.baselines.clear()
    this.runningFlags.clear()
    this.recentUntil.clear()
    this.awaitingStart.clear()
    this.primed = false
  }

  /**
   * Adopt a session's history baseline before its first prompt, so no turn
   * event can land between "prompt sent" and "first poll" and be silently
   * skipped by baseline adoption.
   */
  async ensureBaseline(sessionId: string): Promise<void> {
    if (this.baselines.has(sessionId)) return
    await this.adoptBaseline(sessionId)
  }

  /** Put a freshly prompted session on the fast path and poll immediately. */
  notePromptSent(sessionId: string): void {
    this.recentUntil.set(sessionId, this.now() + RECENT_WINDOW_MS)
    this.awaitingStart.add(sessionId)
    void this.requestTick()
  }

  /** Queue one poll pass behind the in-flight one; nothing is dropped. */
  requestTick(): Promise<void> {
    const next = this.tickChain.then(() => this.tick())
    // Keep the chain alive even when a tick fails internally.
    this.tickChain = next.catch(() => undefined)
    return next
  }

  /** One poll pass; awaits via requestTick() so tests stay deterministic. */
  private async tick(): Promise<void> {
    try {
      const list = await this.rpc('session.list')
      const items = ((list.value ?? {}) as { items?: PollerSessionListItem[] }).items ?? []
      const seen = new Set<string>()
      let anyRunning = false
      for (const item of items) {
        const sessionId = item?.sessionId
        if (typeof sessionId !== 'string') continue
        seen.add(sessionId)
        const running = item.running === true
        if (running) {
          anyRunning = true
          this.recentUntil.set(sessionId, this.now() + RECENT_WINDOW_MS)
          this.awaitingStart.delete(sessionId)
        }
        const previous = this.runningFlags.get(sessionId)
        if (previous === undefined) {
          // First sight: adopt history silently so later deltas start here.
          // After startup priming the session is announced; a first-sight
          // running=true is announced too. A first-sight running=false is
          // emitted only for sessions nobody prompted — for a prompted
          // session that false is the pre-turn state, not a completion.
          await this.adoptBaseline(sessionId)
          if (this.primed) {
            this.emit({ kind: 'session-added', sessionId, meta: {} })
            if (running || !this.awaitingStart.has(sessionId)) {
              this.emit({ kind: 'session-status', sessionId, running })
            }
          }
        } else if (previous !== running) {
          if (running || !this.awaitingStart.has(sessionId)) {
            this.emit({ kind: 'session-status', sessionId, running })
          }
        }
        this.runningFlags.set(sessionId, running)
      }
      for (const sessionId of [...this.runningFlags.keys()]) {
        if (!seen.has(sessionId)) {
          this.emit({ kind: 'session-removed', sessionId })
          this.runningFlags.delete(sessionId)
          this.baselines.delete(sessionId)
          this.recentUntil.delete(sessionId)
          this.awaitingStart.delete(sessionId)
        }
      }
      this.primed = true

      for (const [sessionId, until] of this.recentUntil) {
        if (this.now() >= until) {
          this.recentUntil.delete(sessionId)
          // The recent window closed without ever observing the turn running:
          // it started and finished between two polls. Its history deltas
          // already carried the content; emit the completion flip now so the
          // orchestrator finalizes the run instead of waiting forever.
          if (this.awaitingStart.delete(sessionId) && this.runningFlags.get(sessionId) === false) {
            this.emit({ kind: 'session-status', sessionId, running: false })
          }
          continue
        }
        await this.emitHistoryDelta(sessionId)
      }
      this.reschedule(anyRunning)
    } catch {
      // A failed tick (gateway restarting, transient transport error) costs
      // nothing; the next tick retries and recovery replaces the gateway.
      this.reschedule(false)
    }
  }

  /** Read one session's history and emit only events past the baseline. */
  private async emitHistoryDelta(sessionId: string): Promise<void> {
    const baseline = this.baselines.get(sessionId) ?? 0
    const history = await this.rpc('session.history', { sessionId, maxMessages: 50 })
    const envelopes = ((history.value ?? {}) as { events?: Array<{ event?: { type?: unknown; seq?: unknown; time?: unknown; data?: unknown } }> }).events ?? []
    const ordered = envelopes
      .map((wrapper) => wrapper?.event)
      .filter((event): event is { type: string; seq: number; time?: number; data?: unknown } =>
        Boolean(event) && typeof event!.type === 'string' && typeof event!.seq === 'number')
      .sort((first, second) => first.seq - second.seq)
    let highest = baseline
    for (const event of ordered) {
      highest = Math.max(highest, event.seq)
      if (event.seq <= baseline) continue
      this.emit({
        kind: 'session-event',
        sessionId,
        event: {
          type: event.type,
          seq: event.seq,
          time: typeof event.time === 'number' ? event.time : Date.now(),
          ...(event.data !== undefined ? { data: event.data } : {}),
        },
      })
    }
    this.baselines.set(sessionId, highest)
  }

  /** Baseline a session's current history without emitting anything. */
  private async adoptBaseline(sessionId: string): Promise<void> {
    try {
      const history = await this.rpc('session.history', { sessionId, maxMessages: 50 })
      const envelopes = ((history.value ?? {}) as { events?: Array<{ event?: { seq?: unknown } }> }).events ?? []
      let highest = 0
      for (const wrapper of envelopes) {
        const seq = wrapper?.event?.seq
        if (typeof seq === 'number') highest = Math.max(highest, seq)
      }
      this.baselines.set(sessionId, highest)
    } catch {
      // Leave unadopted; the next tick retries adoption.
    }
  }

  /** Keep one interval; only reset the timer when the cadence actually changes. */
  private reschedule(anyRunning: boolean): void {
    const next = anyRunning || this.recentUntil.size > 0 ? RUNNING_POLL_MS : IDLE_POLL_MS
    if (next === this.currentInterval && this.timer) return
    this.currentInterval = next
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => void this.requestTick(), next)
  }
}
