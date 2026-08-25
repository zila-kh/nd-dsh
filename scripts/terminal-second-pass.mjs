import { readFile, writeFile } from 'node:fs/promises'

async function edit(path, transform) {
  const source = await readFile(path, 'utf8')
  const next = transform(source)
  if (next === source) throw new Error(`No changes applied to ${path}`)
  await writeFile(path, next, 'utf8')
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before)
  if (index < 0) throw new Error(`Missing ${label}`)
  if (source.indexOf(before, index + before.length) >= 0) throw new Error(`Ambiguous ${label}`)
  return `${source.slice(0, index)}${after}${source.slice(index + before.length)}`
}

await edit('src/main/terminal/terminal-manager.ts', (source) => {
  source = replaceOnce(
    source,
    `        for (const session of parsed.sessions) this.sessions.set(session.sessionId, normalizeSession(session))`,
    `        for (const session of parsed.sessions) {\n          const normalized = normalizeSession(session)\n          normalized.sessionId = asId(normalized.sessionId, 'Session id')\n          const terminalIds = new Set(normalized.terminals.map((terminal) => asId(terminal.id, 'Terminal id')))\n          validateLayout(normalized.layout, terminalIds)\n          this.normalize(normalized)\n          this.sessions.set(normalized.sessionId, normalized)\n        }`,
    'terminal store normalization loop',
  )
  return replaceOnce(
    source,
    `    } catch (error) {\n      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error\n    }`,
    `    } catch (error) {\n      this.sessions.clear()\n      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {\n        console.warn('Ignoring unreadable terminal state; terminals will start fresh:', error instanceof Error ? error.message : String(error))\n      }\n    }`,
    'terminal store recovery catch',
  )
})

