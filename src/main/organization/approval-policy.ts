export type RuntimePolicyAction =
  | 'external.publish'
  | 'production.deploy'
  | 'money.spend'
  | 'data.destructive'
  | 'runtime.escalation'

/**
 * Conservative classification for Harness approval frames. The pinned gateway
 * deliberately exposes toolName/reason rather than arbitrary tool arguments,
 * so uncertain requests stay on the generic human-reviewed escalation policy.
 */
export function classifyRuntimeApproval(toolName: string | undefined, reason: string | undefined): RuntimePolicyAction {
  const text = `${toolName ?? ''} ${reason ?? ''}`.toLowerCase()

  if (/\b(terraform\s+destroy|drop\s+(?:database|schema|table)|truncate\s+table|delete\s+from|rm\s+-rf|kubectl\s+delete|destroy\s+(?:prod|production)|delete\s+(?:prod|production))\b/.test(text)) {
    return 'data.destructive'
  }

  if (/\b(?:prod|production)\b[\s\S]{0,80}\b(?:deploy|release|publish|push|apply)\b/.test(text)
    || /\b(?:deploy|release)\b[\s\S]{0,80}\b(?:prod|production)\b/.test(text)) {
    return 'production.deploy'
  }

  if (/\b(?:purchase|buy|payment|charge\s+(?:card|customer)|spend\s+money|paid\s+action|billing\s+purchase)\b/.test(text)) {
    return 'money.spend'
  }

  if (/\b(?:git\s+push|gh\s+pr\s+create|publish\s+(?:post|message|article|package)|send\s+(?:email|message)|post\s+externally|external\s+publish)\b/.test(text)) {
    return 'external.publish'
  }

  return 'runtime.escalation'
}
