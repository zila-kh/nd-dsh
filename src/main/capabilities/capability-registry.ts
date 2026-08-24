import type {
  CapabilityAssignmentSnapshot,
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityPrerequisiteResult,
  CapabilityProviderStatus,
  CapabilitySetupCheck,
  CapabilitySetupDescriptor,
  CapabilitySubjectType,
} from '../../shared/capabilities.js'
import {
  CAPABILITY_KINDS,
  DEFAULT_CAPABILITY_PROVIDER,
  GRAPHIFY_CONTEXT_ID,
  ND_HARNESS_CAPABILITY_ID,
  ND_MEMORY_MCP_ID,
  ND_ORG_MEMORY_ID,
  ND_SESSION_RECALL_ID,
  ND_WORKSPACE_CONTEXT_ID,
  OPENVIKING_MEMORY_ID,
} from '../../shared/capabilities.js'
import type { CodingEngineDescriptor } from '../../shared/contracts.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { CapabilityAssignmentStore, CapabilitySubjectRef } from './capability-assignment-store.js'
import type { CapabilityStatusStore } from './capability-status-store.js'

/** Minimal organization facts needed to walk the agent → role → team fallback. */
export interface SubjectFacts {
  roleId?: string
  teamId?: string
}

/**
 * Backing-service probes for built-in providers, injected by the shell so this
 * registry stays decoupled from Electron and store internals. A probe throws
 * when its service is unusable right now.
 */
export type CapabilityBuiltinProbes = Partial<Record<string, () => Promise<void>>>

export interface CapabilitySetupProgress {
  state: 'downloading' | 'installing' | 'configuring'
  progress: number
  message?: string
}

/**
 * Trusted provider-owned setup code. Adapters are compiled into the main
 * process; the renderer can select only a provider id and declared fields.
 */
export interface CapabilitySetupAdapter {
  descriptor: CapabilitySetupDescriptor
  checkPrerequisites(): Promise<CapabilityPrerequisiteResult[]>
  install(values: Readonly<Record<string, string>>, report: (progress: CapabilitySetupProgress) => Promise<void>): Promise<{
    installedVersion: string
    /** Approved-package adapters must attest the source fetched and computed digest. */
    sourceUrl?: string
    integrity?: string
  }>
  verify(): Promise<void>
}

export type CapabilitySetupAdapters = Readonly<Record<string, CapabilitySetupAdapter>>

const ADAPTER_NOT_CONFIGURED = 'Adapter slot reserved. The integration ships in an upcoming ND release; built-ins stay active meanwhile.'
const STAGED_SEAM_NOTE = 'Delivered through the sanctioned harness patch overlay — no vendored core changes.'

/**
 * Product-owned registry across all pluggable capability kinds. Engines come
 * from the coding-engine catalog; memory/context ship as ND built-ins today.
 * Adapter slots stay visible but unverified until their integrations land, so
 * assignments can be staged before activation.
 *
 * Resolution precedence mirrors org hierarchy: agent → role → team → default.
 * A provider is usable only when it is available AND currently enabled, and
 * "enabled" always implies "its latest verification probe passed".
 */
export class CapabilityRegistry {
  private readonly setupInProgress = new Set<string>()

  constructor(
    private readonly assignmentsStore: CapabilityAssignmentStore,
    private readonly engines: Pick<CodingEngineRegistry, 'list' | 'assign'>,
    private readonly statusStore: CapabilityStatusStore,
    private readonly builtinProbes: CapabilityBuiltinProbes = {},
    private readonly setupAdapters: CapabilitySetupAdapters = {},
  ) {}

