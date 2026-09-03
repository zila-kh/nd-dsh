import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'
import { ProjectWorkspaceCoordinator } from '../src/main/workspace/project-workspace-coordinator.js'
import { WorkspaceService } from '../src/main/workspace/workspace-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ProjectWorkspaceCoordinator', () => {
  it('keeps Harness project metadata synchronized when the active project changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-dsh-project-context-'))
    roots.push(root)
    const projectRoot = join(root, 'todo')
    await mkdir(projectRoot)
    const store = new OrganizationStore(join(root, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Northstar', mission: 'Make work simpler.' })
    const company = state.companies[0]!
    state = await store.mutate({
      type: 'project.create',
      companyId: company.id,
      name: 'Todo app',
      objective: 'Build a focused task-management app.',
      workspacePath: projectRoot,
    })
    const project = state.projects[0]!
    const workspace = new WorkspaceService(root)
    const harness = { close: async () => undefined }
    const coordinator = new ProjectWorkspaceCoordinator(store, workspace, harness as never)

    await coordinator.initialize()
    expect(workspace.state()).toMatchObject({
      binding: 'project',
      projectName: 'Todo app',
      projectObjective: 'Build a focused task-management app.',
      companyMission: 'Make work simpler.',
      projectWorkspacePath: projectRoot,
      root: projectRoot,
    })

    const updated = await store.mutate({ type: 'project.update', id: project.id, patch: { objective: 'Help small teams track work.' } })
    await coordinator.afterOrganizationMutation({ type: 'project.update', id: project.id, patch: { objective: 'Help small teams track work.' } }, updated)
    expect(workspace.state().projectObjective).toBe('Help small teams track work.')
  })

  it('does not let an unlinked project reuse the previous project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-dsh-unlinked-project-'))
    roots.push(root)
    const projectRoot = join(root, 'todo')
    await mkdir(projectRoot)
    const store = new OrganizationStore(join(root, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Northstar', mission: 'Make work simpler.' })
    const company = state.companies[0]!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Todo app', objective: 'Build tasks.', workspacePath: projectRoot })
    const firstProject = state.projects[0]!
    const workspace = new WorkspaceService(root)
    const coordinator = new ProjectWorkspaceCoordinator(store, workspace, { close: async () => undefined } as never)
    await coordinator.initialize()

    const next = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Unlinked app', objective: 'Needs a folder.' })
    const secondProject = next.projects.find((item) => item.id !== firstProject.id)!
    await coordinator.afterOrganizationMutation({ type: 'project.create', companyId: company.id, name: 'Unlinked app', objective: 'Needs a folder.' }, next)

    expect(workspace.state()).toMatchObject({ binding: 'unlinked', projectId: secondProject.id, root: projectRoot })
    expect(workspace.isUsable()).toBe(false)
    expect(() => workspace.assertUsable()).toThrow(/no workspace linked/i)
  })
})
