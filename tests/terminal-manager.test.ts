import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalPaneLayout } from '../src/shared/terminal.js'
import { TerminalManager, type PtyProcessLike, type PtySpawnOptions } from '../src/main/terminal/terminal-manager.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

class NativeTailPty implements PtyProcessLike {
  writes: string[] = []
  killed = false
  private data: ((value: string) => void) | undefined
  private exit: ((value: { exitCode: number; signal?: number }) => void) | undefined
  private tail: string
  private seq: number

  constructor(
    readonly pid: number,
    initialBuffer = '',
    initialSeq = 0,
  ) {
    this.tail = initialBuffer
    this.seq = initialSeq
  }

  write(data: string): void { this.writes.push(data) }
  resize(): void {}
  kill(): void { this.killed = true }
  onData(listener: (data: string) => void) { this.data = listener; return { dispose: () => { this.data = undefined } } }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) { this.exit = listener; return { dispose: () => { this.exit = undefined } } }
  async tailState(): Promise<{ seq: number; buffer: string }> { return { seq: this.seq, buffer: this.tail } }
  async appendHistory(data: string): Promise<void> { this.tail = `${this.tail}${data}`.slice(-(512 * 1024)) }
  emit(data: string): void {
    this.seq += 1
    this.tail = `${this.tail}${data}`.slice(-(512 * 1024))
    this.data?.(data)
  }
  emitExit(exitCode: number): void { this.exit?.({ exitCode }) }
}

class FakePty implements PtyProcessLike {
  writes: string[] = []
  killed = false
  private data: ((value: string) => void) | undefined = undefined
  private exit: ((value: { exitCode: number; signal?: number }) => void) | undefined = undefined
  constructor(readonly pid: number) {}
  write(data: string): void { this.writes.push(data) }
  resize(): void {}
  kill(): void { this.killed = true }
  onData(listener: (data: string) => void) { this.data = listener; return { dispose: () => { this.data = undefined } } }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) { this.exit = listener; return { dispose: () => { this.exit = undefined } } }
  emit(data: string): void { this.data?.(data) }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'nd-terminal-')); dirs.push(root)
  const ptys: FakePty[] = []; let pid = 1000
  const manager = new TerminalManager({ storePath: join(root, 'terminals.json'), workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: (_file: string, _args: string[], _options: PtySpawnOptions) => { const pty = new FakePty(pid++); ptys.push(pty); return pty } })
  await manager.initialize(); return { root, ptys, manager }
}

