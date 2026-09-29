import { describe, expect, it } from 'vitest'
import { ProcessInventory, readProcesses, type ProcessSnapshot } from '../src/main/os/process-inventory.js'
import { validateNdExtensionManifest, manifestPermissionIssues } from '../src/shared/extension-package.js'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExtensionPackageStore } from '../src/main/extensions/package-store.js'

const manifestPath = new URL('../extensions/quit-process/nd-extension.json', import.meta.url)
const packagePath = fileURLToPath(new URL('../extensions/quit-process/', import.meta.url))

describe('Quit Processes ND extension', () => {
  it.skipIf(process.platform !== 'win32')('enumerates Windows processes through the fixed OS adapter', async () => {
    const rows = await readProcesses()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((row) => row.pid === process.pid && row.started.length > 0)).toBe(true)
  })

  it('uses a valid personal-only package with read and quit permissions', async () => {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    const result = validateNdExtensionManifest(parsed)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(manifestPermissionIssues(result.manifest)).toEqual([])
    expect(result.manifest.contexts).toEqual(['personal'])
    expect(result.manifest.permissions).toEqual(['process.read', 'process.quit'])
    expect(result.manifest.contributions.commands[0]?.openViewId).toBe('processes')
    expect(result.manifest.contributions.views[0]?.refreshIntervalMs).toBe(3000)
  })

  it('installs only when selected and snapshots the bundled package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-quit-process-'))
    try {
      const packages = new ExtensionPackageStore(root)
      expect(await packages.list()).toEqual([])
      const installed = await packages.installFromDirectory(packagePath, { expectId: 'nd.quit-process' })
      expect(installed.id).toBe('nd.quit-process')
      expect((await packages.activeManifest('nd.quit-process'))?.contributions.views[0]?.id).toBe('processes')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a stale process identity before sending a quit signal', async () => {
    let rows: ProcessSnapshot[] = [{ pid: 8201, name: 'example', started: 'first', memoryBytes: 1_000 }]
    const killed: number[] = []
    const inventory = new ProcessInventory(async () => rows, () => [], async (pid) => { killed.push(pid) })
    const [selected] = await inventory.list()
    expect(selected?.detail).toContain('PID 8201')
    rows = [{ pid: 8201, name: 'example', started: 'replacement', memoryBytes: 1_000 }]
    await expect(inventory.quit(selected!.id, false)).rejects.toThrow(/changed or exited/)
    expect(killed).toEqual([])
  })

  it('blocks ND and unverifiable processes and preserves force choice', async () => {
    const rows: ProcessSnapshot[] = [
      { pid: 8201, name: 'nd', started: 'one', memoryBytes: 1_000 },
      { pid: 8202, name: 'protected', started: '', memoryBytes: 1_000 },
      { pid: 8203, name: 'app', started: 'three', memoryBytes: 1_000 },
    ]
    const killed: Array<[number, boolean]> = []
    const inventory = new ProcessInventory(async () => rows, () => [8201], async (pid, force) => { killed.push([pid, force]) })
    const listed = await inventory.list()
    expect(listed.find((row) => row.title === 'nd')?.actionsDisabled).toBe(true)
    expect(listed.find((row) => row.title === 'protected')?.actionsDisabled).toBe(true)
    await expect(inventory.quit(listed.find((row) => row.title === 'nd')!.id, false)).rejects.toThrow(/protected/)
    await expect(inventory.quit(listed.find((row) => row.title === 'protected')!.id, false)).rejects.toThrow(/cannot verify/)
    await inventory.quit(listed.find((row) => row.title === 'app')!.id, true)
    expect(killed).toEqual([[8203, true]])
  })
})
