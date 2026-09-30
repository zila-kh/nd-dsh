import { describe, expect, it } from 'vitest'
import type { WorkspaceState } from '../../../shared/contracts.js'
import { isWorkspaceSelected } from './workspace-selection'

function state(patch: Partial<WorkspaceState>): WorkspaceState {
  return { root: 'C:\\repo\\app', name: 'app', ...patch }
}

describe('isWorkspaceSelected', () => {
  it('treats an unknown workspace as not selected', () => {
    expect(isWorkspaceSelected(null)).toBe(false)
    expect(isWorkspaceSelected(undefined)).toBe(false)
  })

  it('keeps the boot fallback root unselected', () => {
    expect(isWorkspaceSelected(state({ binding: 'standalone', selectedByUser: false }))).toBe(false)
  })

  it('accepts a folder the user picked even without an organization binding', () => {
    expect(isWorkspaceSelected(state({ binding: 'standalone', selectedByUser: true }))).toBe(true)
  })

  it('selects a project workspace even when the optional flag never arrives', () => {
    expect(isWorkspaceSelected(state({ binding: 'project', projectId: 'project-1', projectName: 'toktok clone' }))).toBe(true)
    expect(isWorkspaceSelected(state({ binding: 'unlinked', projectId: 'project-1' }))).toBe(true)
    expect(isWorkspaceSelected(state({ binding: 'missing', projectId: 'project-1' }))).toBe(true)
  })

  it('stays conservative when neither the flag nor the binding is present', () => {
    expect(isWorkspaceSelected(state({}))).toBe(false)
  })
})
