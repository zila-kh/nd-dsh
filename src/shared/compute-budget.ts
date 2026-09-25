export type ComputeBillingKind =
  | 'subscription'
  | 'included_allowance'
  | 'credits'
  | 'payg'
  | 'byok'
  | 'local'

export type ComputeAccountStatus =
  | 'healthy'
  | 'stale'
  | 'exhausted'
  | 'unavailable'

export type BudgetPressure =
  | 'normal'
  | 'economy'
  | 'strict'
  | 'reserve'
  | 'exhausted'

export type ComputeMeter =
  | {
      kind: 'cash_usd'
      period: 'day' | 'week' | 'month' | 'lifetime'
      limitUsd?: number
      spentUsd: number
    }
  | {
      kind: 'provider_value_usd'
      period: '5h' | 'week' | 'month'
      limitUsd: number
      usedUsd: number
    }
  | {
      kind: 'quota_ratio'
      period?: string
      remainingRatio: number
    }
  | {
      kind: 'credits'
      unit: string
      remaining: number
      limit?: number
    }
  | {
      kind: 'tokens'
      inputTokens: number
      outputTokens: number
      reasoningTokens?: number
    }

export interface ComputeAccount {
  id: string
  companyId?: string
  provider:
    | 'opencode'
    | 'codex'
    | 'antigravity'
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'custom'
    | 'local'
  label: string
  billingKind: ComputeBillingKind
  fixedMonthlyCostUsd?: number
  allowPaidOverage: boolean
  meters: ComputeMeter[]
  refreshedAt?: number
  nextResetAt?: number
  status: ComputeAccountStatus
}

export interface ComputeUsageRecord {
  id: string
  accountId: string
  companyId?: string
  projectId?: string
  taskId?: string
  runId?: string
  agentId?: string
  engineId?: string
  provider?: string
  model?: string
  billingClass: 'included' | 'payg' | 'byok' | 'local'
  actualCashUsd?: number
  providerValueUsd?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  source: 'provider' | 'engine' | 'derived' | 'manual'
  observedAt: number
}

export interface ComputeReservation {
  id: string
  accountId: string
  companyId: string
  projectId: string
  taskId?: string
  runId?: string
  reservedUsd?: number
  reservedEntitlementRatio?: number
  settledUsd?: number
  state: 'held' | 'settled' | 'released' | 'expired'
  createdAt: number
  expiresAt: number
  settledAt?: number
  releasedAt?: number
}

export interface ComputeLedgerSnapshot {
  version: 1
  accounts: ComputeAccount[]
  records: ComputeUsageRecord[]
  reservations: ComputeReservation[]
  accountingKnown: boolean
  updatedAt: number
}

export interface ComputeCashSummary {
  accountingKnown: boolean
  actualCashUsd: number
  heldUsd: number
  activeReservations: number
}

export interface ComputeManagementProjection extends ComputeCashSummary {
  staleAccountIds: string[]
  exhaustedAccountIds: string[]
}
