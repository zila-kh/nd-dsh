/**
 * Human-facing ND workspace profiles.
 *
 * This is intentionally orthogonal to Personal/Company/Project context,
 * permission mode, and organization execution state. Switching profile only
 * changes which product surfaces are presented to the human.
 */
export const WORKSPACE_PROFILES = ['general', 'coding'] as const

export type WorkspaceProfile = (typeof WORKSPACE_PROFILES)[number]

/** Fresh installs start broad; legacy settings are migrated to Coding in ThemeService. */
export const DEFAULT_WORKSPACE_PROFILE: WorkspaceProfile = 'general'

export function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  return value === 'general' || value === 'coding'
}
