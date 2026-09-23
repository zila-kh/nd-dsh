import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DecisionSupportService, HttpDecisionProvider, evaluateDecisionAttempts } from '../src/main/organization/decision-support.js'
import { createDecisionSupportFromEnv } from '../src/main/organization/decision-support-config.js'
import { formatDecisionSupportForReviewer, type DecisionKernelInput, type DecisionProvider, type DecisionProviderResult } from '../src/main/organization/decision-support-contract.js'

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

const parityCases = JSON.parse(readFileSync(
  new URL('./fixtures/decision-kernel-parity.json', import.meta.url),
  'utf8',
)) as Array<DecisionKernelInput & {
  name: string
  expected: {
    selectedProvider: string | null
    shouldContinue: boolean
    escalated: boolean
  }
}>

describe('decision support cascade', () => {
  it('matches the shared Rust/TypeScript decision fixture corpus', () => {
    for (const testCase of parityCases) {
      const evaluation = evaluateDecisionAttempts(testCase)
      expect(evaluation.receipt.selectedProvider ?? null, testCase.name).toBe(testCase.expected.selectedProvider)
      expect(evaluation.shouldContinue, testCase.name).toBe(testCase.expected.shouldContinue)
      expect(evaluation.receipt.escalated, testCase.name).toBe(testCase.expected.escalated)
    }
  })

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

  it('falls back to the existing reviewer when every provider is low confidence', async () => {
    const laya = provider('laya', 0.51)
    const jev = provider('jev', 0.62)
    const service = new DecisionSupportService('assist', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.selectedProvider).toBeUndefined()
    expect(receipt?.attempts).toHaveLength(2)
    expect(receipt?.escalated).toBe(true)
    expect(formatDecisionSupportForReviewer(receipt)).toBe('')
  })

  it('keeps shadow mode non-authoritative while recording every provider', async () => {
    const laya = provider('laya', 0.95)
    const jev = provider('jev', 0.96)
    const service = new DecisionSupportService('shadow', [laya, jev], 0.78)

    const receipt = await service.reviewAssist(input)

    expect(receipt?.selectedProvider).toBeUndefined()
    expect(receipt?.attempts).toHaveLength(2)
    expect(formatDecisionSupportForReviewer(receipt)).toBe('')
  })

  it('omits model for Laya-style provider-default routing', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).not.toHaveProperty('model')
      expect(body).toHaveProperty('state')
      expect(body).toHaveProperty('questions')
      return new Response(JSON.stringify({
        model: 'english',
        answers: {
          review_route: {
            type: 'choice',
            choice: 'standard_review',
            probabilities: { standard_review: 0.9, deep_review: 0.1 },
            confidence: 0.9,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const laya = new HttpDecisionProvider({
      id: 'laya',
      endpoint: 'http://127.0.0.1:8765',
      fetchImpl: fetchImpl as typeof fetch,
    })

    const result = await laya.decide(input, {
      review_route: {
        type: 'choice',
        instructions: 'Pick review depth',
        criteria: { standard_review: 'normal', deep_review: 'deep' },
      },
    })

    expect(result.model).toBe('english')
    expect(result.minimumConfidence).toBe(0.9)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses Jev bearer auth and stable alias by default', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.typesafe.ai/v1/systemone')
      expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer secret')
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'jev-latest' })
      return new Response(JSON.stringify({
        model: 'jev-1.13.0',
        answers: {
          review_route: {
            type: 'choice',
            choice: 'standard_review',
            probabilities: { standard_review: 0.9, deep_review: 0.1 },
            confidence: 0.9,
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const service = createDecisionSupportFromEnv({
      ND_DECISION_SUPPORT_MODE: 'assist',
      TYPESAFE_API_KEY: 'secret',
    }, fetchImpl as typeof fetch)

    const receipt = await service?.reviewAssist(input)

    expect(receipt?.selectedProvider).toBe('jev')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('delegates cascade selection to the Rust kernel when selected', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: 'english',
      answers: {
        review_route: {
          type: 'choice',
          choice: 'standard_review',
          confidence: 0.91,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const request = vi.fn(async (method: string, params: any) => {
      expect(method).toBe('decision.evaluate')
      expect(params.providerCount).toBe(1)
      expect(params.attempts).toHaveLength(1)
      return {
        receipt: {
          purpose: params.purpose,
          mode: params.mode,
          threshold: params.threshold,
          attempts: params.attempts,
          selectedProvider: 'laya',
          escalated: false,
          createdAt: 123,
        },
        shouldContinue: false,
      }
    })
    const service = createDecisionSupportFromEnv({
      ND_DECISION_SUPPORT_MODE: 'assist',
      ND_DECISION_SUPPORT_RUNTIME: 'rust',
      ND_LAYA_SYSTEMONE_URL: 'http://127.0.0.1:8765',
    }, fetchImpl as typeof fetch, { request } as never)

    const receipt = await service?.reviewAssist(input)

    expect(receipt?.selectedProvider).toBe('laya')
    expect(receipt?.createdAt).toBe(123)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('falls back to the independent reviewer when the Rust kernel fails', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: 'english',
      answers: {
        review_route: {
          type: 'choice',
          choice: 'standard_review',
          confidence: 0.91,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const request = vi.fn(async () => {
      throw new Error('rust kernel unavailable')
    })
    const service = createDecisionSupportFromEnv({
      ND_DECISION_SUPPORT_MODE: 'assist',
      ND_DECISION_SUPPORT_RUNTIME: 'rust',
      ND_LAYA_SYSTEMONE_URL: 'http://127.0.0.1:8765',
    }, fetchImpl as typeof fetch, { request } as never)

    const receipt = await service?.reviewAssist(input)

    expect(receipt?.selectedProvider).toBeUndefined()
    expect(receipt?.kernelError).toContain('rust kernel unavailable')
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
