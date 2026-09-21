export const ND_CORE_PROTOCOL_VERSION = 1
export const ND_CORE_MAX_FRAME_BYTES = 8 * 1024 * 1024

/**
 * How much sooner nd-core must stop than the client gives up. The core has to lose
 * the race: if the client's timer fired first the caller would see an untagged
 * timeout while the work carried on in Rust, which is exactly the behaviour core
 * deadlines exist to remove.
 */
export const ND_CORE_DEADLINE_MARGIN_MS = 250
/** Shortest deadline nd-core accepts. Mirrors `MIN_DEADLINE_MS` in the sidecar. */
export const ND_CORE_MIN_DEADLINE_MS = 50
/** Longest deadline nd-core accepts. Mirrors `MAX_DEADLINE_MS` in the sidecar. */
export const ND_CORE_MAX_DEADLINE_MS = 30 * 60 * 1000

/** Error codes nd-core may return in a response frame. */
export const ND_CORE_ERROR_CODES = {
  methodFailed: 'method_failed',
  deadlineExceeded: 'deadline_exceeded',
  canceled: 'canceled',
  invalidParams: 'invalid_params',
  runtimeBusy: 'runtime_busy',
  notFound: 'not_found',
} as const

/**
 * Raised by the client itself when its own tolerance expires. The core deadline is
 * always sent shorter than the client's patience, so reaching this means the sidecar
 * stopped answering — not that the work was slow.
 */
export const ND_CORE_CLIENT_TIMEOUT_CODE = 'client_timeout'

export type NdCoreErrorCode = (typeof ND_CORE_ERROR_CODES)[keyof typeof ND_CORE_ERROR_CODES]

export interface NdCoreHealth {
  protocolVersion: number
  binaryVersion: string
  platform: string
  arch: string
  capabilities: string[]
  processCount: number
  terminalCount: number
  workspaceCount: number
}

/**
 * A failure reported by nd-core, carrying the code the sidecar decided on.
 *
 * Callers branch on `code` rather than matching message text, so a message can be
 * reworded without changing control flow.
 */
export class NdCoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'NdCoreError'
    this.code = code
  }
}

export function isNdCoreError(value: unknown, code?: NdCoreErrorCode): value is NdCoreError {
  return value instanceof NdCoreError && (code === undefined || value.code === code)
}

/**
 * Whether a request was stopped by its own deadline rather than failing. A caller
 * that wants to retry, degrade, or report a timeout branches on this instead of
 * parsing a message.
 */
export function isNdCoreDeadlineError(value: unknown): value is NdCoreError {
  return isNdCoreError(value, ND_CORE_ERROR_CODES.deadlineExceeded)
}

/** Whether a request was stopped because the caller canceled it. */
export function isNdCoreCanceledError(value: unknown): value is NdCoreError {
  return isNdCoreError(value, ND_CORE_ERROR_CODES.canceled)
}

export interface NdCoreErrorFrame {
  code: string
  message: string
}

export interface NdCoreEventFrame<T = unknown> {
  version: number
  kind: 'event'
  event: string
  resourceId?: string
  seq?: number
  priority: string
  data: T
}

export interface NdCoreResponseFrame<T = unknown> {
  version: number
  kind: 'response'
  id: string
  result?: T
  error?: NdCoreErrorFrame
}

/**
 * The deadline to send for a request: an explicit one is passed through for the
 * sidecar to validate against its own bounds, and otherwise the client's own
 * tolerance is used minus the margin that keeps the core ahead of it. A tolerance
 * too short to carry a deadline sends none, and the client timer remains the only
 * bound — which is correct for the sub-second control calls that use it.
 */
export function resolveCoreDeadlineMs(timeoutMs: number, explicit?: number): number | undefined {
  if (explicit !== undefined) return Math.floor(explicit)
  const derived = Math.floor(timeoutMs) - ND_CORE_DEADLINE_MARGIN_MS
  return derived >= ND_CORE_MIN_DEADLINE_MS ? derived : undefined
}

export interface NdCoreRequestFrame {
  version: number
  kind: 'request'
  id: string
  method: string
  deadlineMs?: number
  params: unknown
}

/**
 * The request frame as it goes on the wire. Kept separate from the transport so the
 * shape — including whether a deadline was attached — is testable without a running
 * sidecar.
 */
export function buildCoreRequestFrame(input: {
  id: string
  method: string
  params: unknown
  /** Usually the result of {@link resolveCoreDeadlineMs}; `undefined` sends none. */
  deadlineMs?: number | undefined
}): NdCoreRequestFrame {
  return {
    version: ND_CORE_PROTOCOL_VERSION,
    kind: 'request',
    id: input.id,
    method: input.method,
    ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
    params: input.params,
  }
}
