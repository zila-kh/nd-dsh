import { describe, expect, it, vi } from 'vitest'
import { DecisionSupportService } from '../src/main/organization/decision-support.js'
import { formatDecisionSupportForReviewer, type DecisionProvider, type DecisionProviderResult } from '../src/main/organization/decision-support-contract.js'

function provider(id: string, confidence: number): DecisionProvider {
  return {
    id,
    decide: vi.fn(async (): Promise<DecisionProviderResult> => ({
      provider: id,
      model: id + '-model',
      answers: {
        review_route: {
          type: 'choice',
          choice: 'standard_review',
          confidence,
        },
      },
      latencyMs: 1,
      minimumConfidence: confidence,
    })),
  }
}

const input = {
  company: 'Acme',
  project: 'App',
  task: {
    id: 'task-1',
    title: 'Implement feature',
    description: 'Build the requested feature.',
    acceptanceCriteria: ['Feature works'],
    resultSummary: 'Implemented and tested.',
  },
}

describe('decision support cascade', () => {
  it('uses high-confidence Laya without calling Jev', async () => {
    const laya = provider('laya', 0.92)
    const jev = provider('jev', 0.95)
    const service = new DecisionSupportService('assist', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.selectedProvider).toBe('laya')
    expect(receipt?.escalated).toBe(false)
    expect(laya.decide).toHaveBeenCalledTimes(1)
    expect(jev.decide).not.toHaveBeenCalled()
    expect(formatDecisionSupportForReviewer(receipt)).toContain('Non-authoritative System One review-assist signals')
  })

  it('escalates low-confidence Laya to Jev', async () => {
    const laya = provider('laya', 0.51)
    const jev = provider('jev', 0.88)
    const service = new DecisionSupportService('assist', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.selectedProvider).toBe('jev')
    expect(receipt?.escalated).toBe(true)
    expect(laya.decide).toHaveBeenCalledTimes(1)
    expect(jev.decide).toHaveBeenCalledTimes(1)
  })

  it('falls back to the existing reviewer when every provider is low confidence', async () => {\n    const laya = provider('laya', 0.51)\n    const jev = provider('jev', 0.62)\n    const service = new DecisionSupportService('assist', [laya, jev], 0.78)\n\n    const receipt = await service.reviewAssist(input)\n\n    expect(receipt?.selectedProvider).toBeUndefined()\n    expect(receipt?.attempts).toHaveLength(2)\n    expect(formatDecisionSupportForReviewer(receipt)).toBe('')\n  })\n\n  it('keeps shadow mode non-authoritative while recording every provider', async () => {
    const laya = provider('laya', 0.95)
    const jev = provider('jev', 0.96)
    const service = new DecisionSupportService('shadow', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.selectedProvider).toBeUndefined()
    expect(receipt?.attempts).toHaveLength(2)
    expect(formatDecisionSupportForReviewer(receipt)).toBe('')
  })

  it('contains provider failures and continues the cascade', async () => {
    const laya: DecisionProvider = {
      id: 'laya',
      decide: vi.fn(async () => {
        throw new Error('local endpoint unavailable')
      }),
    }
    const jev = provider('jev', 0.9)
    const service = new DecisionSupportService('assist', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.attempts[0]).toMatchObject({ provider: 'laya', ok: false })
    expect(receipt?.selectedProvider).toBe('jev')
    expect(receipt?.escalated).toBe(true)
  })
})