await edit('src/renderer/src/components/TerminalDock.tsx', (source) => {
  source = replaceOnce(
    source,
    `const MIN_HEIGHT = 150, MAX_HEIGHT = 520, DEFAULT_HEIGHT = 250`,
    `const MIN_HEIGHT = 150, MAX_HEIGHT = 520, DEFAULT_HEIGHT = 250\ntype LayoutBranch = 'first' | 'second'`,
    'terminal layout branch type',
  )
  source = replaceOnce(
    source,
    `  const active = state?.terminals.find((terminal) => terminal.id === state.activeTerminalId)`,
    `  const persistSplitRatio = useCallback((path: readonly LayoutBranch[], ratio: number) => {\n    if (!sessionId || !state?.layout) return\n    const layout = updateSplitRatio(state.layout, path, ratio)\n    void apply(window.ndDshTerminal.setLayout(sessionId, layout, state.activePaneId, state.activeTerminalId))\n  }, [apply, sessionId, state])\n\n  const active = state?.terminals.find((terminal) => terminal.id === state.activeTerminalId)`,
    'split-ratio persistence callback',
  )
  source = replaceOnce(
    source,
    `<Layout layout={state.layout} sessionId={sessionId} byId={byId} activePaneId={state.activePaneId} activate={(paneId, terminalId) => { if (state.activePaneId !== paneId || state.activeTerminalId !== terminalId) void apply(window.ndDshTerminal.setLayout(sessionId, state.layout, paneId, terminalId)) }} onError={fail} />`,
    `<Layout layout={state.layout} sessionId={sessionId} byId={byId} activePaneId={state.activePaneId} activate={(paneId, terminalId) => { if (state.activePaneId !== paneId || state.activeTerminalId !== terminalId) void apply(window.ndDshTerminal.setLayout(sessionId, state.layout, paneId, terminalId)) }} persistRatio={persistSplitRatio} path={[]} onError={fail} />`,
    'root terminal layout render',
  )

  const layoutStart = source.indexOf('function Layout(')
  const surfaceStart = source.indexOf('\n\nfunction Surface(', layoutStart)
  if (layoutStart < 0 || surfaceStart < 0) throw new Error('Could not locate terminal Layout component')
  const replacement = `function Layout({ layout, sessionId, byId, activePaneId, activate, persistRatio, path, onError }: { layout: TerminalPaneLayout; sessionId: string; byId: ReadonlyMap<string, TerminalSnapshot>; activePaneId: string | null; activate(pane: string, terminal: string): void; persistRatio(path: readonly LayoutBranch[], ratio: number): void; path: readonly LayoutBranch[]; onError(cause: unknown): void }) {\n  if (layout.type === 'leaf') {\n    const snapshot = byId.get(layout.terminalId)\n    return snapshot ? <Surface sessionId={sessionId} snapshot={snapshot} active={activePaneId === layout.paneId} focus={() => activate(layout.paneId, layout.terminalId)} onError={onError} /> : null\n  }\n  const ratio = layout.ratio ?? 0.5\n  return <Group\n    orientation={layout.direction}\n    className="h-full w-full"\n    defaultLayout={{ first: ratio * 100, second: (1 - ratio) * 100 }}\n    onLayoutChanged={(next, meta) => {\n      const first = next.first\n      if (meta.isUserInteraction && typeof first === 'number') persistRatio(path, Math.max(0.1, Math.min(0.9, first / 100)))\n    }}\n  >\n    <Panel id="first" minSize="10%" className="min-h-0 min-w-0 overflow-hidden"><Layout layout={layout.first} sessionId={sessionId} byId={byId} activePaneId={activePaneId} activate={activate} persistRatio={persistRatio} path={[...path, 'first']} onError={onError} /></Panel>\n    <Separator className={cn('shrink-0 touch-none bg-border-strong hover:bg-primary', layout.direction === 'horizontal' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize')} />\n    <Panel id="second" minSize="10%" className="min-h-0 min-w-0 overflow-hidden"><Layout layout={layout.second} sessionId={sessionId} byId={byId} activePaneId={activePaneId} activate={activate} persistRatio={persistRatio} path={[...path, 'second']} onError={onError} /></Panel>\n  </Group>\n}`
  source = `${source.slice(0, layoutStart)}${replacement}${source.slice(surfaceStart)}`
  return replaceOnce(
    source,
    `function clampHeight(value: number): number { return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(value))) }`,
    `function updateSplitRatio(layout: TerminalPaneLayout, path: readonly LayoutBranch[], ratio: number): TerminalPaneLayout {\n  if (layout.type === 'leaf') return layout\n  if (path.length === 0) return { ...layout, ratio }\n  const [branch, ...rest] = path\n  return branch === 'first'\n    ? { ...layout, first: updateSplitRatio(layout.first, rest, ratio) }\n    : { ...layout, second: updateSplitRatio(layout.second, rest, ratio) }\n}\nfunction clampHeight(value: number): number { return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(value))) }`,
    'split-ratio layout helper',
  )
})

await edit('tests/terminal-manager.test.ts', (source) => {
  source = replaceOnce(source, `import { mkdtemp, rm } from 'node:fs/promises'`, `import { mkdtemp, rm, writeFile } from 'node:fs/promises'`, 'terminal test fs import')
  const insertAt = source.lastIndexOf('\n})')
  if (insertAt < 0) throw new Error('Could not locate TerminalManager describe end')
  const tests = `\n\n  it('persists split ratios across desktop restart', async () => {\n    const { root, manager } = await setup()\n    const first = await manager.create({ sessionId: 'chat-a' }); const firstId = first.terminals[0]!.id\n    const second = await manager.create({ sessionId: 'chat-a' }); const secondId = second.terminals.find((item) => item.id !== firstId)!.id\n    const layout: TerminalPaneLayout = { type: 'split', direction: 'horizontal', first: { type: 'leaf', paneId: 'left', terminalId: firstId }, second: { type: 'leaf', paneId: 'right', terminalId: secondId }, ratio: 0.3 }\n    await manager.setLayout('chat-a', layout, 'left', firstId)\n    await manager.shutdown()\n\n    const restored = new TerminalManager({ storePath: join(root, 'terminals.json'), workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: () => new FakePty(4000) })\n    await restored.initialize(); const state = await restored.state('chat-a')\n    if (state.layout?.type !== 'split') throw new Error('Expected restored split layout')\n    expect(state.layout.ratio).toBeCloseTo(0.3)\n    await restored.shutdown()\n  })\n\n  it('ignores malformed persisted terminal state instead of blocking startup', async () => {\n    const root = await mkdtemp(join(tmpdir(), 'nd-terminal-corrupt-')); dirs.push(root)\n    const storePath = join(root, 'terminals.json')\n    await writeFile(storePath, JSON.stringify({ version: 1, sessions: [{ sessionId: 'chat-a', terminals: null, layout: null, activePaneId: null, activeTerminalId: null }] }), 'utf8')\n    const manager = new TerminalManager({ storePath, workspace: { state: () => ({ root, name: 'fixture' }) }, spawn: () => new FakePty(5000) })\n    await expect(manager.initialize()).resolves.toBeUndefined()\n    expect((await manager.state('chat-a')).terminals).toEqual([])\n    await manager.shutdown()\n  })`
  return `${source.slice(0, insertAt)}${tests}${source.slice(insertAt)}`
})

