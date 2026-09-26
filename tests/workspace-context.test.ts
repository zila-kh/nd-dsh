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
    expect(prompt).toContain('do not substitute the parent repository for this project')
  })

  it('removes the ND-only block from renderer-visible history', () => {
    const prompt = appendWorkspaceContext('Show the project files.', todoWorkspace)
    expect(stripWorkspaceContext(prompt)).toBe('Show the project files.')
  })

  it('removes injected nd tags such as nd-browser-context and nd-browser-access', () => {
    const prompt = 'hi\n\n<nd-browser-context>\nND exposes one unified browser capability...\n</nd-browser-context>\n\n<nd-browser-access>\nOpaque token\n</nd-browser-access>'
    expect(stripWorkspaceContext(prompt)).toBe('hi')
  })

  it('keeps per-session and per-turn facts out of the persona', () => {
    const personaContext = workspaceContextForPersona({
      ...todoWorkspace,
      projectObjective: 'Keep template text like {{cwd}} as data.',
      projectStatus: 'in progress',
      warning: 'The workspace folder moved.',
    })

    expect(personaContext).toContain('"projectName": "Todo app"')
    expect(personaContext).toContain('"projectObjective": "Keep template text like { {cwd}} as data."')
    expect(personaContext).toContain('Use projectObjective when the user asks what the project is about')
    // The persona is the first system-prompt section: a value that varies per
    // session (the working directory differs per task worktree) or per turn
    // (status, warnings) would invalidate the provider's cached prefix from its
    // first token, including the tool catalog and all conversation history.
    expect(personaContext).not.toContain('workingDirectory')
    expect(personaContext).not.toContain('projectStatus')
    expect(personaContext).not.toContain('warning')
  })

  it('still carries the moving facts on the appended per-turn context', () => {
    const prompt = appendWorkspaceContext('Ship it.', {
      ...todoWorkspace,
      projectStatus: 'review',
      warning: 'The workspace folder moved.',
    })

    expect(prompt).toContain('"workingDirectory": "C:/workspaces/todo"')
    expect(prompt).toContain('"projectStatus": "review"')
    expect(prompt).toContain('"warning": "The workspace folder moved."')
  })
})
