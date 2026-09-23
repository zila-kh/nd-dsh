import type { DshEventFrame } from '../../shared/contracts.js'
import type { CoreClient } from '../core/core-client.js'
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
    private readonly core?: Pick<CoreClient, 'request'>,
  ) {}

  async shouldForward(frame: DshEventFrame): Promise<boolean> {
    if (frame.kind !== 'approval-requested' || !frame.sessionId || !frame.rpcId) return true
    const run = await this.store.runBySession(frame.sessionId)
    if (!run) return true

    const action = classifyRuntimeApproval(frame.toolName, frame.reason)
    const effect = await this.store.policy(run.companyId, action)
    const journaled = await this.journalDecision({
      companyId: run.companyId,
      projectId: run.projectId,
      taskId: run.taskId,
      runId: run.id,
      rpcId: frame.rpcId,
      action,
      effect,
      toolName: frame.toolName,
    })

    if (effect === 'ask') return true
    // A missing durable receipt must never turn an allow policy into an
    // untracked automatic external effect. Fall back to the human gate.
    if (effect === 'allow' && !journaled) return true

    await this.harness.respond(frame.rpcId, {
      sessionId: frame.sessionId,
      approvalId: frame.approvalId ?? frame.rpcId,
      outcome: effect === 'allow' ? 'allowed-once' : 'rejected',
    })
    return false
  }

  private async journalDecision(input: {
    companyId: string
    projectId: string
    taskId?: string
    runId: string
    rpcId: string
    action: string
    effect: 'allow' | 'ask' | 'deny'
    toolName?: string
  }): Promise<boolean> {
    if (!this.core) return true
    try {
      await this.core.request('effectJournal.append', {
        kind: 'policy.decision',
        state: 'complete',
        companyId: input.companyId,
        projectId: input.projectId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        runId: input.runId,
        resourceId: input.rpcId,
        idempotencyKey: `policy:${input.runId}:${input.rpcId}`,
        data: {
          action: input.action,
          effect: input.effect,
          ...(input.toolName ? { toolName: input.toolName } : {}),
        },
      }, 5_000)
      return true
    } catch {
      return false
    }
  }
}
