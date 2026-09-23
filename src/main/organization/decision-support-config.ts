import { DecisionSupportService, HttpDecisionProvider } from './decision-support.js'
import type { DecisionSupportMode } from './decision-support-contract.js'

export function createDecisionSupportFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): DecisionSupportService | undefined {
  const mode = parseMode(env.ND_DECISION_SUPPORT_MODE)
  if (mode === 'off') return undefined

  const timeoutMs = positiveNumber(env.ND_DECISION_SUPPORT_TIMEOUT_MS, 4_000)
  const providers: HttpDecisionProvider[] = []

  const layaUrl = env.ND_LAYA_SYSTEMONE_URL?.trim()
  if (layaUrl) {
    const layaModel = env.ND_LAYA_MODEL?.trim()
    providers.push(new HttpDecisionProvider({
      id: 'laya',
      endpoint: layaUrl,
      ...(layaModel ? { model: layaModel } : {}),
      timeoutMs,
      fetchImpl,
    }))
  }

  const jevKey = env.ND_JEV_API_KEY?.trim() || env.TYPESAFE_API_KEY?.trim()
  if (jevKey) {
    providers.push(new HttpDecisionProvider({
      id: 'jev',
      endpoint: env.ND_JEV_SYSTEMONE_URL?.trim() || 'https://api.typesafe.ai/v1/systemone',
      model: env.ND_JEV_MODEL?.trim() || 'jev-latest',
      headers: { authorization: `Bearer ${jevKey}` },
      timeoutMs,
      fetchImpl,
    }))
  }

  if (providers.length === 0) return undefined
  return new DecisionSupportService(
    mode,
    providers,
    probability(env.ND_DECISION_SUPPORT_CONFIDENCE, 0.78),
  )
}

function parseMode(value: string | undefined): DecisionSupportMode {
  const mode = value?.trim().toLowerCase()
  if (!mode || mode === 'off') return 'off'
  if (mode === 'shadow' || mode === 'assist') return mode
  throw new Error('ND_DECISION_SUPPORT_MODE must be off, shadow, or assist')
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function probability(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback
}