  list(): CapabilityDescriptor[] {
    const catalog: CapabilityDescriptor[] = [
      ...this.engines.list().map((engine) => engineCapability(engine)),
      {
        id: ND_ORG_MEMORY_ID,
        kind: 'memory',
        name: 'ND Organization Memory',
        integration: 'builtin',
        available: true,
        description: 'Company/project-scoped durable memory owned by the organization store; injected into PM, worker, and review prompts.',
      },
      {
        id: OPENVIKING_MEMORY_ID,
        kind: 'memory',
        name: 'OpenViking Memory',
        integration: 'adapter',
        available: false,
        description: 'External context-database adapter for long-horizon checkpointed recall across parallel workers.',
        unavailableReason: ADAPTER_NOT_CONFIGURED,
      },
      {
        id: ND_MEMORY_MCP_ID,
        kind: 'memory',
        name: 'ND Memory MCP',
        integration: 'adapter',
        available: false,
        description: 'ND organization memory exposed as live in-loop worker tools inside harness sessions via a patch-row MCP plugin.',
        unavailableReason: `${ADAPTER_NOT_CONFIGURED} ${STAGED_SEAM_NOTE}`,
      },
      {
        id: ND_WORKSPACE_CONTEXT_ID,
        kind: 'context',
        name: 'ND Workspace Context',
        integration: 'builtin',
        available: true,
        description: 'Workspace files, git state, live browser UI targets, annotations, and screenshots attached to prompts by the ND runtime.',
      },
      {
        id: ND_SESSION_RECALL_ID,
        kind: 'context',
        name: 'Harness Session Recall',
        integration: 'adapter',
        available: false,
        description: 'Mounts the harness session-search index as worker tools for recall over past coding sessions.',
        unavailableReason: `${ADAPTER_NOT_CONFIGURED} ${STAGED_SEAM_NOTE}`,
      },
      {
        id: GRAPHIFY_CONTEXT_ID,
        kind: 'context',
        name: 'Graphify Repo Map',
        integration: 'adapter',
        available: false,
        description: 'Local AST code-graph adapter for blast-radius analysis and token-cheap repo mapping inside workers.',
        unavailableReason: ADAPTER_NOT_CONFIGURED,
      },
    ]
    return catalog.map((descriptor) => {
      const adapter = this.setupAdapters[descriptor.id]
      // A setup action is only needed while the native availability probe is
      // failing. Once setup produces the runtime, the live engine descriptor
      // becomes authoritative and the UI moves directly to Verify.
      if (!adapter || descriptor.available) return descriptor
      assertTrustedSetupDescriptor(adapter.descriptor)
      const { unavailableReason: _unavailableReason, ...availableDescriptor } = descriptor
      return { ...availableDescriptor, available: true, setup: adapter.descriptor }
    })
  }

  assignments(): Promise<CapabilityAssignmentSnapshot> {
    return this.assignmentsStore.all()
  }

  async statuses(): Promise<Record<string, CapabilityProviderStatus>> {
    const stored = await this.statusStore.all()
    const view: Record<string, CapabilityProviderStatus> = {}
    for (const descriptor of this.list()) {
      view[descriptor.id] = this.mergeStatus(descriptor.id, descriptor, stored[descriptor.id])
    }
    return view
  }

