import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ND_CORE_ERROR_CODES,
  NdCoreError,
  buildCoreRequestFrame,
  isNdCoreCanceledError,
  isNdCoreDeadlineError,
  isNdCoreError,
  resolveCoreDeadlineMs,
} from '../src/main/core/core-protocol.js'
import { createCoreWorkspaceFileSystem, CORE_WORKSPACE_LIST_HARD_MAX, type CoreWorkspaceListing } from '../src/main/core/core-workspace.js'
import { createCorePtySpawner } from '../src/main/core/core-pty.js'
import { WorkspaceService } from '../src/main/workspace/workspace-service.js'
import { TerminalManager, type PtyProcessLike, type PtySpawnOptions } from '../src/main/terminal/terminal-manager.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `nd-0006-${label}-`))
  dirs.push(path)
  return path
}

describe('core deadlines on the wire', () => {
  it('sends a deadline that expires before the caller gives up', () => {
    const frame = buildCoreRequestFrame({ id: 'r1', method: 'git.exec', params: {}, deadlineMs: resolveCoreDeadlineMs(60_000) })
    expect(frame.deadlineMs).toBe(59_750)
    expect(frame.deadlineMs!).toBeLessThan(60_000)
  })

  it('honours an explicit deadline and leaves sub-second control calls unbounded', () => {
    expect(buildCoreRequestFrame({ id: 'r2', method: 'workspace.search', params: {}, deadlineMs: resolveCoreDeadlineMs(60_000, 900) }).deadlineMs).toBe(900)
    expect(resolveCoreDeadlineMs(250)).toBe(undefined)
    expect(buildCoreRequestFrame({ id: 'r3', method: 'core.health', params: {} }).deadlineMs).toBeUndefined()
  })

  it('classifies core failures by code rather than by message text', () => {
    const deadline = new NdCoreError(ND_CORE_ERROR_CODES.deadlineExceeded, 'git.exec exceeded its core deadline')
    const canceled = new NdCoreError(ND_CORE_ERROR_CODES.canceled, 'git.exec was canceled by the caller')
    expect(deadline).toBeInstanceOf(Error)
    expect(deadline.code).toBe('deadline_exceeded')
    expect(isNdCoreDeadlineError(deadline)).toBe(true)
    expect(isNdCoreDeadlineError(canceled)).toBe(false)
    expect(isNdCoreCanceledError(canceled)).toBe(true)
    expect(isNdCoreError(deadline, 'deadline_exceeded')).toBe(true)
    expect(isNdCoreError(new Error('[deadline_exceeded] a lookalike message'))).toBe(false)
  })
})

describe('workspace primitives call site', () => {
  it('browses through the core layer with the core bound and the product filter', async () => {
    const calls: Array<{ root: string; path: string; maxEntries?: number }> = []
    const listing: CoreWorkspaceListing = {
      root: '/workspace',
      path: '.',
      truncated: false,
      maxEntries: CORE_WORKSPACE_LIST_HARD_MAX,
      entries: [
        { name: 'src', path: 'src', isFile: false, isDirectory: true, isSymlink: false, size: 0 },
        { name: 'node_modules', path: 'node_modules', isFile: false, isDirectory: true, isSymlink: false, size: 0 },
        { name: 'link', path: 'link', isFile: false, isDirectory: false, isSymlink: true, size: 0 },
        { name: 'readme.md', path: 'readme.md', isFile: true, isDirectory: false, isSymlink: false, size: 12 },
        { name: 'b.txt', path: 'b.txt', isFile: true, isDirectory: false, isSymlink: false, size: 1 },
      ],
    }
    const files = {
      async list(root: string, path: string, maxEntries?: number) {
        calls.push({ root, path, ...(maxEntries === undefined ? {} : { maxEntries }) })
        return listing
      },
      async read(_root: string, path: string) {
        return { root: '/workspace', path, data: 'content', size: 7, truncated: true, maxBytes: 1024 * 1024, byteSize: 4096 }
      },
    }
    const workspace = new WorkspaceService('/workspace', { files })
    const entries = await workspace.list()
    // The whole bounded window is requested, so skipped heavy directories cannot
    // consume it and hide files; the product cap is applied after filtering.
    expect(calls).toEqual([{ root: resolve('/workspace'), path: '.', maxEntries: CORE_WORKSPACE_LIST_HARD_MAX }])
    expect(entries.map((entry) => entry.relativePath)).toEqual(['src', 'b.txt', 'readme.md'])
    expect(entries[0]!.kind).toBe('directory')

    const file = await workspace.read('src/app.ts')
    expect(file).toEqual({ relativePath: 'src/app.ts', content: 'content', truncated: true })
  })

  it('reports a truncated listing rather than presenting it as complete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const workspace = new WorkspaceService('/workspace', {
        files: createCoreWorkspaceFileSystem({
          async request<T>(method: string) {
            expect(method).toBe('workspace.list')
            return { root: '/workspace', path: '.', truncated: true, maxEntries: 2, entries: [] } as T
          },
        }),
      })
      await workspace.list()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('hit the ND Core bound'))
    } finally {
      warn.mockRestore()
    }
  })

  it('propagates a rejection from the core instead of falling back to the in-process path', async () => {
    const escape = new NdCoreError(ND_CORE_ERROR_CODES.methodFailed, 'workspace path escapes the root')
    const workspace = new WorkspaceService('/workspace', {
      files: {
        async list() { throw escape },
        async read() { throw escape },
      },
    })
    await expect(workspace.list('../..')).rejects.toThrow(/escapes the root/)
    await expect(workspace.read('../secret')).rejects.toThrow(/escapes the root/)
  })

  it('keeps the in-process path working while the core backend is detached', async () => {
    const root = await tempDir('legacy')
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1\n')
    const workspace = new WorkspaceService(root)
    const entries = await workspace.list()
    expect(entries.map((entry) => entry.relativePath)).toEqual(['src'])
    const file = await workspace.read('src/app.ts')
    expect(file.content).toContain('export const value = 1')
    // Attaching the core layer after construction is how the app wires it once the
    // sidecar handshake has completed.
    workspace.attachFileSystem(createCoreWorkspaceFileSystem({
      async request<T>(method: string) {
        return (method === 'workspace.list'
          ? { root, path: '.', truncated: false, maxEntries: 500, entries: [] }
          : { root, path: '', data: '', size: 0, truncated: false, maxBytes: 1, byteSize: 0 }) as T
      },
    }))
    expect(await workspace.list()).toEqual([])
  })
})

