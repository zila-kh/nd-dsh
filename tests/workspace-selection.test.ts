import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRegistry } from '../src/main/workspace/workspace-registry.js'
import { WorkspaceService } from '../src/main/workspace/workspace-service.js'

// The folder picker is the only place the user hands ND a root, so the service
// is driven through a stub dialog instead of a real one.
const picker = vi.hoisted(() => ({ canceled: false, filePaths: [] as string[] }))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: async () => ({ canceled: picker.canceled, filePaths: picker.filePaths }) },
}))

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function scratchRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nd-dsh-workspace-selection-'))
  roots.push(root)
  return root
}

describe('workspace selection', () => {
  it('never presents the boot fallback root as a project', async () => {
    const boot = await scratchRoot()
    const service = new WorkspaceService(boot)

    expect(service.state()).toMatchObject({ root: resolve(boot), binding: 'standalone', selectedByUser: false })
  })

  it('marks the folder the user picked in the dialog as selected', async () => {
    const boot = await scratchRoot()
    const picked = await scratchRoot()
    const service = new WorkspaceService(boot)
    picker.canceled = false
    picker.filePaths = [picked]

    expect(await service.pick()).toMatchObject({ root: resolve(picked), selectedByUser: true })
  })

  it('keeps the boot root unselected when the user cancels the dialog', async () => {
    const boot = await scratchRoot()
    const service = new WorkspaceService(boot)
    picker.canceled = true
    picker.filePaths = []

    expect(await service.pick()).toMatchObject({ root: resolve(boot), selectedByUser: false })
  })

  it('treats an explicitly switched root as a selection', async () => {
    const boot = await scratchRoot()
    const opened = await scratchRoot()
    const service = new WorkspaceService(boot)

    await service.setRoot(opened)

    expect(service.state()).toMatchObject({ root: resolve(opened), selectedByUser: true })
  })

  it('treats an organization project binding as a selection', async () => {
    const boot = await scratchRoot()
    const service = new WorkspaceService(boot)

    service.setContext({ binding: 'project', projectId: 'project-1', projectName: 'Todo app' })

    expect(service.state()).toMatchObject({ binding: 'project', projectName: 'Todo app', selectedByUser: true })
  })
})

describe('WorkspaceRegistry.activateSaved', () => {
  it('never pins the root the app booted with', async () => {
    const root = await scratchRoot()
    const registry = new WorkspaceRegistry(join(root, 'workspaces.json'))

    const view = await registry.activateSaved(join(root, 'boot'))

    expect(view.items).toHaveLength(0)
    expect(view.activeId).toBeUndefined()
  })

  it('activates a folder the user saved earlier without adding entries', async () => {
    const root = await scratchRoot()
    const saved = join(root, 'app')
    await mkdir(saved)
    const registry = new WorkspaceRegistry(join(root, 'workspaces.json'))
    const added = await registry.add(saved)
    const entry = added.items.find((item) => item.root === saved)
    expect(entry).toBeDefined()

    const activated = await registry.activateSaved(saved)

    expect(activated.activeId).toBe(entry?.id)
    expect(activated.items.map((item) => item.id)).toEqual([entry?.id])
  })
})
