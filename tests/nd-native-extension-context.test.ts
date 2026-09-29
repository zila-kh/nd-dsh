import { describe, expect, it } from 'vitest'
import type { OrganizationSnapshot } from '../src/shared/organization.js'
import { nativeExtensionProjectContext } from '../src/main/engines/nd-native/native-extension-context.js'

function snapshot(overrides: Partial<OrganizationSnapshot> = {}): OrganizationSnapshot {
  return {
    version: 1,
    activeCompanyId: 'company-b',
    activeProjectId: 'project-b',
    companies: [],
    projects: [
      { id: 'project-a', companyId: 'company-a' } as never,
      { id: 'project-b', companyId: 'company-b' } as never,
    ],
    roles: [],
    teams: [],
    agents: [],
    skills: [],
    workflows: [],
    goals: [],
    milestones: [],
    tasks: [],
    memory: [],
    policies: [],
    activity: [],
    runs: [],
    coordination: [],
    ...overrides,
  }
}

describe('ND Agent extension project context', () => {
  it('uses the organization run that owns a task worktree instead of ambient UI selection', () => {
    const state = snapshot({
      runs: [{
        id: 'run-a',
        companyId: 'company-a',
        projectId: 'project-a',
        kind: 'execute',
        status: 'running',
        sessionId: 'nd-native-one',
        engineId: 'nd-native',
        workspaceKind: 'worktree',
        workspaceRoot: 'C:/worktrees/project-a/task-1',
        startedAt: 10,
      } as never],
    })
    expect(nativeExtensionProjectContext(state, 'nd-native-one', 'C:/worktrees/project-a/task-1')).toEqual({
      kind: 'project',
      companyId: 'company-a',
      projectId: 'project-a',
    })
  })

  it('rejects a run whose recorded worktree does not match the native session cwd', () => {
    const state = snapshot({
      runs: [{
        id: 'run-a',
        companyId: 'company-a',
        projectId: 'project-a',
        kind: 'execute',
        status: 'running',
        sessionId: 'nd-native-one',
        engineId: 'nd-native',
        workspaceRoot: 'C:/worktrees/project-a/task-1',
        startedAt: 10,
      } as never],
    })
    expect(() => nativeExtensionProjectContext(state, 'nd-native-one', 'C:/worktrees/project-a/task-2'))
      .toThrow(/does not match the session worktree/)
  })

  it('uses the active project only for an interactive session with no organization run', () => {
    expect(nativeExtensionProjectContext(snapshot(), 'nd-native-chat', 'C:/projects/b')).toEqual({
      kind: 'project',
      companyId: 'company-b',
      projectId: 'project-b',
    })
  })
})
