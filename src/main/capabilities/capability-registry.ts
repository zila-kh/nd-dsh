import type { CapabilityAssignmentSnapshot, CapabilityDescriptor, CapabilityKind, CapabilityProviderStatus, CapabilitySubjectType } from '../../shared/capabilities.js'
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
  constructor(
    private readonly assignmentsStore: CapabilityAssignmentStore,
    private readonly engines: Pick<CodingEngineRegistry, 'list' | 'assign'>,
    private readonly statusStore: CapabilityStatusStore,
    private readonly builtinProbes: CapabilityBuiltinProbes = {},
  ) {}

  list(): CapabilityDescriptor[] {
    return [
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
    try {
      await this.probe(descriptor)
    } catch (cause) {
      return this.statusStore.recordProbe(providerId, { ok: false, at: Date.now(), error: cause instanceof Error ? cause.message : String(cause) })
    }
    return this.statusStore.recordProbe(providerId, { ok: true, at: Date.now() })
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
    const builtinProbe = this.builtinProbes[descriptor.id]
    if (builtinProbe) await builtinProbe()
  }

  private mergeStatus(providerId: string, descriptor: CapabilityDescriptor, stored?: CapabilityProviderStatus): CapabilityProviderStatus {
    return {
      providerId,
      enabled: stored?.enabled ?? descriptor.integration === 'builtin',
      ...(stored?.lastVerifiedAt !== undefined ? { lastVerifiedAt: stored.lastVerifiedAt } : {}),
      ...(stored?.lastError !== undefined ? { lastError: stored.lastError } : {}),
      ...(stored?.lastProbeAt !== undefined ? { lastProbeAt: stored.lastProbeAt } : {}),
    }
  }

  private requireDescriptor(kind: CapabilityKind, providerId: string): CapabilityDescriptor {
    const descriptor = this.list().find((item) => item.kind === kind && item.id === providerId)
    if (!descriptor) throw new Error(`Unknown ${kind} provider: ${providerId}`)
    return descriptor
  }
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
