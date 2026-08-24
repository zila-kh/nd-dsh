import { describe, expect, it } from 'vitest'
import { legacyEscapedWorkspacePath } from '../src/main/workspace/workspace-registry.js'

describe('legacyEscapedWorkspacePath', () => {
  it('matches the historical escaped representation of a Windows workspace path', () => {
    const root = String.raw`C:\Users\MT-Staff\Documents\GitHub\nd-dsh\examples\todo`
    expect(legacyEscapedWorkspacePath(root)).toBe(`C:UsersMT-StaffDocumentsGitHub d-dshexamples\todo`)
  })
})
