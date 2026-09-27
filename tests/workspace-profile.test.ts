import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_PROFILE,
  isWorkspaceProfile,
  WORKSPACE_PROFILES,
} from '../src/shared/workspace-profile.js'

describe('workspace profile contract', () => {
  it('starts fresh users in General', () => {
    expect(DEFAULT_WORKSPACE_PROFILE).toBe('general')
  })

  it('accepts only the two human-facing profiles', () => {
    expect(WORKSPACE_PROFILES).toEqual(['general', 'coding'])
    expect(isWorkspaceProfile('general')).toBe(true)
    expect(isWorkspaceProfile('coding')).toBe(true)
    expect(isWorkspaceProfile('workbench')).toBe(false)
    expect(isWorkspaceProfile('dsh')).toBe(false)
    expect(isWorkspaceProfile(undefined)).toBe(false)
  })
})
