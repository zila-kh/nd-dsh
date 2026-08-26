import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import type { TerminalCreateInput, TerminalExitEvent, TerminalOutputEvent, TerminalPaneLayout, TerminalSessionState, TerminalSnapshot, TerminalStateEvent } from '../../shared/terminal.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'

const nodeRequire = createRequire(import.meta.url)
const MAX_BUFFER = 512 * 1024
const MAX_INPUT = 64 * 1024
const RESTORE_MARKER = '\r\n\x1b[2m[ND] Restored terminal after desktop restart; the previous shell process ended with the app.\x1b[0m\r\n'

type StoredSession = TerminalSessionState
interface StoreFile { version: 1; sessions: StoredSession[] }
export interface PtyProcessLike {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}
export interface PtySpawnOptions { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }
export type PtySpawner = (file: string, args: string[], options: PtySpawnOptions) => PtyProcessLike
interface Runtime { process: PtyProcessLike; data: { dispose(): void }; exit: { dispose(): void } }

export interface TerminalManagerOptions {
  storePath: string
  workspace: Pick<WorkspaceService, 'state'>
  spawn?: PtySpawner
  onOutput?: (event: TerminalOutputEvent) => void
  onExit?: (event: TerminalExitEvent) => void
  onState?: (event: TerminalStateEvent) => void
}

export class TerminalManager {
  private readonly sessions = new Map<string, StoredSession>()
  private readonly runtimes = new Map<string, Map<string, Runtime>>()
  private readonly spawnPty: PtySpawner
  private initialized = false
  private closing = false
  private persistTimer: ReturnType<typeof setTimeout> | undefined
  private persistChain: Promise<void> = Promise.resolve()

