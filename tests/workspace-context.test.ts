import { describe, expect, it } from 'vitest'
import type { WorkspaceState } from '../src/shared/contracts.js'
import { appendWorkspaceContext, stripWorkspaceContext, workspaceContextForPersona } from '../src/shared/workspace-context.js'

const todoWorkspace: WorkspaceState = {
  root: 'C:/workspaces/todo',
  name: 'todo',
  binding: 'project',
  companyId: 'company-1',
  companyName: 'Northstar',
  companyMission: 'Make everyday work simpler.',
  projectId: 'project-1',
  projectName: 'Todo app',
  projectObjective: 'Build a focused task-management app for small teams.',
  projectStatus: 'active',
  projectWorkspacePath: 'C:/workspaces/todo',
}

describe('workspace prompt context', () => {
  it('gives Harness the active project description and exact working directory', () => {
    const prompt = appendWorkspaceContext('What is this project about?', todoWorkspace)

    expect(prompt).toContain('What is this project about?')
    expect(prompt).toContain('"workingDirectory": "C:/workspaces/todo"')
    expect(prompt).toContain('"projectName": "Todo app"')
    expect(prompt).toContain('"projectObjective": "Build a focused task-management app for small teams."')
    expect(prompt).toContain('If the user asks what the project is about')
  })

  it('removes the ND-only block from renderer-visible history', () => {
    const prompt = appendWorkspaceContext('Show the project files.', todoWorkspace)
    expect(stripWorkspaceContext(prompt)).toBe('Show the project files.')
  })

  it('renders the same project facts for the embedded DSH persona', () => {
    const personaContext = workspaceContextForPersona({
      ...todoWorkspace,
      projectObjective: 'Keep template text like {{cwd}} as data.',
    })

    expect(personaContext).toContain('"workingDirectory": "C:/workspaces/todo"')
    expect(personaContext).toContain('"projectObjective": "Keep template text like { {cwd}} as data."')
    expect(personaContext).toContain('Use projectObjective when the user asks what the project is about')
  })
})
