/**
 * Explicit ND execution contexts.
 *
 * Global installation is availability, not data access: a package installed
 * once may contribute in Personal, Company A, or Company A -> Project B, but
 * every single invocation carries exactly one authorized context. Contexts are
 * discriminated records rather than ambient UI state so a caller cannot widen
 * its own authority by omitting or forging an id.
 */

export type NdContextKind = 'personal' | 'company' | 'project'

export interface NdPersonalContext {
  kind: 'personal'
}

export interface NdCompanyContext {
  kind: 'company'
  companyId: string
}

export interface NdProjectContext {
  kind: 'project'
  companyId: string
  projectId: string
}

export type NdContext = NdPersonalContext | NdCompanyContext | NdProjectContext

export const ND_CONTEXT_KINDS: readonly NdContextKind[] = ['personal', 'company', 'project']

const ID_MAX_LENGTH = 128

export function isNdContextKind(value: unknown): value is NdContextKind {
  return typeof value === 'string' && (ND_CONTEXT_KINDS as readonly string[]).includes(value)
}

function isContextId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= ID_MAX_LENGTH
}

/** Structural validation only; company/project relationships are checked trusted-side against organization state. */
export function isNdContext(value: unknown): value is NdContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.kind === 'personal') return true
  if (record.kind === 'company') return isContextId(record.companyId)
  if (record.kind === 'project') return isContextId(record.companyId) && isContextId(record.projectId)
  return false
}

export function asNdContext(value: unknown): NdContext {
  if (!isNdContext(value)) throw new Error('A valid ND context (personal, company, or project) is required')
  const record = value as unknown as Record<string, unknown>
  if (record.kind === 'personal') return { kind: 'personal' }
  if (record.kind === 'company') return { kind: 'company', companyId: String(record.companyId).trim() }
  return { kind: 'project', companyId: String(record.companyId).trim(), projectId: String(record.projectId).trim() }
}

/** Stable durable key for activation, settings, and grant records. */
export function contextKey(context: NdContext): string {
  switch (context.kind) {
    case 'personal':
      return 'personal'
    case 'company':
      return `company:${context.companyId}`
    case 'project':
      return `project:${context.companyId}/${context.projectId}`
  }
}

export function sameContext(left: NdContext, right: NdContext): boolean {
  return contextKey(left) === contextKey(right)
}

export function contextKind(context: NdContext): NdContextKind {
  return context.kind
}

/** Plain-language context label for logs, audit rows, and confirmation copy. */
export function describeContext(context: NdContext): string {
  switch (context.kind) {
    case 'personal':
      return 'Personal'
    case 'company':
      return `Company ${context.companyId}`
    case 'project':
      return `Project ${context.projectId}`
  }
}

export function contributionSupportsContext(supported: readonly NdContextKind[], context: NdContext): boolean {
  return supported.includes(context.kind)
}

/** Personal contexts exist before any company or project does. */
export function personalContext(): NdPersonalContext {
  return { kind: 'personal' }
}