  constructor(private readonly options: TerminalManagerOptions) {
    this.spawnPty = options.spawn ?? defaultSpawn
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.options.storePath, 'utf8')) as StoreFile
      if (parsed.version === 1 && Array.isArray(parsed.sessions)) {
        for (const session of parsed.sessions) {
          const normalized = normalizeSession(session)
          normalized.sessionId = asId(normalized.sessionId, 'Session id')
          const terminalIds = new Set(normalized.terminals.map((terminal) => asId(terminal.id, 'Terminal id')))
          validateLayout(normalized.layout, terminalIds)
          this.normalize(normalized)
          this.sessions.set(normalized.sessionId, normalized)
        }
      }
    } catch (error) {
      this.sessions.clear()
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Ignoring unreadable terminal state; terminals will start fresh:', error instanceof Error ? error.message : String(error))
      }
    }
    this.initialized = true
  }

  async state(sessionId: string): Promise<TerminalSessionState> {
    const id = asId(sessionId, 'Session id')
    await this.ensureReady()
    const session = this.getSession(id)
    await this.restoreRunning(session)
    return cloneSession(session)
  }

  async create(input: TerminalCreateInput): Promise<TerminalSessionState> {
    const sessionId = asId(input.sessionId, 'Session id')
    await this.ensureReady()
    if (this.closing) throw new Error('Terminal service is shutting down')
    const session = this.getSession(sessionId)
    await this.restoreRunning(session)
    const cwd = await this.resolveCwd(input.cwd)
    const now = Date.now()
    const terminal: TerminalSnapshot = {
      id: randomUUID(), sessionId,
      title: cleanTitle(input.title) ?? `Terminal ${session.terminals.length + 1}`,
      cwd, shell: '', status: 'starting',
      cols: clamp(input.cols, 100, 2, 1000), rows: clamp(input.rows, 28, 1, 500),
      createdAt: now, updatedAt: now, buffer: '', outputSeq: 0,
    }
    session.terminals.push(terminal)
    if (!session.layout) {
      const paneId = randomUUID()
      session.layout = { type: 'leaf', paneId, terminalId: terminal.id }
      session.activePaneId = paneId
    }
    session.activeTerminalId = terminal.id
    await this.spawn(terminal, input.shell, false)
    this.normalize(session)
    this.changed(sessionId)
    return cloneSession(session)
  }

  async write(sessionId: string, terminalId: string, data: string): Promise<void> {
    const terminal = await this.owned(sessionId, terminalId)
    if (typeof data !== 'string' || data.length === 0) return
    if (data.length > MAX_INPUT) throw new Error('Terminal input is too large')
    const runtime = this.runtime(terminal.sessionId, terminal.id)
    if (!runtime || terminal.status !== 'running') throw new Error('Terminal is not running')
    runtime.process.write(data)
  }

  async resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void> {
    const terminal = await this.owned(sessionId, terminalId)
    terminal.cols = clamp(cols, terminal.cols, 2, 1000)
    terminal.rows = clamp(rows, terminal.rows, 1, 500)
    terminal.updatedAt = Date.now()
    this.runtime(terminal.sessionId, terminal.id)?.process.resize(terminal.cols, terminal.rows)
    this.schedulePersist()
  }

  async close(sessionId: string, terminalId: string): Promise<TerminalSessionState> {
    const terminal = await this.owned(sessionId, terminalId)
    const session = this.sessions.get(terminal.sessionId)!
    this.detach(terminal.sessionId, terminal.id, true)
    session.terminals = session.terminals.filter((item) => item.id !== terminal.id)
    session.layout = removeFromLayout(session.layout, terminal.id)
    this.normalize(session)
    await this.persist()
    this.emit(session.sessionId)
    return cloneSession(session)
  }

  async restart(sessionId: string, terminalId: string): Promise<TerminalSessionState> {
    const terminal = await this.owned(sessionId, terminalId)
    this.detach(terminal.sessionId, terminal.id, true)
    terminal.status = 'starting'; terminal.updatedAt = Date.now(); delete terminal.pid; delete terminal.exitCode; delete terminal.error
    append(terminal, '\r\n\x1b[2m[ND] Restarted terminal.\x1b[0m\r\n')
    await this.spawn(terminal, terminal.shell || undefined, false)
    this.changed(terminal.sessionId)
    return cloneSession(this.sessions.get(terminal.sessionId)!)
  }

  async rename(sessionId: string, terminalId: string, title: string): Promise<TerminalSessionState> {
    const terminal = await this.owned(sessionId, terminalId)
    const next = cleanTitle(title)
    if (!next) throw new Error('Terminal title cannot be empty')
    terminal.title = next; terminal.updatedAt = Date.now()
    this.changed(terminal.sessionId)
    return cloneSession(this.sessions.get(terminal.sessionId)!)
  }

  async setLayout(sessionId: string, layout: TerminalPaneLayout | null, activePaneId: string | null, activeTerminalId: string | null): Promise<TerminalSessionState> {
    const id = asId(sessionId, 'Session id')
    await this.ensureReady()
    const session = this.getSession(id)
    await this.restoreRunning(session)
    const terminalIds = new Set(session.terminals.map((terminal) => terminal.id))
    validateLayout(layout, terminalIds)
    const paneIds = collectPanes(layout)
    if (activePaneId !== null && !paneIds.has(activePaneId)) throw new Error('Active pane is outside this session layout')
    if (activeTerminalId !== null && !terminalIds.has(activeTerminalId)) throw new Error('Active terminal does not belong to this session')
    session.layout = cloneLayout(layout); session.activePaneId = activePaneId; session.activeTerminalId = activeTerminalId
    this.normalize(session); this.changed(id)
    return cloneSession(session)
  }

  async shutdown(): Promise<void> {
    if (!this.initialized || this.closing) return
    this.closing = true
    if (this.persistTimer) clearTimeout(this.persistTimer)
    await this.persist()
    for (const [sessionId, runtimes] of this.runtimes) for (const terminalId of [...runtimes.keys()]) this.detach(sessionId, terminalId, true)
    await this.persistChain
  }

  private async restoreRunning(session: StoredSession): Promise<void> {
    if (this.closing) return
    for (const terminal of session.terminals) {
      if (!['running', 'starting'].includes(terminal.status) || this.runtime(session.sessionId, terminal.id)) continue
      terminal.status = 'starting'; terminal.recovered = true; delete terminal.pid; delete terminal.exitCode; delete terminal.error
      append(terminal, RESTORE_MARKER)
      try { await this.spawn(terminal, terminal.shell || undefined, true) } catch { /* snapshot records error */ }
    }
  }

  private async spawn(terminal: TerminalSnapshot, requestedShell: string | undefined, recovered: boolean): Promise<void> {
    let lastError: unknown
    for (const attempt of shellAttempts(requestedShell)) {
      try {
        const pty = this.spawnPty(attempt.file, attempt.args, {
          name: 'xterm-256color', cols: terminal.cols, rows: terminal.rows, cwd: terminal.cwd,
          env: terminalEnv(terminal.sessionId, terminal.id),
        })
        terminal.shell = attempt.file; terminal.status = 'running'; terminal.pid = pty.pid; terminal.updatedAt = Date.now()
        if (recovered) terminal.recovered = true; else delete terminal.recovered
        const runtime: Runtime = { process: pty, data: { dispose() {} }, exit: { dispose() {} } }
        runtime.data = pty.onData((data) => {
          if (this.runtime(terminal.sessionId, terminal.id) !== runtime) return
          terminal.outputSeq += 1; terminal.updatedAt = Date.now(); append(terminal, data)
          this.options.onOutput?.({ sessionId: terminal.sessionId, terminalId: terminal.id, seq: terminal.outputSeq, data })
          this.schedulePersist()
        })
        runtime.exit = pty.onExit((event) => {
          if (this.runtime(terminal.sessionId, terminal.id) !== runtime) return
          this.detach(terminal.sessionId, terminal.id, false)
          terminal.status = 'exited'; terminal.exitCode = event.exitCode; terminal.updatedAt = Date.now(); delete terminal.pid
          this.options.onExit?.({ sessionId: terminal.sessionId, terminalId: terminal.id, exitCode: event.exitCode, ...(event.signal === undefined ? {} : { signal: event.signal }) })
          this.changed(terminal.sessionId)
        })
        let group = this.runtimes.get(terminal.sessionId)
        if (!group) { group = new Map(); this.runtimes.set(terminal.sessionId, group) }
        group.set(terminal.id, runtime)
        return
      } catch (error) { lastError = error }
    }
    terminal.status = 'error'; terminal.updatedAt = Date.now(); terminal.error = `Failed to start shell: ${lastError instanceof Error ? lastError.message : String(lastError)}`; delete terminal.pid
    this.schedulePersist(); throw new Error(terminal.error)
  }

  private async owned(sessionId: string, terminalId: string): Promise<TerminalSnapshot> {
    const owner = asId(sessionId, 'Session id'); const id = asId(terminalId, 'Terminal id')
    await this.ensureReady(); const session = this.getSession(owner); await this.restoreRunning(session)
    const terminal = session.terminals.find((item) => item.id === id)
    if (!terminal) throw new Error('Terminal does not belong to this session')
    return terminal
  }

  private getSession(sessionId: string): StoredSession {
    let session = this.sessions.get(sessionId)
    if (!session) { session = { sessionId, terminals: [], layout: null, activePaneId: null, activeTerminalId: null }; this.sessions.set(sessionId, session) }
    return session
  }

  private async resolveCwd(value: string | undefined): Promise<string> {
    const root = resolve(this.options.workspace.state().root)
    const candidate = value?.trim() ? resolve(value.trim()) : root
    if (!isAbsolute(candidate)) throw new Error('Terminal cwd must be absolute')
    const stats = await fs.stat(candidate); if (!stats.isDirectory()) throw new Error('Terminal cwd is not a directory')
    return fs.realpath(candidate)
  }

  private normalize(session: StoredSession): void {
    const terminalIds = new Set(session.terminals.map((terminal) => terminal.id))
    session.layout = pruneLayout(session.layout, terminalIds)
    if (!session.layout && session.terminals[0]) { const paneId = randomUUID(); session.layout = { type: 'leaf', paneId, terminalId: session.terminals[0].id }; session.activePaneId = paneId }
    const paneIds = collectPanes(session.layout)
    if (!session.activePaneId || !paneIds.has(session.activePaneId)) session.activePaneId = firstPane(session.layout)
    const visible = terminalForPane(session.layout, session.activePaneId)
    if (!session.activeTerminalId || !terminalIds.has(session.activeTerminalId)) session.activeTerminalId = visible ?? session.terminals[0]?.id ?? null
  }

  private runtime(sessionId: string, terminalId: string): Runtime | undefined { return this.runtimes.get(sessionId)?.get(terminalId) }
  private detach(sessionId: string, terminalId: string, kill: boolean): void {
    const group = this.runtimes.get(sessionId); const runtime = group?.get(terminalId); if (!runtime) return
    group!.delete(terminalId); if (group!.size === 0) this.runtimes.delete(sessionId)
    runtime.data.dispose(); runtime.exit.dispose(); if (kill) try { runtime.process.kill() } catch { /* already exited */ }
  }
  private changed(sessionId: string): void { this.schedulePersist(); this.emit(sessionId) }
  private emit(sessionId: string): void { this.options.onState?.({ sessionId, state: cloneSession(this.getSession(sessionId)) }) }
  private schedulePersist(): void {
    if (this.closing) return
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => { this.persistTimer = undefined; void this.persist().catch((error) => console.error('[terminal] persist failed:', error)) }, 120)
  }
  private async persist(): Promise<void> {
    const payload: StoreFile = { version: 1, sessions: [...this.sessions.values()].map(cloneSession) }
    this.persistChain = this.persistChain.then(async () => {
      await fs.mkdir(dirname(this.options.storePath), { recursive: true })
      const temp = `${this.options.storePath}.tmp`; await fs.writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'); await fs.rename(temp, this.options.storePath)
    })
    return this.persistChain
  }
  private async ensureReady(): Promise<void> { if (!this.initialized) await this.initialize() }
}

