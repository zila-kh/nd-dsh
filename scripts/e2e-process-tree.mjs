import { spawnSync } from 'node:child_process'

/** Fixed inventory commands; Windows rows omit command lines to keep secrets out of logs. */
export function readProcessRows() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })
    if (result.status !== 0) throw new Error('Cannot verify Windows test process cleanup: process inventory failed')
    const parsed = JSON.parse(result.stdout || '[]')
    return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
      pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId),
      command: `${row.Name} (started ${row.CreationDate})`,
      startedAt: Number(String(row.CreationDate).match(/\/Date\((\d+)/)?.[1]) || undefined,
    }))
  }
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 10_000 })
  if (result.status !== 0) throw new Error('Cannot verify test process cleanup: process inventory failed')
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
  })
}

export function processDescendants(rootPid, rows) {
  const visited = new Set([rootPid])
  const descendants = []
  const queue = [rootPid]
  while (queue.length) {
    const parent = queue.shift()
    const parentStartedAt = rows.find((row) => row.pid === parent)?.startedAt
    for (const row of rows) {
      if (row.ppid !== parent || visited.has(row.pid)) continue
      // Windows retains a departed parent's PID. A later process can reuse it,
      // but cannot own a child that was created before that later process.
      if (parentStartedAt !== undefined && row.startedAt !== undefined && row.startedAt < parentStartedAt) continue
      visited.add(row.pid)
      descendants.push(row)
      queue.push(row.pid)
    }
  }
  return descendants
}

export function matchingProcesses(initial, current) {
  const identities = new Map(current.map((row) => [row.pid, row.command]))
  return initial.filter((row) => identities.get(row.pid) === row.command)
}
