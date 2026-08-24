import { CODEX_CLI_ENGINE_ID, CODEX_ENGINE_ID, ND_HARNESS_ENGINE_ID } from './coding-engines.js'

/**
 * Pluggable capability layers. Every kind ships an ND built-in today and may
 * additionally be served by third-party adapters; organization subjects
 * (agents, roles, teams) pick one provider per kind.
 *
 * - engine: which coding runtime executes the work (ND Harness, Codex CLI…).
 * - memory: where durable organizational recall comes from at prompt time.
 * - context: how workspace/repo understanding is gathered before a run.
 */
export type CapabilityKind = 'engine' | 'memory' | 'context'

/** Who a capability assignment can be attached to. Agent wins over role over team. */
export type CapabilitySubjectType = 'agent' | 'role' | 'team'

export interface CapabilityDescriptor {
  id: string
  kind: CapabilityKind
  name: string
  /** builtin = shipped and owned by ND; adapter = external product integration. */
  integration: 'builtin' | 'adapter'
  available: boolean
  description: string
  unavailableReason?: string
  /**
   * Present only when ND ships a trusted main-process installer for this
   * provider. The renderer receives display metadata, never commands or an
   * arbitrary download URL supplied at runtime.
   */
  setup?: CapabilitySetupDescriptor
}

export interface CapabilitySetupField {
  id: string
  label: string
  description?: string
  required: boolean
  sensitive?: boolean
  placeholder?: string
}

interface CapabilitySetupDescriptorBase {
  sourceLabel: string
  sourceUrl: string
  /** Exact approved version; floating tags such as "latest" are rejected. */
  version: string
  prerequisites: string[]
  fields: CapabilitySetupField[]
}

/** A reviewed external package whose source and digest are fixed by ND. */
export interface CapabilityPackageSetupDescriptor extends CapabilitySetupDescriptorBase {
  mode?: 'approved-package'
  packageId: string
  /** Integrity recorded in ND's reviewed provider catalog. */
  integrity: `sha256-${string}`
}

/** A runtime already present in an ND source checkout that needs a controlled build. */
export interface CapabilitySourceRuntimeSetupDescriptor extends CapabilitySetupDescriptorBase {
  mode: 'source-runtime'
  runtimeId: string
}

export type CapabilitySetupDescriptor = CapabilityPackageSetupDescriptor | CapabilitySourceRuntimeSetupDescriptor

export interface CapabilityPrerequisiteResult {
  id: string
  label: string
  met: boolean
  detail?: string
}

export interface CapabilitySetupCheck {
  providerId: string
  ready: boolean
  prerequisites: CapabilityPrerequisiteResult[]
}

export type CapabilitySetupState =
  | 'not-installed'
  | 'checking-prerequisites'
  | 'downloading'
  | 'installing'
  | 'configuring'
  | 'installed'
  | 'failed'

/** Durable ND-owned routing: subject → capability kind → provider id. Sparse: unset keys mean the default provider. */
export interface CapabilityAssignmentSnapshot {
  version: 1
  agents: Record<string, Partial<Record<CapabilityKind, string>>>
  roles: Record<string, Partial<Record<CapabilityKind, string>>>
  teams: Record<string, Partial<Record<CapabilityKind, string>>>
}

/**
 * Install/verify/enable state for one provider, persisted across restarts.
 * A provider may only be toggled on after its latest verification probe
 * passed; built-ins start enabled, adapters start off until verified.
 */
export interface CapabilityProviderStatus {
  providerId: string
  enabled: boolean
  /** Set only while the LATEST verification probe succeeded. */
  lastVerifiedAt?: number
  /** Error from the latest verify attempt; cleared by the next successful one. */
  lastError?: string
  lastProbeAt?: number
  setupState?: CapabilitySetupState
  setupProgress?: number
  setupMessage?: string
  setupError?: string
  installedVersion?: string
  lastSetupAt?: number
  prerequisites?: CapabilityPrerequisiteResult[]
}

export const ND_HARNESS_CAPABILITY_ID = ND_HARNESS_ENGINE_ID
export const ND_CODEX_DELEGATED_CAPABILITY_ID = CODEX_ENGINE_ID
export const ND_CODEX_CLI_CAPABILITY_ID = CODEX_CLI_ENGINE_ID
export const ND_ORG_MEMORY_ID = 'nd-org-memory'
export const ND_WORKSPACE_CONTEXT_ID = 'nd-workspace-context'
export const OPENVIKING_MEMORY_ID = 'openviking-memory'
export const GRAPHIFY_CONTEXT_ID = 'graphify-context'
/** ND org memory delivered in-loop as a harness patch-row MCP plugin (future). */
export const ND_MEMORY_MCP_ID = 'nd-memory-mcp'
/** Harness session-search mounted as worker recall tools via the patch overlay (dormant upstream today). */
export const ND_SESSION_RECALL_ID = 'nd-session-recall'

export const DEFAULT_CAPABILITY_PROVIDER: Record<CapabilityKind, string> = {
  engine: ND_HARNESS_CAPABILITY_ID,
  memory: ND_ORG_MEMORY_ID,
  context: ND_WORKSPACE_CONTEXT_ID,
}

export const CAPABILITY_KINDS: readonly CapabilityKind[] = ['engine', 'memory', 'context']

export const CAPABILITIES_IPC = {
  providers: 'capabilities:providers',
  assignments: 'capabilities:assignments',
  assign: 'capabilities:assign',
  changedEvent: 'capabilities:changed-event',
  statuses: 'capabilities:statuses',
  verify: 'capabilities:verify',
  checkSetup: 'capabilities:check-setup',
  setup: 'capabilities:setup',
  setEnabled: 'capabilities:set-enabled',
  statusChangedEvent: 'capabilities:status-changed-event',
} as const

/** Catalog + durable assignments + lifecycle statuses as surfaced to the renderer. */
export interface CapabilitiesDesktopApi {
  providers(): Promise<CapabilityDescriptor[]>
  assignments(): Promise<CapabilityAssignmentSnapshot>
  assign(subjectType: CapabilitySubjectType, subjectId: string, kind: CapabilityKind, providerId: string): Promise<CapabilityAssignmentSnapshot>
  onChanged(listener: (assignments: CapabilityAssignmentSnapshot) => void): () => void
  statuses(): Promise<Record<string, CapabilityProviderStatus>>
  checkSetup(providerId: string): Promise<CapabilitySetupCheck>
  setup(providerId: string, values: Record<string, string>): Promise<Record<string, CapabilityProviderStatus>>
  verify(providerId: string): Promise<Record<string, CapabilityProviderStatus>>
  setEnabled(providerId: string, enabled: boolean): Promise<Record<string, CapabilityProviderStatus>>
  onStatusChanged(listener: (statuses: Record<string, CapabilityProviderStatus>) => void): () => void
}
