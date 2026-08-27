import type { ProjectPlanInput } from './organization.js'

export interface ReviewVerdict {
  verdict: 'pass' | 'fail'
  summary: string
  issues?: string[]
  memory?: Array<{ title: string; content: string; tags?: string[] }>
}

export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'review'; review: ReviewVerdict }
  | { kind: 'plan'; plan: ProjectPlanInput }

const TAGGED_BLOCK_PATTERN = /<(nd-dsh-review|nd-dsh-plan)>\s*([\s\S]*?)\s*<\/\1>/g

function parseTaggedBody<T>(raw: string): T | undefined {
  let body = raw.trim()
  if (body.startsWith('```')) body = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(body) as T
  } catch {
    return undefined
  }
}

/**
 * Splits an assistant message into plain-text segments and structured
 * protocol blocks (review verdicts, project plans) so the chat can render
 * cards instead of raw tagged JSON. Blocks whose JSON is malformed or not
 * yet fully streamed stay as plain text.
 */
export function splitAssistantSegments(text: string): AssistantSegment[] {
  const segments: AssistantSegment[] = []
  let cursor = 0
  for (const match of text.matchAll(TAGGED_BLOCK_PATTERN)) {
    const before = text.slice(cursor, match.index)
    if (before.trim()) segments.push({ kind: 'text', text: before.trim() })
    cursor = (match.index ?? 0) + match[0].length
    const tag = match[1]
    const body = match[2] ?? ''
    if (tag === 'nd-dsh-review') {
      const review = parseTaggedBody<ReviewVerdict>(body)
      if (review && (review.verdict === 'pass' || review.verdict === 'fail') && typeof review.summary === 'string') {
        segments.push({ kind: 'review', review })
        continue
      }
    } else {
      const plan = parseTaggedBody<ProjectPlanInput>(body)
      if (plan?.goal?.title && Array.isArray(plan.milestones) && plan.milestones.length > 0) {
        segments.push({ kind: 'plan', plan })
        continue
      }
    }
    if (body.trim()) segments.push({ kind: 'text', text: body.trim() })
  }
  const tail = text.slice(cursor)
  if (tail.trim()) segments.push({ kind: 'text', text: tail.trim() })
  return segments
}
