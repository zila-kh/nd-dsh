import type { DshEventFrame } from '../../shared/contracts.js'
import type { HarnessService } from '../harness/harness-service.js'
import { classifyRuntimeApproval } from './approval-policy.js'
import type { OrganizationStore } from './store.js'

/**
 * Hard ND policy boundary for approval-bearing organization runs.
 *
 * Returns true when the request still needs the renderer/human. Returns false
 * after ND has resolved it automatically from an explicit company policy.
 * Requests outside an organization run are never auto-resolved here.
 */
export class OrganizationApprovalGate {
  constructor(
    private readonly store: Pick<OrganizationStore, 'runBySession' | 'policy'>,
    private readonly harness: Pick<HarnessService, 'respond'>,
  ) {}

  async shouldForward(frame: DshEventFrame): Promise<boolean> {
    if (frame.kind !== 'approval-requested' || !frame.sessionId || !frame.rpcId) return true
    const run = await this.store.runBySession(frame.sessionId)
    if (!run) return true

    const action = classifyRuntimeApproval(frame.toolName, frame.reason)
    const effect = await this.store.policy(run.companyId, action)
    if (effect === 'ask') return true

    await this.harness.respond(frame.rpcId, {
      sessionId: frame.sessionId,
      approvalId: frame.approvalId ?? frame.rpcId,
      outcome: effect === 'allow' ? 'allowed-once' : 'rejected',
    })
    return false
  }
}
