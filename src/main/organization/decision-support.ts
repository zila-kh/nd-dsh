import {
  REVIEW_ASSIST_QUESTIONS,
  answerConfidence,
  reviewAssistState,
  type DecisionProvider,
  type DecisionProviderAttempt,
  type DecisionProviderResult,
  type DecisionQuestion,
  type DecisionSupportMode,
  type DecisionSupportReceipt,
  type ReviewAssistInput,
} from './decision-support-contract.js'

interface HttpDecisionProviderOptions {
  id: string
  endpoint: string
  model: string
  headers?: Record<string, string>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class HttpDecisionProvider implements DecisionProvider {
  readonly id: string
  private readonly endpoint: string
  private readonly model: string
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpDecisionProviderOptions) {
    this.id = options.id
    this.endpoint = normalizeEndpoint(options.endpoint)
    this.model = options.model
    this.headers = options.headers ?? {}
    this.timeoutMs = options.timeoutMs ?? 4_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<DecisionProviderResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    const startedAt = Date.now()
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify({ state, model: this.model, questions }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`${this.id} decision request failed with HTTP ${response.status}`)
      const payload = await response.json() as { model?: unknown; answers?: unknown }
      const answers = parseAnswers(payload.answers)
      return {
        provider: this.id,
        model: typeof payload.model === 'string' && payload.model ? payload.model : this.model,
        answers,
        latencyMs: Date.now() - startedAt,
        minimumConfidence: Math.min(...Object.values(answers).map(answerConfidence)),
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class DecisionSupportService {
  constructor(
    readonly mode: DecisionSupportMode,
    private readonly providers: DecisionProvider[],
    private readonly threshold = 0.78,
  ) {}

  async reviewAssist(input: ReviewAssistInput): Promise<DecisionSupportReceipt | undefined> {
    if (this.mode === 'off' || this.providers.length === 0) return undefined
    return this.evaluate('review-assist', reviewAssistState(input), REVIEW_ASSIST_QUESTIONS)
  }

  async evaluate(
    purpose: DecisionSupportReceipt['purpose'],
    state: unknown,
    questions: Record<string, DecisionQuestion>,
  ): Promise<DecisionSupportReceipt> {
    const attempts: DecisionProviderAttempt[] = []
    let selectedProvider: string | undefined
    let escalated = false

    for (let index = 0; index < this.providers.length; index++) {
      const provider = this.providers[index]!
      const attempt = await attemptProvider(provider, state, questions)
      attempts.push(attempt)

      if (this.mode === 'shadow') continue
      if (!attempt.ok || !attempt.result) {
        escalated = index < this.providers.length - 1
        continue
      }

      if (attempt.result.minimumConfidence >= this.threshold) {
        selectedProvider = provider.id
        break
      }

      escalated = index < this.providers.length - 1
    }

    return {
      purpose,
      mode: this.mode,
      threshold: this.threshold,
      attempts,
      ...(selectedProvider ? { selectedProvider } : {}),
      escalated,
      createdAt: Date.now(),
    }
  }
}

async function attemptProvider(
  provider: DecisionProvider,
  state: unknown,
  questions: Record<string, DecisionQuestion>,
): Promise<DecisionProviderAttempt> {
  try {
    return { provider: provider.id, ok: true, result: await provider.decide(state, questions) }
  } catch (error) {
    return {
      provider: provider.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseAnswers(value: unknown): DecisionProviderResult['answers'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Decision response has no answers object')
  const answers: DecisionProviderResult['answers'] = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid decision answer for ${key}`)
    const answer = raw as Record<string, unknown>
    const confidence = finite(answer.confidence) ? answer.confidence : undefined
    const probabilities = numberRecord(answer.probabilities)

    if (answer.type === 'choice' && typeof answer.choice === 'string') {
      answers[key] = {
        type: 'choice',
        choice: answer.choice,
        ...(confidence === undefined ? {} : { confidence }),
        ...(probabilities ? { probabilities } : {}),
      }
      continue
    }
    if (answer.type === 'score' && finite(answer.score)) {
      answers[key] = {
        type: 'score',
        score: answer.score,
        ...(confidence === undefined ? {} : { confidence }),
        ...(probabilities ? { probabilities } : {}),
      }
      continue
    }
    if (answer.type === 'noul' && finite(answer.noul)) {
      answers[key] = {
        type: 'noul',
        noul: answer.noul,
        ...(confidence === undefined ? {} : { confidence }),
      }
      continue
    }
    throw new Error(`Unsupported decision answer for ${key}`)
  }
  if (Object.keys(answers).length === 0) throw new Error('Decision response returned no answers')
  return answers
}

function numberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.every(([, item]) => finite(item))) return undefined
  return Object.fromEntries(entries) as Record<string, number>
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, '')
  if (!endpoint) throw new Error('Decision provider endpoint is empty')
  return endpoint.endsWith('/v1/systemone') ? endpoint : `${endpoint}/v1/systemone`
}
