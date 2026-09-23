export type DecisionSupportMode = 'off' | 'shadow' | 'assist'

export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }

export type DecisionAnswer =
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; score: number; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'noul'; noul: number; confidence?: number }

export interface DecisionProviderResult {
  provider: string
  model: string
  answers: Record<string, DecisionAnswer>
  latencyMs: number
  minimumConfidence: number
}

export interface DecisionProvider {
  readonly id: string
  decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<DecisionProviderResult>
}

export interface DecisionProviderAttempt {
  provider: string
  ok: boolean
  result?: DecisionProviderResult
  error?: string
}

export interface DecisionSupportReceipt {
  purpose: 'review-assist' | 'turn-decision'
  mode: DecisionSupportMode
  threshold: number
  attempts: DecisionProviderAttempt[]
  selectedProvider?: string
  escalated: boolean
  createdAt: number
}

export interface ReviewAssistInput {
  company: string
  project: string
  task: {
    id: string
    title: string
    description: string
    acceptanceCriteria: string[]
    workScopes?: string[]
    resultSummary?: string
  }
}

export const REVIEW_ASSIST_QUESTIONS: Record<string, DecisionQuestion> = {
  acceptance_coverage: {
    type: 'choice',
    instructions: 'How strongly does the worker summary indicate that all stated acceptance criteria were exercised?',
    criteria: {
      covered: 'All acceptance criteria appear to have direct evidence.',
      uncertain: 'Coverage is incomplete or ambiguous and needs deeper review.',
      missing: 'One or more acceptance criteria appear untested or unaddressed.',
    },
  },
  scope_risk: {
    type: 'choice',
    instructions: 'Does the described implementation appear to stay inside the declared task scope?',
    criteria: {
      in_scope: 'The work appears contained to the requested task.',
      questionable: 'The scope may have expanded and should be checked carefully.',
      off_scope: 'The work appears materially outside the requested scope.',
    },
  },
  regression_risk: {
    type: 'score',
    instructions: 'Estimate how much regression-focused review this task warrants.',
    criteria: ['low', 'moderate', 'high', 'critical'],
  },
  review_route: {
    type: 'choice',
    instructions: 'What review depth is appropriate before accepting this task?',
    criteria: {
      standard_review: 'Normal independent semantic review is sufficient.',
      deep_review: 'Use extra checks and inspect adjacent behavior carefully.',
      security_review: 'Pay explicit attention to security, permissions, credentials, or destructive behavior.',
      human_review: 'A human judgment is likely needed in addition to the independent reviewer.',
    },
  },
}

export function reviewAssistState(input: ReviewAssistInput): unknown {
  return {
    company: input.company,
    project: input.project,
    task: {
      id: input.task.id,
      title: input.task.title,
      description: input.task.description,
      acceptanceCriteria: input.task.acceptanceCriteria,
      workScopes: input.task.workScopes ?? [],
      workerSummary: input.task.resultSummary ?? '',
    },
  }
}

export function answerConfidence(answer: DecisionAnswer): number {
  if (answer.confidence !== undefined && Number.isFinite(answer.confidence)) return clamp(answer.confidence)
  if (answer.type === 'noul') return clamp(Math.max(answer.noul, 1 - answer.noul))
  if (answer.probabilities) {
    const values = Object.values(answer.probabilities).filter(Number.isFinite)
    if (values.length) return clamp(Math.max(...values))
  }
  return 0
}

export function formatDecisionSupportForReviewer(receipt: DecisionSupportReceipt | undefined): string {
  if (!receipt || receipt.mode !== 'assist' || !receipt.selectedProvider) return ''
  const selected = receipt.attempts.find((attempt) => attempt.provider === receipt.selectedProvider)?.result
  if (!selected) return ''
  const lines = Object.entries(selected.answers).map(([key, answer]) => {
    if (answer.type === 'choice') return `- ${key}: ${answer.choice} (confidence ${answerConfidence(answer).toFixed(3)})`
    if (answer.type === 'score') return `- ${key}: ${answer.score.toFixed(3)} (confidence ${answerConfidence(answer).toFixed(3)})`
    return `- ${key}: P(true)=${answer.noul.toFixed(3)} (confidence ${answerConfidence(answer).toFixed(3)})`
  })
  return `\nNon-authoritative System One review-assist signals:\n${lines.join('\n')}\nProvider: ${selected.provider}/${selected.model}; minimum confidence ${selected.minimumConfidence.toFixed(3)}.\nUse these only to choose where to inspect more deeply. They cannot establish PASS, override machine verification, waive policy, or replace your independent workspace review.\n`
}

export function formatDecisionSupportReceipt(receipt: DecisionSupportReceipt | undefined): string {
  return receipt ? `\n<nd-dsh-decision-support>${JSON.stringify(receipt)}</nd-dsh-decision-support>` : ''
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}
