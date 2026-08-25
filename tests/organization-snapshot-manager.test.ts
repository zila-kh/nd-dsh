import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationSnapshotManager } from '../src/main/organization/snapshot-manager.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nd-company-snapshot-'))
  roots.push(root)
  await writeFile(join(root, 'organization.json'), JSON.stringify({ version: 1, marker: 'before' }))
  await writeFile(join(root, 'organization-control.json'), JSON.stringify({ version: 1, turns: [] }))
  await writeFile(join(root, 'organization-strategy.json'), JSON.stringify({ version: 1, anchors: [] }))
  return { root, manager: new OrganizationSnapshotManager(root) }
}

describe('OrganizationSnapshotManager', () => {
  it('captures all available company state authorities', async () => {
    const { manager } = await fixture()
    const snapshot = await manager.create('Before autopilot migration')
    expect(snapshot.files).toEqual([
      'organization.json',
      'organization-control.json',
      'organization-strategy.json',
    ])
    const listed = await manager.list()
    expect(listed[0]?.label).toBe('Before autopilot migration')
    expect(listed[0]?.restorePending).toBe(false)
  })

  it('restores a selected snapshot before stores load on the next launch', async () => {
    const { root, manager } = await fixture()
    const snapshot = await manager.create('Known good state')
    await writeFile(join(root, 'organization.json'), JSON.stringify({ version: 1, marker: 'after' }))
    await manager.restoreOnNextLaunch(snapshot.id)
    expect((await manager.list())[0]?.restorePending).toBe(true)

    const restoredId = await manager.applyPendingRestore()
    expect(restoredId).toBe(snapshot.id)
    expect(await readFile(join(root, 'organization.json'), 'utf8')).toContain('before')
    expect((await manager.list())[0]?.restorePending).toBe(false)
  })

  it('can cancel a scheduled restore without touching current state', async () => {
    const { root, manager } = await fixture()
    const snapshot = await manager.create('Safe point')
    await manager.restoreOnNextLaunch(snapshot.id)
    await manager.cancelRestore()
    expect((await manager.list())[0]?.restorePending).toBe(false)
    expect(await readFile(join(root, 'organization.json'), 'utf8')).toContain('before')
  })
})