describe('TerminalManager', () => {
  it('binds terminal operations to their owning chat', async () => {
    const { manager, ptys } = await setup(); const state = await manager.create({ sessionId: 'chat-a' }); const id = state.terminals[0]!.id
    await manager.write('chat-a', id, 'echo ok\r'); expect(ptys[0]!.writes).toEqual(['echo ok\r'])
    await expect(manager.write('chat-b', id, 'bad')).rejects.toThrow(/does not belong/)
    await expect(manager.close('chat-b', id)).rejects.toThrow(/does not belong/)
    await manager.shutdown()
  })

  it('answers ConPTY\'s startup cursor query for a terminal nothing renders', async () => {
    const { manager, ptys } = await setup(); await manager.create({ sessionId: 'chat-a' })
    ptys[0]!.emit('\u001b[6n')
    // Windows withholds a shell's output until the terminal answers that query;
    // a POSIX PTY never asks, so nothing may be written there.
    expect(ptys[0]!.writes).toEqual(process.platform === 'win32' ? ['\u001b[1;1R'] : [])
    await manager.shutdown()
  })

  it('answers the startup query when the shell has emitted only control sequences so far', async () => {
    const { manager, ptys } = await setup(); await manager.create({ sessionId: 'chat-a' })
    ptys[0]!.emit('\u001b[?9001h\u001b[?1004h')
    ptys[0]!.emit('\u001b[6n')
    expect(ptys[0]!.writes).toHaveLength(process.platform === 'win32' ? 1 : 0)
    await manager.shutdown()
  })

  it('leaves cursor queries after real output to the terminal emulator', async () => {
    const { manager, ptys } = await setup(); await manager.create({ sessionId: 'chat-a' })
    ptys[0]!.emit('\u001b[6n'); ptys[0]!.emit('prompt> '); ptys[0]!.emit('\u001b[6n')
    // One reply for the startup handshake; a later query is answered by the
    // emulator, which knows where the cursor actually is.
    expect(ptys[0]!.writes).toHaveLength(process.platform === 'win32' ? 1 : 0)
    await manager.shutdown()
  })

  it('retains bounded scrollback and output sequence for renderer reattachment', async () => {
    const { manager, ptys } = await setup(); const created = await manager.create({ sessionId: 'chat-a' }); const id = created.terminals[0]!.id
    ptys[0]!.emit('hello\r\n'); ptys[0]!.emit('world\r\n'); const state = await manager.state('chat-a')
    expect(state.terminals[0]!.id).toBe(id); expect(state.terminals[0]!.buffer).toContain('hello'); expect(state.terminals[0]!.outputSeq).toBe(2)
    await manager.shutdown()
  })

  it('recreates running terminals after desktop restart with prior scrollback', async () => {
    const { root, manager, ptys } = await setup(); const created = await manager.create({ sessionId: 'chat-a' }); const id = created.terminals[0]!.id
    ptys[0]!.emit('before restart\r\n'); await manager.shutdown()
    const restoredPtys: FakePty[] = []
    const restored = new TerminalManager({ storePath: join(root, 'terminals.json'), workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: () => { const pty = new FakePty(2000 + restoredPtys.length); restoredPtys.push(pty); return pty } })
    await restored.initialize(); const state = await restored.state('chat-a')
    expect(restoredPtys).toHaveLength(1); expect(state.terminals[0]!.id).toBe(id); expect(state.terminals[0]!.status).toBe('running'); expect(state.terminals[0]!.recovered).toBe(true); expect(state.terminals[0]!.buffer).toContain('before restart'); expect(state.terminals[0]!.buffer).toContain('Restored terminal')
    await restored.shutdown()
  })

  it('reads live scrollback from the native tail instead of requiring a JS hot buffer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-terminal-native-')); dirs.push(root)
    const ptys: NativeTailPty[] = []
    const manager = new TerminalManager({
      storePath: join(root, 'terminals.json'),
      workspace: { state: () => ({ root, name: 'fixture' }) },
      spawn: (_file, _args, options) => {
        const pty = new NativeTailPty(3000 + ptys.length, options.initialBuffer, options.initialOutputSeq)
        ptys.push(pty)
        return pty
      },
    })
    await manager.initialize()
    const created = await manager.create({ sessionId: 'chat-native' })
    ptys[0]!.emit('native scrollback\r\n')
    const state = await manager.state('chat-native')
    expect(state.terminals[0]!.id).toBe(created.terminals[0]!.id)
    expect(state.terminals[0]!.buffer).toContain('native scrollback')
    expect(state.terminals[0]!.outputSeq).toBe(1)
    await manager.shutdown()
  })

  it('seeds the native tail from persisted scrollback after desktop restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-terminal-native-restore-')); dirs.push(root)
    const storePath = join(root, 'terminals.json')
    const firstPtys: NativeTailPty[] = []
    const first = new TerminalManager({
      storePath,
      workspace: { state: () => ({ root, name: 'fixture' }) },
      spawn: (_file, _args, options) => {
        const pty = new NativeTailPty(3100 + firstPtys.length, options.initialBuffer, options.initialOutputSeq)
        firstPtys.push(pty)
        return pty
      },
    })
    await first.initialize()
    const created = await first.create({ sessionId: 'chat-native' })
    firstPtys[0]!.emit('before native restart\r\n')
    await first.shutdown()

    const restoredPtys: NativeTailPty[] = []
    const restored = new TerminalManager({
      storePath,
      workspace: { state: () => ({ root, name: 'fixture' }) },
      spawn: (_file, _args, options) => {
        const pty = new NativeTailPty(3200 + restoredPtys.length, options.initialBuffer, options.initialOutputSeq)
        restoredPtys.push(pty)
        return pty
      },
    })
    await restored.initialize()
    const state = await restored.state('chat-native')
    expect(restoredPtys).toHaveLength(1)
    expect(state.terminals[0]!.id).toBe(created.terminals[0]!.id)
    expect(state.terminals[0]!.buffer).toContain('before native restart')
    expect(state.terminals[0]!.buffer).toContain('Restored terminal')
    expect(state.terminals[0]!.recovered).toBe(true)
    await restored.shutdown()
  })

  it('supports splits and rejects duplicated terminal panes', async () => {
    const { manager } = await setup(); const first = await manager.create({ sessionId: 'chat-a' }); const firstId = first.terminals[0]!.id; const second = await manager.create({ sessionId: 'chat-a' }); const secondId = second.terminals.find((item) => item.id !== firstId)!.id
    const layout: TerminalPaneLayout = { type: 'split', direction: 'horizontal', first: { type: 'leaf', paneId: 'left', terminalId: firstId }, second: { type: 'leaf', paneId: 'right', terminalId: secondId }, ratio: 0.5 }
    expect((await manager.setLayout('chat-a', layout, 'right', secondId)).layout).toEqual(layout)
    const invalid: TerminalPaneLayout = { type: 'split', direction: 'vertical', first: { type: 'leaf', paneId: 'one', terminalId: firstId }, second: { type: 'leaf', paneId: 'two', terminalId: firstId } }
    await expect(manager.setLayout('chat-a', invalid, 'one', firstId)).rejects.toThrow(/more than one pane/)
    await manager.shutdown()
  })

  it('persists split ratios across desktop restart', async () => {
    const { root, manager } = await setup()
    const first = await manager.create({ sessionId: 'chat-a' }); const firstId = first.terminals[0]!.id
    const second = await manager.create({ sessionId: 'chat-a' }); const secondId = second.terminals.find((item) => item.id !== firstId)!.id
    const layout: TerminalPaneLayout = { type: 'split', direction: 'horizontal', first: { type: 'leaf', paneId: 'left', terminalId: firstId }, second: { type: 'leaf', paneId: 'right', terminalId: secondId }, ratio: 0.3 }
    await manager.setLayout('chat-a', layout, 'left', firstId)
    await manager.shutdown()

    const restored = new TerminalManager({ storePath: join(root, 'terminals.json'), workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: () => new FakePty(4000) })
    await restored.initialize(); const state = await restored.state('chat-a')
    if (state.layout?.type !== 'split') throw new Error('Expected restored split layout')
    expect(state.layout.ratio).toBeCloseTo(0.3)
    await restored.shutdown()
  })

  it('ignores malformed persisted terminal state instead of blocking startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-terminal-corrupt-')); dirs.push(root)
    const storePath = join(root, 'terminals.json')
    await writeFile(storePath, JSON.stringify({ version: 1, sessions: [{ sessionId: 'chat-a', terminals: null, layout: null, activePaneId: null, activeTerminalId: null }] }), 'utf8')
    const manager = new TerminalManager({ storePath, workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: () => new FakePty(5000) })
    await expect(manager.initialize()).resolves.toBeUndefined()
    expect((await manager.state('chat-a')).terminals).toEqual([])
    await manager.shutdown()
  })
})
