import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComputeAccount, ComputeUsageRecord } from '../src/shared/compute-budget.js'
import { ComputeLedger } from '../src/main/compute/compute-ledger.js'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(limitUsd = 1) {
  const root = await mkdtemp(join(tmpdir(), 'nd-compute-'))
  temporary.push(root)
  const ledger = new ComputeLedger(join(root, 'usage.jsonl'))
  const account: ComputeAccount = {
    id: 'payg-main',
    provider: 'openai',
    label: 'PAYG main',
    billingKind: 'payg',
    allowPaidOverage: false,
    meters: [{ kind: 'cash_usd', period: 'month', limitUsd, spentUsd: 0 }],
    refreshedAt: Date.now(),
    status: 'healthy',
  }
  await ledger.upsertAccount(account)
  return { root, ledger, account }
}

function usage(id: string, cash?: number): ComputeUsageRecord {
  return {
    id,
    accountId: 'payg-main',
    companyId: 'company-1',
    projectId: 'project-1',
    taskId: 'task-1',
    runId: `run-${id}`,
    billingClass: 'payg',
    ...(cash === undefined ? {} : { actualCashUsd: cash }),
    source: 'provider',
    observedAt: Date.now(),
  }
}

describe('compute ledger', () => {
  it('prevents concurrent reservations from overspending one shared account', async () => {
    const { ledger } = await fixture(1)

    await ledger.reserve({
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-1',
      taskId: 'task-a',
      reservedUsd: 0.7,
    })

    await expect(ledger.reserve({
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-2',
      taskId: 'task-b',
      reservedUsd: 0.7,
    })).rejects.toThrow(/cash limit would be exceeded/i)

    const summary = await ledger.cashSummary({ accountId: 'payg-main' })
    expect(summary.heldUsd).toBeCloseTo(0.7)
    expect(summary.activeReservations).toBe(1)
  })

  it('settles actual cash and releases the unused reservation headroom', async () => {
    const { ledger } = await fixture(2)
    const reservation = await ledger.reserve({
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-1',
      reservedUsd: 1,
    })

    const settled = await ledger.settle(reservation.id, usage('settled', 0.42))
    expect(settled.reservation.state).toBe('settled')
    expect(settled.reservation.settledUsd).toBeCloseTo(0.42)

    const summary = await ledger.cashSummary({ companyId: 'company-1', projectId: 'project-1' })
    expect(summary.actualCashUsd).toBeCloseTo(0.42)
    expect(summary.heldUsd).toBe(0)
    expect(summary.activeReservations).toBe(0)
  })

  it('keeps included provider-value usage out of actual cash totals', async () => {
    const { ledger } = await fixture(2)
    await ledger.recordUsage({
      ...usage('included'),
      billingClass: 'included',
      providerValueUsd: 0.8,
    })

    const summary = await ledger.cashSummary({ companyId: 'company-1', projectId: 'project-1' })
    expect(summary.actualCashUsd).toBe(0)
    expect(summary.accountingKnown).toBe(true)
  })

  it('ingests identical records idempotently and rejects conflicting duplicate ids', async () => {
    const { ledger } = await fixture(2)
    const row = usage('same', 0.2)
    await expect(ledger.recordUsage(row)).resolves.toBe(true)
    await expect(ledger.recordUsage(row)).resolves.toBe(false)
    await expect(ledger.recordUsage({ ...row, actualCashUsd: 0.3 })).rejects.toThrow(/conflicts/i)
    expect((await ledger.cashSummary()).actualCashUsd).toBeCloseTo(0.2)
  })

  it('restores held reservations after restart so a crash cannot reopen spent headroom', async () => {
    const { root, ledger } = await fixture(1)
    await ledger.reserve({
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-1',
      reservedUsd: 0.8,
      expiresAt: Date.now() + 60_000,
    })

    const reopened = new ComputeLedger(join(root, 'usage.jsonl'))
    const snapshot = await reopened.snapshot()
    expect(snapshot.reservations.filter((item) => item.state === 'held')).toHaveLength(1)

    await expect(reopened.reserve({
      accountId: 'payg-main',
      companyId: 'company-1',
      projectId: 'project-2',
      reservedUsd: 0.3,
    })).rejects.toThrow(/cash limit would be exceeded/i)
  })
})