function defaultSpawn(file: string, args: string[], options: PtySpawnOptions): PtyProcessLike {
  ensureSpawnHelper(); const pty = nodeRequire('node-pty') as typeof import('node-pty'); return pty.spawn(file, args, options)
}
function ensureSpawnHelper(): void {
  if (process.platform === 'win32') return
  try {
    const resolved = nodeRequire.resolve('node-pty/lib/unixTerminal.js').replace(/[/\\]lib[/\\]unixTerminal\.js$/, '')
    for (const path of [join(resolved, 'build/Release/spawn-helper'), join(resolved, 'build/Debug/spawn-helper')]) {
      try { const stat = nodeRequire('node:fs').statSync(path); if ((stat.mode & 0o111) === 0) nodeRequire('node:fs').chmodSync(path, stat.mode | 0o755); return } catch { /* try next */ }
    }
  } catch { /* node-pty will surface the real spawn failure */ }
}
function shellAttempts(requested?: string): Array<{ file: string; args: string[] }> {
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    return unique([requested, process.env.COMSPEC, 'pwsh.exe', join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe'), join(root, 'System32/cmd.exe')]).map((file) => ({ file, args: /powershell|pwsh/i.test(file) ? ['-NoLogo'] : [] }))
  }
  return unique([requested, process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']).map((file) => ({ file, args: ['-l'] }))
}
function terminalEnv(sessionId: string, terminalId: string): Record<string, string> {
  const env: Record<string, string> = {}; for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'ND-DSH', ND_DSH_SESSION_ID: sessionId, ND_DSH_TERMINAL_ID: terminalId }
}
function unique(values: Array<string | undefined>): string[] { return [...new Set(values.map((v) => v?.trim()).filter((v): v is string => Boolean(v)))] }
function append(terminal: TerminalSnapshot, data: string): void { terminal.buffer = `${terminal.buffer}${data}`.slice(-MAX_BUFFER) }
function asId(value: string, label: string): string { const id = value?.trim(); if (!id || id.length > 256) throw new Error(`${label} is invalid`); return id }
function cleanTitle(value?: string): string | undefined { const title = value?.trim().replace(/\s+/g, ' '); return title ? title.slice(0, 80) : undefined }
function clamp(value: number | undefined, fallback: number, min: number, max: number): number { return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback }
function cloneLayout(layout: TerminalPaneLayout | null): TerminalPaneLayout | null { if (!layout) return null; return layout.type === 'leaf' ? { ...layout } : { ...layout, first: cloneLayout(layout.first)!, second: cloneLayout(layout.second)! } }
function cloneSession(session: StoredSession): StoredSession { return { sessionId: session.sessionId, terminals: session.terminals.map((terminal) => ({ ...terminal })), layout: cloneLayout(session.layout), activePaneId: session.activePaneId, activeTerminalId: session.activeTerminalId } }
function normalizeSession(session: StoredSession): StoredSession { const copy = cloneSession(session); copy.terminals = copy.terminals.filter((t) => t.sessionId === copy.sessionId).map((t) => ({ ...t, buffer: String(t.buffer ?? '').slice(-MAX_BUFFER), outputSeq: Math.max(0, Math.floor(t.outputSeq ?? 0)), cols: clamp(t.cols, 100, 2, 1000), rows: clamp(t.rows, 28, 1, 500) })); return copy }
export function validateLayout(layout: TerminalPaneLayout | null, terminalIds: ReadonlySet<string>): void {
  const panes = new Set<string>(); const visible = new Set<string>()
  const walk = (node: TerminalPaneLayout, depth: number): void => { if (depth > 24) throw new Error('Terminal layout is too deeply nested'); if (node.type === 'leaf') { if (!terminalIds.has(node.terminalId)) throw new Error('Terminal layout references another session'); if (panes.has(node.paneId)) throw new Error('Duplicate terminal pane'); if (visible.has(node.terminalId)) throw new Error('A terminal cannot appear in more than one pane'); panes.add(node.paneId); visible.add(node.terminalId); return } if (node.ratio !== undefined && (!Number.isFinite(node.ratio) || node.ratio < 0.1 || node.ratio > 0.9)) throw new Error('Invalid terminal split ratio'); walk(node.first, depth + 1); walk(node.second, depth + 1) }
  if (layout) walk(layout, 0)
}
function removeFromLayout(layout: TerminalPaneLayout | null, terminalId: string): TerminalPaneLayout | null { if (!layout) return null; if (layout.type === 'leaf') return layout.terminalId === terminalId ? null : { ...layout }; const first = removeFromLayout(layout.first, terminalId); const second = removeFromLayout(layout.second, terminalId); if (!first) return second; if (!second) return first; return { ...layout, first, second } }
function pruneLayout(layout: TerminalPaneLayout | null, ids: ReadonlySet<string>): TerminalPaneLayout | null { if (!layout) return null; if (layout.type === 'leaf') return ids.has(layout.terminalId) ? { ...layout } : null; const first = pruneLayout(layout.first, ids); const second = pruneLayout(layout.second, ids); if (!first) return second; if (!second) return first; return { ...layout, first, second } }
function collectPanes(layout: TerminalPaneLayout | null): Set<string> { const set = new Set<string>(); const walk = (node: TerminalPaneLayout): void => { if (node.type === 'leaf') set.add(node.paneId); else { walk(node.first); walk(node.second) } }; if (layout) walk(layout); return set }
function firstPane(layout: TerminalPaneLayout | null): string | null { return !layout ? null : layout.type === 'leaf' ? layout.paneId : firstPane(layout.first) }
function terminalForPane(layout: TerminalPaneLayout | null, paneId: string | null): string | null { if (!layout || !paneId) return null; return layout.type === 'leaf' ? layout.paneId === paneId ? layout.terminalId : null : terminalForPane(layout.first, paneId) ?? terminalForPane(layout.second, paneId) }
