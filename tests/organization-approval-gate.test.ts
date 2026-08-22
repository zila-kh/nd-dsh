import { describe, expect, it } from 'vitest'
import type { DshEventFrame } from '../src/shared/contracts.js'
import { OrganizationApprovalGate } from '../src/main/organization/approval-gate.js'

const run = {
  id: 'run-1', companyId: 'company-1', projectId: 'project-1', kind: 'task-execution' as const,
  status: 'running' as const, sessionId: 'session-1', startedAt: Date.now(),
}

function approval(reason: string): DshEventFrame {
  return {
    kind: 'approval-requested', sessionId: 'session-1', rpcId: 'rpc-1',
    approvalId: 'approval-1', toolName: 'bash', reason,
  }
}

describe('OrganizationApprovalGate', () => {
  it('auto-rejects a denied company action before the renderer sees it', async () => {
    const responses: unknown[] = []
    const store = {
      runBySession: async () => run,
      policy: async () => 'deny' as const,
    }
    const harness = { respond: async (_rpcId: string, value: unknown) => { responses.push(value) } }
    const gate = new OrganizationApprovalGate(store as never, harness as never)

    expect(await gate.shouldForward(approval('terraform destroy production'))).toBe(false)
    expect(responses).toEqual([{ sessionId: 'session-1', approvalId: 'approval-1', outcome: 'rejected' }])
  })

  it('auto-allows once only when company policy explicitly allows the classified action', async () => {
    const responses: unknown[] = []
    const store = {
      runBySession: async () => run,
      policy: async (_companyId: string, action: string) => action === 'external.publish' ? 'allow' as const : 'ask' as const,
    }
    const harness = { respond: async (_rpcId: string, value: unknown) => { responses.push(value) } }
    const gate = new OrganizationApprovalGate(store as never, harness as never)

    expect(await gate.shouldForward(approval('git push origin main'))).toBe(false)
    expect(responses).toEqual([{ sessionId: 'session-1', approvalId: 'approval-1', outcome: 'allowed-once' }])
  })

  it('forwards ASK and unknown escalations to the human approval surface', async () => {
    const responses: unknown[] = []
    const store = {
      runBySession: async () => run,
      policy: async () => 'ask' as const,
    }
    const harness = { respond: async (_rpcId: string, value: unknown) => { responses.push(value) } }
    const gate = new OrganizationApprovalGate(store as never, harness as never)

    expect(await gate.shouldForward(approval('needs permission outside the workspace'))).toBe(true)
    expect(responses).toEqual([])
  })

  it('does not apply company policy to manual runtime sessions with no organization run', async () => {
    const store = {
      runBySession: async () => undefined,
      policy: async () => 'deny' as const,
    }
    const harness = { respond: async () => { throw new Error('must not resolve') } }
    const gate = new OrganizationApprovalGate(store as never, harness as never)

    expect(await gate.shouldForward(approval('git push origin main'))).toBe(true)
  })
})