  async assign(subjectType: CapabilitySubjectType, subjectId: string, kind: CapabilityKind, providerId: string): Promise<CapabilityAssignmentSnapshot> {
    if (!CAPABILITY_KINDS.includes(kind)) throw new Error(`Unknown capability kind: ${String(kind)}`)
    const descriptor = this.requireDescriptor(kind, providerId)
    if (providerId !== DEFAULT_CAPABILITY_PROVIDER[kind] && !descriptor.available) {
      throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is unavailable`)
    }
    return this.assignmentsStore.assign(subjectType, subjectId, kind, providerId)
  }

  /**
   * Run the real verification probe for one provider and persist the outcome.
   * Throws after recording when the probe fails, so UI callers surface the
   * reason while the stored status still updates.
   */
  async verify(providerId: string): Promise<CapabilityProviderStatus> {
    const descriptor = this.list().find((item) => item.id === providerId)
    if (!descriptor) throw new Error(`Unknown capability provider: ${providerId}`)
    const previous = await this.statusStore.get(providerId)
    try {
      await this.probe(descriptor)
    } catch (cause) {
      return this.statusStore.recordProbe(providerId, { ok: false, at: Date.now(), error: cause instanceof Error ? cause.message : String(cause) })
    }
    const verified = await this.statusStore.recordProbe(providerId, { ok: true, at: Date.now() })
    if (!previous && descriptor.integration === 'builtin') return this.statusStore.setEnabled(providerId, true)
    return verified
  }

  async checkSetup(providerId: string): Promise<CapabilitySetupCheck> {
    const { descriptor, adapter } = this.requireSetupAdapter(providerId)
    const prerequisites = sanitizePrerequisiteResults(await adapter.checkPrerequisites(), descriptor.setup!.prerequisites)
    return { providerId, ready: prerequisites.every((item) => item.met), prerequisites }
  }

  /** Run an approved installer. Submitted setup values are validated and are never persisted by ND. */
  async setup(providerId: string, values: Record<string, string>): Promise<CapabilityProviderStatus> {
    const { descriptor, adapter } = this.requireSetupAdapter(providerId)
    if (this.setupInProgress.has(providerId)) throw new Error(`${descriptor.name} setup is already running.`)
    const safeValues = validateSetupValues(descriptor.setup!, values)
    this.setupInProgress.add(providerId)
    try {
      const check = await this.checkSetup(providerId)
      if (!check.ready) {
        const message = `Missing prerequisites: ${check.prerequisites.filter((item) => !item.met).map((item) => item.label).join(', ')}`
        await this.statusStore.recordSetup(providerId, {
          state: 'failed', at: Date.now(), error: message, prerequisites: check.prerequisites,
        })
        throw new Error(message)
      }
      const setupLabel = descriptor.setup!.mode === 'source-runtime'
        ? descriptor.setup!.runtimeId
        : descriptor.setup!.packageId
      await this.statusStore.recordSetup(providerId, {
        state: descriptor.setup!.mode === 'source-runtime' ? 'installing' : 'downloading',
        at: Date.now(), progress: 0, message: `Setting up ${setupLabel}`,
        prerequisites: check.prerequisites,
      })
      const result = await adapter.install(safeValues, async (progress) => {
        await this.statusStore.recordSetup(providerId, {
          state: progress.state,
          at: Date.now(),
          progress: progress.progress,
          ...(progress.message ? { message: progress.message } : {}),
          prerequisites: check.prerequisites,
        })
      })
      if (result.installedVersion !== descriptor.setup!.version) {
        throw new Error(`Installer returned ${result.installedVersion}; approved version is ${descriptor.setup!.version}.`)
      }
      if (descriptor.setup!.mode !== 'source-runtime'
        && (result.sourceUrl !== descriptor.setup!.sourceUrl || result.integrity !== descriptor.setup!.integrity)) {
        throw new Error('Installer source or computed integrity does not match ND\'s approved package metadata.')
      }
      return await this.statusStore.recordSetup(providerId, {
        state: 'installed', at: Date.now(), progress: 100, message: 'Setup complete. Verify before enabling.',
        installedVersion: result.installedVersion, prerequisites: check.prerequisites,
      })
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      const current = await this.statusStore.get(providerId)
      if (current?.setupState !== 'failed') {
        await this.statusStore.recordSetup(providerId, { state: 'failed', at: Date.now(), error })
      }
      throw cause
    } finally {
      this.setupInProgress.delete(providerId)
    }
  }

  /**
   * Toggle a provider on or off. Enabling requires that the latest
   * verification probe passed; disabling is always allowed.
   */
  async setEnabled(providerId: string, enabled: boolean): Promise<CapabilityProviderStatus> {
    const descriptor = this.list().find((item) => item.id === providerId)
    if (!descriptor) throw new Error(`Unknown capability provider: ${providerId}`)
    if (enabled) {
      const current = await this.statusStore.get(providerId)
      if (descriptor.setup && current?.setupState !== 'installed') {
        throw new Error(`${descriptor.name} must finish Download & Setup before it can be enabled.`)
      }
      if (current?.lastVerifiedAt === undefined) {
        throw new Error(`${descriptor.name} must pass verification before it can be enabled. Run Verify first.`)
      }
    }
    return this.statusStore.setEnabled(providerId, enabled)
  }

  /** Resolve one kind for an agent, falling back through role/team, gated on availability + enablement. */
  async resolve(kind: CapabilityKind, agent?: { id?: string } & SubjectFacts): Promise<{ id: string; descriptor: CapabilityDescriptor }> {
    const ref: CapabilitySubjectRef = {
      type: 'agent',
      ...(agent?.id ? { id: agent.id } : {}),
      ...(agent?.roleId ? { role: agent.roleId } : {}),
      ...(agent?.teamId ? { team: agent.teamId } : {}),
    }
    const id = await this.assignmentsStore.resolve(kind, ref)
    const descriptors = this.list()
    const descriptor = descriptors.find((item) => item.kind === kind && item.id === id)
      ?? descriptors.find((item) => item.kind === kind && item.id === DEFAULT_CAPABILITY_PROVIDER[kind])
    if (!descriptor) throw new Error(`No ${kind} provider registered`)
    if (!descriptor.available) {
      throw new Error(`${descriptor.name} (${kind}) cannot be used: ${descriptor.unavailableReason ?? 'unavailable'}`)
    }
    const status = await this.statusStore.get(descriptor.id)
    if (descriptor.setup && status?.setupState !== 'installed') {
      throw new Error(`${descriptor.name} (${kind}) is not installed. Finish Download & Setup in Settings â†’ Capabilities.`)
    }
    const enabled = status?.enabled ?? descriptor.integration === 'builtin'
    if (!enabled) throw new Error(`${descriptor.name} (${kind}) is disabled. Enable it in Settings → Capabilities.`)
    return { id: descriptor.id, descriptor }
  }

  /**
   * Fail closed before a run starts when any of the subject's assigned
   * capabilities is not actually usable right now.
   */
  async assertUsableForAgent(agent?: { id?: string } & SubjectFacts): Promise<void> {
    for (const kind of CAPABILITY_KINDS) {
      await this.resolve(kind, agent)
    }
  }

  private async probe(descriptor: CapabilityDescriptor): Promise<void> {
    if (!descriptor.available) {
      throw new Error(descriptor.unavailableReason ?? `${descriptor.name} is not installed`)
    }
    const setupAdapter = this.setupAdapters[descriptor.id]
    if (descriptor.setup && setupAdapter) {
      const status = await this.statusStore.get(descriptor.id)
      if (status?.setupState !== 'installed') throw new Error(`${descriptor.name} is not installed. Finish Download & Setup first.`)
      await setupAdapter.verify()
      return
    }
    const builtinProbe = this.builtinProbes[descriptor.id]
    if (builtinProbe) await builtinProbe()
  }

  private mergeStatus(providerId: string, descriptor: CapabilityDescriptor, stored?: CapabilityProviderStatus): CapabilityProviderStatus {
    const setupStatus = descriptor.setup ? {
      setupState: stored?.setupState ?? 'not-installed' as const,
      ...(stored?.setupProgress !== undefined ? { setupProgress: stored.setupProgress } : {}),
      ...(stored?.setupMessage !== undefined ? { setupMessage: stored.setupMessage } : {}),
      ...(stored?.setupError !== undefined ? { setupError: stored.setupError } : {}),
      ...(stored?.installedVersion !== undefined ? { installedVersion: stored.installedVersion } : {}),
      ...(stored?.lastSetupAt !== undefined ? { lastSetupAt: stored.lastSetupAt } : {}),
      ...(stored?.prerequisites !== undefined ? { prerequisites: stored.prerequisites } : {}),
    } : {}
    return {
      providerId,
      enabled: stored?.enabled ?? descriptor.integration === 'builtin',
      ...(stored?.lastVerifiedAt !== undefined ? { lastVerifiedAt: stored.lastVerifiedAt } : {}),
      ...(stored?.lastError !== undefined ? { lastError: stored.lastError } : {}),
      ...(stored?.lastProbeAt !== undefined ? { lastProbeAt: stored.lastProbeAt } : {}),
      ...setupStatus,
    }
  }

  private requireSetupAdapter(providerId: string): { descriptor: CapabilityDescriptor; adapter: CapabilitySetupAdapter } {
    const descriptor = this.list().find((item) => item.id === providerId)
    if (!descriptor) throw new Error(`Unknown capability provider: ${providerId}`)
    const adapter = this.setupAdapters[providerId]
    if (!descriptor.setup || !adapter) throw new Error(`${descriptor.name} has no approved Download & Setup package in this ND release.`)
    return { descriptor, adapter }
  }

  private requireDescriptor(kind: CapabilityKind, providerId: string): CapabilityDescriptor {
    const descriptor = this.list().find((item) => item.kind === kind && item.id === providerId)
    if (!descriptor) throw new Error(`Unknown ${kind} provider: ${providerId}`)
    return descriptor
  }
}

function assertTrustedSetupDescriptor(descriptor: CapabilitySetupDescriptor): void {
  let source: URL
  try { source = new URL(descriptor.sourceUrl) } catch { throw new Error(`Capability setup source is invalid: ${descriptor.sourceUrl}`) }
  if (source.protocol !== 'https:' || source.username || source.password) throw new Error('Capability setup sources must use credential-free HTTPS URLs')
  if (!descriptor.version.trim() || /^(latest|next|main|master)$/i.test(descriptor.version) || /[<>=*~^|]/.test(descriptor.version)) {
    throw new Error(`Capability setup requires an exact approved version, received: ${descriptor.version}`)
  }
  if (descriptor.mode === 'source-runtime') {
    if (!descriptor.runtimeId.trim()) throw new Error('Capability source-runtime id is required')
  } else {
    if (!descriptor.packageId.trim()) throw new Error('Capability setup package id is required')
    if (!/^sha256-[A-Za-z0-9+/=_-]{32,}$/.test(descriptor.integrity)) throw new Error('Capability setup requires a valid sha256 integrity value')
  }
  const ids = new Set<string>()
  for (const field of descriptor.fields) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(field.id) || ids.has(field.id)) throw new Error(`Invalid or duplicate capability setup field: ${field.id}`)
    ids.add(field.id)
  }
}

function validateSetupValues(descriptor: CapabilitySetupDescriptor, values: Record<string, string>): Record<string, string> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Capability setup values must be an object')
  const allowed = new Map(descriptor.fields.map((field) => [field.id, field]))
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key)) throw new Error(`Unexpected capability setup field: ${key}`)
    if (typeof raw !== 'string' || raw.length > 4_096) throw new Error(`Invalid capability setup value: ${key}`)
    result[key] = raw
  }
  for (const field of descriptor.fields) {
    if (field.required && !result[field.id]?.trim()) throw new Error(`${field.label} is required.`)
  }
  return result
}

function sanitizePrerequisiteResults(results: CapabilityPrerequisiteResult[], labels: string[]): CapabilityPrerequisiteResult[] {
  if (!Array.isArray(results)) throw new Error('Capability prerequisite check returned an invalid result')
  return results.map((item, index) => ({
    id: String(item.id || `prerequisite-${index}`).slice(0, 128),
    label: String(item.label || labels[index] || `Prerequisite ${index + 1}`).slice(0, 256),
    met: item.met === true,
    ...(item.detail ? { detail: String(item.detail).slice(0, 1_000) } : {}),
  }))
}

function engineCapability(engine: CodingEngineDescriptor): CapabilityDescriptor {
  return {
    id: engine.id,
    kind: 'engine',
    name: engine.name,
    integration: engine.id === ND_HARNESS_CAPABILITY_ID ? 'builtin' : 'adapter',
    available: engine.available,
    description: engine.description,
    ...(engine.unavailableReason !== undefined ? { unavailableReason: engine.unavailableReason } : {}),
  }
}