await edit('e2e/smoke.spec.ts', (source) => {
  source = replaceOnce(
    source,
    `import { expect, test } from '@playwright/test'\nimport { closeApp, launchApp, type LaunchedApp } from './fixtures.js'`,
    `import { expect, test } from '@playwright/test'\nimport type { TerminalDesktopApi } from '../src/shared/terminal.js'\nimport { closeApp, launchApp, type LaunchedApp } from './fixtures.js'`,
    'terminal e2e type import',
  )
  const marker = `test('primary surfaces switch without renderer errors'`
  const insertAt = source.indexOf(marker)
  if (insertAt < 0) throw new Error('Could not locate smoke insertion point')
  const test = `test('dedicated terminal runs a real PTY command through the sandboxed bridge', async () => {\n  const { page } = launched\n  const result = await page.evaluate(async () => {\n    const api = (globalThis as typeof globalThis & { ndDshTerminal: TerminalDesktopApi }).ndDshTerminal\n    const sessionId = \`terminal-e2e-\${Date.now()}\`\n    const marker = 'ND_TERMINAL_E2E_OK'\n    const created = await api.create({ sessionId, title: 'E2E terminal' })\n    const terminal = created.terminals[0]\n    if (!terminal) throw new Error('Terminal was not created')\n    try {\n      const streamed = await new Promise<string>((resolve, reject) => {\n        let output = ''\n        const timeout = setTimeout(() => { off(); reject(new Error('Timed out waiting for PTY output')) }, 15_000)\n        const off = api.onOutput((event) => {\n          if (event.sessionId !== sessionId || event.terminalId !== terminal.id) return\n          output += event.data\n          if (output.includes(marker)) { clearTimeout(timeout); off(); resolve(output) }\n        })\n        void api.write(sessionId, terminal.id, \`node -e "console.log(Buffer.from('TkRfVEVSTUlOQUxfRTJFX09L','base64').toString())"\\r\`).catch((error) => { clearTimeout(timeout); off(); reject(error) })\n      })\n      const latest = await api.state(sessionId)\n      const snapshot = latest.terminals.find((item) => item.id === terminal.id)\n      if (!snapshot) throw new Error('Terminal disappeared after command execution')\n      return { streamed, buffer: snapshot.buffer, status: snapshot.status, shell: snapshot.shell }\n    } finally {\n      await api.close(sessionId, terminal.id).catch(() => undefined)\n    }\n  })\n  expect(result.streamed).toContain('ND_TERMINAL_E2E_OK')\n  expect(result.buffer).toContain('ND_TERMINAL_E2E_OK')\n  expect(result.status).toBe('running')\n  expect(result.shell.length).toBeGreaterThan(0)\n  expect(rendererErrors).toEqual([])\n})\n\n`
  return `${source.slice(0, insertAt)}${test}${source.slice(insertAt)}`
})

console.log('Terminal second-pass hardening materialized')
