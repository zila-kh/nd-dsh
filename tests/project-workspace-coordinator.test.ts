import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'
import { ProjectWorkspaceCoordinator } from '../src/main/workspace/project-workspace-coordinator.js'
import { WorkspaceRegistry } from '../src/main/workspace/workspace-registry.js'
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

  it('stops naming a project whose record was removed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-dsh-removed-project-'))
    roots.push(root)
    const projectRoot = join(root, 'todo')
    await mkdir(projectRoot)
    const store = new OrganizationStore(join(root, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Northstar', mission: 'Make work simpler.' })
    const company = state.companies[0]!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Todo app', objective: 'Build tasks.', workspacePath: projectRoot })
    const project = state.projects[0]!
    const workspace = new WorkspaceService(root)
    const coordinator = new ProjectWorkspaceCoordinator(store, workspace, { close: async () => undefined } as never)
    await coordinator.initialize()
    expect(workspace.state().projectName).toBe('Todo app')

    const after = await store.mutate({ type: 'project.remove', id: project.id })
    await coordinator.afterOrganizationMutation({ type: 'project.remove', id: project.id }, after)

    // No project is left, so the open folder is just a folder again.
    expect(workspace.state().binding).toBe('standalone')
    expect(workspace.state().projectName).toBeUndefined()
  })

  it('refuses to prune the workspace that is open while a run is working in it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-dsh-remove-saved-'))
    roots.push(root)
    const openRoot = join(root, 'open')
    const otherRoot = join(root, 'other')
    await mkdir(openRoot)
    await mkdir(otherRoot)
    const registry = new WorkspaceRegistry(join(root, 'workspaces.json'))
    const openEntry = (await registry.add(openRoot)).items.find((item) => item.root === openRoot)!
    const otherEntry = (await registry.add(otherRoot)).items.find((item) => item.root === otherRoot)!
    const store = new OrganizationStore(join(root, 'organization.json'))
    const created = await store.mutate({ type: 'company.create', name: 'Northstar', mission: 'Make work simpler.' })
    const companyId = created.companies[0]!.id
    const withProject = await store.mutate({ type: 'project.create', companyId, name: 'Open app', objective: 'Ship', workspacePath: openRoot })
    const projectId = withProject.projects[0]!.id
    const workspace = new WorkspaceService(openRoot)
    const coordinator = new ProjectWorkspaceCoordinator(store, workspace, { close: async () => undefined } as never, registry)
    const run = await store.beginRun('task-execution', companyId, projectId, 'session-live')

    // Another folder can always be pruned; the folder an agent is working in cannot.
    await expect(coordinator.removeSavedWorkspace(otherEntry.id)).resolves.toMatchObject({ items: expect.any(Array) })
    await expect(coordinator.removeSavedWorkspace(openEntry.id)).rejects.toThrow(/Cannot remove the workspace that is currently open/)
    expect((await registry.list()).items.map((item) => item.id)).toEqual([openEntry.id])

    await store.completeRun(run.id, 'done')
    await coordinator.removeSavedWorkspace(openEntry.id)
    expect((await registry.list()).items).toHaveLength(0)
  })
})
