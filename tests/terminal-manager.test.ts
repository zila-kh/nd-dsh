import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalPaneLayout } from '../src/shared/terminal.js'
import { TerminalManager, type PtyProcessLike, type PtySpawnOptions } from '../src/main/terminal/terminal-manager.js'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

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