describe('terminal restart and truthfulness', () => {
  class FakeCore {
    readonly requests: Array<{ method: string; params: Record<string, unknown> }> = []
    private listeners = new Map<string, Set<(frame: unknown) => void>>()
    pid = 4100
    generation = 0

    onEvent(event: string, listener: (frame: unknown) => void): () => void {
      let bucket = this.listeners.get(event)
      if (!bucket) { bucket = new Set(); this.listeners.set(event, bucket) }
      bucket.add(listener)
      return () => { bucket!.delete(listener) }
    }

    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      this.requests.push({ method, params })
      if (method === 'terminal.create') {
        return { terminalId: params.terminalId, sessionId: params.sessionId, pid: this.pid, shell: params.shell, generation: 0, restarted: false } as T
      }
      if (method === 'terminal.restart') {
        this.generation += 1
        this.pid += 1
        return { terminalId: params.terminalId, sessionId: 'session-1', pid: this.pid, shell: 'sh', generation: this.generation, restarted: true } as T
      }
      if (method === 'terminal.state') {
        return { terminalId: params.terminalId, running: true, generation: this.generation, restartCount: this.generation, seq: 3, firstRetainedSeq: 1, droppedThroughSeq: 0, retainedBytes: 0, bytes: new Uint8Array() } as T
      }
      return { ok: true } as T
    }

    emit(event: string, resourceId: string, data: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener({ resourceId, data, kind: 'event', event, priority: 'normal', version: 1 })
    }
  }

  it('restarts through the core so the terminal keeps its identity and sequence', async () => {
    const core = new FakeCore()
    const spawn = createCorePtySpawner(core as never)
    const process = await spawn('/bin/sh', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: '/workspace', env: {} })
    expect(process.pid).toBe(4100)
    const data: string[] = []
    process.onData((chunk) => data.push(chunk))

    const pid = await process.restart?.(100, 30)
    expect(pid).toBe(4101)
    expect(core.requests.map((entry) => entry.method)).toEqual(['terminal.create', 'terminal.restart'])
    expect(core.requests[1]!.params).toMatchObject({ cols: 100, rows: 30 })
    // The terminal id is the same one the terminal was created with.
    expect(core.requests[1]!.params.terminalId).toBe(core.requests[0]!.params.terminalId)

    // Output arriving after the restart still reaches the same listener, and an exit
    // from the superseded generation does not close the terminal.
    core.emit('terminal.exit', String(core.requests[0]!.params.terminalId), { generation: 0, exitCode: 9, terminalId: core.requests[0]!.params.terminalId, sessionId: 'session-1' })
    core.emit('terminal.output', String(core.requests[0]!.params.terminalId), { generation: 1, bytes: new TextEncoder().encode('after restart'), terminalId: core.requests[0]!.params.terminalId, sessionId: 'session-1' })
    expect(data).toContain('after restart')

    const state = await process.shellState?.()
    expect(state).toMatchObject({ running: true, generation: 1 })
  })
})

