import type { DshEventFrame, GatewayRpcResult } from '../../shared/contracts.js'
import type { FollowHandle, SessionStreamFrame } from '../dsh/gateway-client.js'

/**
 * The minimal remote-capable surface the hub needs from GatewayClient
 * (structural, so tests can stub the transport).
 */
export interface FollowSource {
  /** Whether the runtime serves the SRC remote face (slash endpoints + stream mux). */
  readonly remote: boolean
  followSession(sessionId: string, onFrame: (frame: SessionStreamFrame) => void): FollowHandle
}

interface HistoryEnvelope {
  type: string
  seq: number
  time?: number
  data?: unknown
}

/** Journal window served to the renderer; bounded to keep long sessions cheap. */
// Long tool-driven turns can legitimately exceed 400 envelopes. Keep a larger
// bounded window so restoring a chat retains its opening prompt and context
// while still preventing an unbounded in-memory journal.
const JOURNAL_LIMIT = 2_000
/** How long a fresh follow may wait for its opening snapshot. */
const SNAPSHOT_TIMEOUT_MS = 15_000

/**
 * Per-session live event journal backed by the runtime's `session/follow`
 * streams.
 *
 * The 0.1.2 runtime line removed `session.history` and the legacy event
 * downlinks; `session/follow` is its only content face. The hub keeps one
 * follow open per interesting session, folds every frame into a bounded
 * journal, re-emits live appends as `session-event` frames (so the
 * orchestrator and renderer see the exact vocabulary the legacy sockets
 * delivered), and serves the renderer's history reads from that journal in
 * the old `{ events: [{ event }] }` wire shape — callers above the hub never
 * learn the runtime changed.
 *
 * Snapshot frames adopt the session's current log silently (no emission):
 * content that predates the subscription reaches the renderer through the
 * history read, and only appends after it stream live. Sequence baselines
 * keep socket reconnects (which replay a fresh snapshot) from duplicating
 * journal entries or frames.
 */
export class SessionEventHub {
  private source: FollowSource | undefined
  private readonly handles = new Map<string, FollowHandle>()
  private readonly journal = new Map<string, HistoryEnvelope[]>()
  private readonly baselines = new Map<string, number>()

  constructor(private readonly emit: (frame: DshEventFrame) => void) {}

  /** Whether the hub can serve reads (attached to a remote-face runtime). */
  get active(): boolean {
    return this.source?.remote === true
  }

  /** Bind to a gateway; any previous binding's streams are torn down. */
  attach(source: FollowSource): void {
    this.detach()
    this.source = source
  }

  /** Close every follow stream and drop the journals. */
  detach(): void {
    for (const handle of this.handles.values()) handle.close()
    this.handles.clear()
    this.journal.clear()
    this.baselines.clear()
    this.source = undefined
  }

  /**
   * Adopt a session's live journal before its next prompt, so the turn's
   * events arrive as live appends instead of being swallowed by a later
   * snapshot's silent baseline adoption. Resolves once the opening snapshot
   * has landed; failures are the caller's to tolerate.
   */
  async ensure(sessionId: string): Promise<void> {
    if (!this.active || this.handles.has(sessionId)) return
    await this.open(sessionId)
  }

  /**
   * Serve one history read from the session's live journal, in the legacy
   * `session.history` value shape.
   */
  async read(sessionId: string, maxMessages = 50): Promise<GatewayRpcResult> {
    const envelopes = await this.open(sessionId)
    return {
      ok: true,
      value: { events: envelopes.slice(-maxMessages).map((event) => ({ event })) },
    }
  }

  /** Open (or join) the session's follow stream and wait for its snapshot. */
  private async open(sessionId: string): Promise<HistoryEnvelope[]> {
    const existing = this.handles.get(sessionId)
    if (existing) {
      await existing.ready
      return this.journal.get(sessionId) ?? []
    }
    const source = this.source
    if (!source) throw new Error('Session event hub is not attached to a runtime')
    const handle = source.followSession(sessionId, (frame) => this.ingest(sessionId, frame))
    this.handles.set(sessionId, handle)
    try {
      await withTimeout(handle.ready, SNAPSHOT_TIMEOUT_MS, 'Session event stream did not open in time')
    } catch (cause) {
      // A failed stream keeps no handle: a later read retries cleanly.
      if (this.handles.get(sessionId) === handle) this.handles.delete(sessionId)
      handle.close()
      throw cause
    }
    return this.journal.get(sessionId) ?? []
  }

  private ingest(sessionId: string, frame: SessionStreamFrame): void {
    if (frame.type === 'error' || frame.type === 'end') {
      // The stream is terminal (session removed, runtime shut down): drop the
      // handle but keep the journal so already-loaded threads still read.
      const handle = this.handles.get(sessionId)
      if (handle) {
        handle.close()
        this.handles.delete(sessionId)
      }
      return
    }
    const journal = this.journal.get(sessionId) ?? []
    let baseline = this.baselines.get(sessionId) ?? 0
    // Snapshot records wrap their event ({ type: 'event'|'chunks', event });
    // live frames carry the envelope directly.
    const events = frame.type === 'snapshot'
      ? (frame.records ?? []).map(asEnvelope)
      : [frame.event]
    for (const event of events) {
      if (!event || event.seq <= baseline) continue
      baseline = event.seq
      journal.push({
        type: event.type,
        seq: event.seq,
        ...(event.time === undefined ? {} : { time: event.time }),
        ...(event.data === undefined ? {} : { data: event.data }),
      })
      if (frame.type === 'event') {
        this.emit({
          kind: 'session-event',
          sessionId,
          event: {
            type: event.type,
            seq: event.seq,
            time: event.time ?? Date.now(),
            ...(event.data === undefined ? {} : { data: event.data }),
          },
        })
      }
    }
    if (frame.type === 'snapshot' && typeof frame.cursor === 'number') baseline = Math.max(baseline, frame.cursor)
    this.baselines.set(sessionId, baseline)
    if (journal.length > JOURNAL_LIMIT) journal.splice(0, journal.length - JOURNAL_LIMIT)
    this.journal.set(sessionId, journal)
  }
}

function asEnvelope(value: unknown): { type: string; seq: number; time?: number; data?: unknown } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const event = (value as { event?: unknown }).event
  if (!event || typeof event !== 'object') return undefined
  const envelope = event as Record<string, unknown>
  if (typeof envelope.type !== 'string' || typeof envelope.seq !== 'number') return undefined
  return {
    type: envelope.type,
    seq: envelope.seq,
    ...(typeof envelope.time === 'number' ? { time: envelope.time } : {}),
    ...(envelope.data === undefined ? {} : { data: envelope.data }),
  }
}

function withTimeout(promise: Promise<void>, timeoutMs: number, message: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (cause: unknown) => {
        clearTimeout(timer)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      },
    )
  })
}
