import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpus } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HANDLE_LIFETIME_MS = 60_000
const MAX_HANDLES = 4_000

export interface ProcessSnapshot {
  pid: number
  name: string
  started: string
  memoryBytes: number
  cpuSeconds?: number
  cpuPercent?: number
}

export interface ProcessRow {
  id: string
  title: string
  detail: string
  status?: string
  actionsDisabled?: boolean
  sortValues: Record<string, number>
}

type ProcessHandle = Pick<ProcessSnapshot, 'pid' | 'name' | 'started'> & { expiresAt: number }

/** Fixed OS commands, never caller-supplied shell text or PID arguments. */
export class ProcessInventory {
  private handles = new Map<string, ProcessHandle>()
  private previousCpu = new Map<number, { seconds: number; at: number; started: string }>()

  constructor(
    private readonly read: () => Promise<ProcessSnapshot[]> = readProcesses,
    private readonly protectedPids: () => number[] = () => [process.pid],
    private readonly quitProcess: (pid: number, force: boolean) => Promise<void> = terminateProcess,
  ) {}

  async list(): Promise<ProcessRow[]> {
    const snapshot = await this.read()
    const now = Date.now()
    for (const [id, handle] of this.handles) if (handle.expiresAt < now) this.handles.delete(id)
    const nextCpu = new Map<number, { seconds: number; at: number; started: string }>()
    const protectedPids = new Set(this.protectedPids())
    const rows = snapshot.slice(0, MAX_HANDLES).map((item) => {
      const prior = this.previousCpu.get(item.pid)
      let percent = item.cpuPercent
      if (item.cpuSeconds !== undefined) {
        if (prior && prior.started === item.started && now > prior.at && item.cpuSeconds >= prior.seconds) {
          percent = Math.max(0, Math.min(100, (item.cpuSeconds - prior.seconds) * 100_000 / (now - prior.at) / Math.max(1, cpus().length)))
        }
        nextCpu.set(item.pid, { seconds: item.cpuSeconds, at: now, started: item.started })
      }
      const id = randomUUID()
      this.handles.set(id, { pid: item.pid, name: item.name, started: item.started, expiresAt: now + HANDLE_LIFETIME_MS })
      const protectedProcess = protectedPids.has(item.pid) || item.pid <= 4
      return {
        id,
        title: item.name,
        detail: `PID ${item.pid} · CPU ${percent === undefined ? '—' : `${percent.toFixed(1)}%`} · RAM ${(item.memoryBytes / 1_048_576).toFixed(1)} MB`,
        ...(protectedProcess ? { status: 'ND protected' } : !item.started ? { status: 'Read only' } : {}),
        ...(protectedProcess || !item.started ? { actionsDisabled: true } : {}),
        sortValues: { pid: item.pid, cpu: percent ?? -1, memory: item.memoryBytes },
      }
    }).sort((a, b) => a.title.localeCompare(b.title))
    while (this.handles.size > MAX_HANDLES) this.handles.delete(this.handles.keys().next().value!)
    this.previousCpu = nextCpu
    return rows
  }

  async resolve(id: string): Promise<ProcessHandle> {
    const selected = this.handles.get(id)
    if (!selected || selected.expiresAt < Date.now()) throw new Error('Refresh the process list before quitting this process')
    if (!selected.started) throw new Error('ND cannot verify this process identity, so it cannot be quit safely')
    if (this.protectedPids().includes(selected.pid) || selected.pid <= 4) throw new Error('ND cannot quit a protected process')
    const current = (await this.read()).find((item) => item.pid === selected.pid)
    if (!current || current.name !== selected.name || current.started !== selected.started) {
      throw new Error('The process changed or exited. Refresh the list before trying again')
    }
    return selected
  }

  async quit(id: string, force: boolean): Promise<void> {
    const selected = await this.resolve(id)
    this.handles.delete(id)
    await this.quitProcess(selected.pid, force)
  }
}

const WINDOWS_LIST_SCRIPT = `Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
  $started = ''
  try { $started = $_.StartTime.ToUniversalTime().Ticks.ToString() } catch {}
  [pscustomobject]@{
    pid = $_.Id
    name = $_.ProcessName
    started = $started
    memoryBytes = $_.WorkingSet64
    cpuSeconds = $_.CPU
  }
} | ConvertTo-Json -Compress -Depth 2`

export async function readProcesses(): Promise<ProcessSnapshot[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_LIST_SCRIPT], {
      timeout: 10_000,
      maxBuffer: 8 * 1_048_576,
      windowsHide: true,
    })
    const value: unknown = JSON.parse(stdout || '[]')
    return (Array.isArray(value) ? value : [value]).flatMap(asWindowsProcess)
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=', '-o', 'comm=', '-o', 'pcpu=', '-o', 'rss=', '-o', 'lstart='], {
      timeout: 10_000,
      maxBuffer: 8 * 1_048_576,
    })
    return stdout.split(/\r?\n/).flatMap(asUnixProcess)
  }
  throw new Error(`Quit Processes is not supported on ${process.platform}`)
}

function asWindowsProcess(value: unknown): ProcessSnapshot[] {
  if (!value || typeof value !== 'object') return []
  const row = value as Record<string, unknown>
  const pid = Number(row.pid)
  if (!Number.isSafeInteger(pid) || pid < 1 || typeof row.name !== 'string') return []
  return [{
    pid,
    name: row.name.slice(0, 256),
    started: typeof row.started === 'string' ? row.started : '',
    memoryBytes: Number(row.memoryBytes) || 0,
    ...(typeof row.cpuSeconds === 'number' ? { cpuSeconds: row.cpuSeconds } : {}),
  }]
}

function asUnixProcess(line: string): ProcessSnapshot[] {
  const match = line.match(/^\s*(\d+)\s+(.+?)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
  if (!match) return []
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid < 1) return []
  return [{
    pid,
    name: match[2]!.slice(0, 256),
    started: match[5]!.trim(),
    cpuPercent: Number(match[3]) || 0,
    memoryBytes: (Number(match[4]) || 0) * 1_024,
  }]
}

async function terminateProcess(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), ...(force ? ['/F'] : [])], { timeout: 10_000, windowsHide: true })
    return
  }
  process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
}