describe('terminal wire shapes shared with nd-core', () => {
  class TailCore {
    readonly requests: Array<{ method: string; params: Record<string, unknown> }> = []
    bytes: unknown = [104, 105]
    seq = 3

    onEvent(): () => void {
      return () => undefined
    }

    async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      this.requests.push({ method, params })
      if (method === 'terminal.create') {
        return { terminalId: params.terminalId, sessionId: params.sessionId, pid: 4100, shell: params.shell, generation: 0, restarted: false } as T
      }
      return { terminalId: params.terminalId, seq: this.seq, bytes: this.bytes } as T
    }
  }

  it('sends a restorable tail as a JSON number sequence, not a byte string', async () => {
    const core = new TailCore()
    const spawn = createCorePtySpawner(core as never)
    await spawn('cmd.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: 'C:\\workspace',
      env: {},
      terminalId: 'terminal-1',
      initialBuffer: 'prompt> ',
      initialOutputSeq: 12,
    })
    const create = core.requests[0]!
    expect(create.method).toBe('terminal.create')
    // Params decode into a JSON value inside nd-core, where a MessagePack byte
    // string is undecodable: it fails the whole frame and takes the sidecar down.
    expect(create.params.initialBytes).toEqual(Array.from(new TextEncoder().encode('prompt> ')))
    expect(create.params.initialSeq).toBe(12)
  })

  it('restores a retained tail that arrives in the encoding nd-core produces', async () => {
    const core = new TailCore()
    const process = await createCorePtySpawner(core as never)('cmd.exe', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: 'C:\\workspace',
      env: {},
      terminalId: 'terminal-1',
    })
    // `terminal.state` results are re-encoded through a JSON value on the core
    // side, so the retained tail arrives as a number sequence rather than the
    // byte string the `terminal.output` events carry.
    await expect(process.tailState?.()).resolves.toEqual({ seq: 3, buffer: 'hi' })
  })
})

describe('terminal reconciliation against the runtime that owns the shell', () => {
  class ShellPty implements PtyProcessLike {
    writes: string[] = []
    killed = false
    state: { running: boolean; exitCode?: number } = { running: true }
    constructor(readonly pid: number) {}
    write(data: string): void { this.writes.push(data) }
    resize(): void {}
    kill(): void { this.killed = true }
    onData() { return { dispose: () => undefined } }
    onExit() { return { dispose: () => undefined } }
    restart(): Promise<number> { return Promise.resolve(this.pid + 1) }
    async shellState() { return this.state }
  }

  it('marks a terminal exited when its shell no longer exists, and leaves live ones alone', async () => {
    const root = await tempDir('reconcile')
    const ptys: ShellPty[] = []
    let pid = 5000
    const manager = new TerminalManager({
      storePath: join(root, 'terminals.json'),
      workspace: { state: () => ({ root, name: 'fixture' }) },
      spawn: (_file: string, _args: string[], _options: PtySpawnOptions) => { const pty = new ShellPty(pid++); ptys.push(pty); return pty },
    })
    await manager.initialize()
    const first = await manager.create({ sessionId: 'chat-a' })
    const firstId = first.terminals[0]!.id
    const second = await manager.create({ sessionId: 'chat-a' })
    const secondId = second.terminals.find((item) => item.id !== firstId)!.id

    // One shell died with a previous sidecar generation; the other is still alive.
    ptys[0]!.state = { running: false, exitCode: 137 }
    const reconciled = await manager.reconcileShells()
    expect(reconciled).toBe(1)

    const state = await manager.state('chat-a')
    const stopped = state.terminals.find((item) => item.id === firstId)!
    const alive = state.terminals.find((item) => item.id === secondId)!
    expect(stopped.status).toBe('exited')
    expect(stopped.exitCode).toBe(137)
    expect(alive.status).toBe('running')
    await expect(manager.write('chat-a', firstId, 'x')).rejects.toThrow(/not running/)
    await manager.shutdown()
  })

  it('restarts a runtime that owns its terminals in place', async () => {
    const root = await tempDir('restart-identity')
    const ptys: ShellPty[] = []
    const manager = new TerminalManager({
      storePath: join(root, 'terminals.json'),
      workspace: { state: () => ({ root, name: 'fixture' }) },
      spawn: () => { const pty = new ShellPty(6000 + ptys.length); ptys.push(pty); return pty },
    })
    await manager.initialize()
    const created = await manager.create({ sessionId: 'chat-a' })
    const id = created.terminals[0]!.id
    const restarted = await manager.restart('chat-a', id)
    // One shell was created and no second shell was spawned: the restart happened
    // through the runtime, not by starting a new terminal.
    expect(ptys).toHaveLength(1)
    expect(restarted.terminals.find((item) => item.id === id)!.status).toBe('running')
    expect(restarted.terminals.find((item) => item.id === id)!.pid).toBe(6001)
    await manager.shutdown()
  })
})
