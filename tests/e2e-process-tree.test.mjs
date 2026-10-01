import { describe, expect, it } from 'vitest'
import { matchingProcesses, processDescendants, readProcessRows } from '../scripts/e2e-process-tree.mjs'

describe('release process cleanup evidence', () => {
  it('captures nested descendants without claiming unrelated processes', () => {
    const rows = [
      { pid: 100, ppid: 1, command: 'test shell' },
      { pid: 101, ppid: 100, command: 'test app' },
      { pid: 102, ppid: 101, command: 'test worker' },
      { pid: 103, ppid: 2, command: 'unrelated app' },
    ]
    expect(processDescendants(100, rows).map((row) => row.pid)).toEqual([101, 102])
    expect(matchingProcesses(processDescendants(100, rows), rows.slice(2)).map((row) => row.pid)).toEqual([102])
  })

  it('does not treat a reused PID as the app-owned survivor', () => {
    const original = [{ pid: 102, ppid: 101, command: 'node.exe (started first)' }]
    expect(matchingProcesses(original, [{ ...original[0], command: 'node.exe (started later)' }])).toEqual([])
  })

  it('reads the real OS inventory including the test process', () => {
    const current = readProcessRows().find((row) => row.pid === process.pid)
    expect(current?.command).toBeTruthy()
    if (process.platform === 'win32') expect(current?.command).toContain('(started ')
  })
})
