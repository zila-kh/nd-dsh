import { promises as fs } from 'node:fs'

function replaceOnce(text, needle, replacement, path) {
  const first = text.indexOf(needle)
  if (first < 0) throw new Error(`Missing patch anchor in ${path}: ${needle.slice(0, 80)}`)
  if (text.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous patch anchor in ${path}`)
  return text.slice(0, first) + replacement + text.slice(first + needle.length)
}
async function patch(path, pairs) {
  let text = await fs.readFile(path, 'utf8')
  for (const [needle, replacement] of pairs) text = replaceOnce(text, needle, replacement, path)
  await fs.writeFile(path, text, 'utf8')
}

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'))
pkg.scripts.postinstall = 'electron-rebuild -f -w node-pty'
pkg.dependencies['@xterm/addon-fit'] = '^0.11.0'
pkg.dependencies['@xterm/xterm'] = '^6.0.0'
pkg.dependencies['node-pty'] = '^1.1.0'
pkg.devDependencies['@electron/rebuild'] = '^4.2.0'
await fs.writeFile('package.json', `${JSON.stringify(pkg, null, 2)}\n`)

await patch('pnpm-workspace.yaml', [[
  '  electron: true\n',
  '  electron: true\n  node-pty: true\n',
]])
await patch('src/preload/index.ts', [[
  "import './organization.js'\n",
  "import './organization.js'\nimport './terminal.js'\n",
]])
await patch('src/renderer/src/global.d.ts', [
  ["import type { OrganizationStrategyDesktopApi } from '../../shared/organization-strategy'\n", "import type { OrganizationStrategyDesktopApi } from '../../shared/organization-strategy'\nimport type { TerminalDesktopApi } from '../../shared/terminal'\n"],
  ['    ndDshStrategy: OrganizationStrategyDesktopApi\n', '    ndDshStrategy: OrganizationStrategyDesktopApi\n    ndDshTerminal: TerminalDesktopApi\n'],
])

await patch('src/main/index.ts', [
  ["import { ORGANIZATION_IPC } from '../shared/organization.js'\n", "import { ORGANIZATION_IPC } from '../shared/organization.js'\nimport { TERMINAL_IPC } from '../shared/terminal.js'\n"],
  ["import { ThemeService } from './theme.js'\n", "import { ThemeService } from './theme.js'\nimport { registerTerminalIpc } from './terminal/ipc.js'\nimport { TerminalManager } from './terminal/terminal-manager.js'\n"],
  ['let activeNdPencil: NdPencilController | undefined\n', 'let activeNdPencil: NdPencilController | undefined\nlet activeTerminalManager: TerminalManager | undefined\n'],
  ["  const workspaces = new WorkspaceRegistry(join(userData, 'workspaces.json'))\n", "  const terminalManager = new TerminalManager({\n    storePath: join(userData, 'terminals.json'),\n    workspace,\n    onOutput: (event) => { if (!window.isDestroyed()) window.webContents.send(TERMINAL_IPC.outputEvent, event) },\n    onExit: (event) => { if (!window.isDestroyed()) window.webContents.send(TERMINAL_IPC.exitEvent, event) },\n    onState: (event) => { if (!window.isDestroyed()) window.webContents.send(TERMINAL_IPC.stateEvent, event) },\n  })\n  await terminalManager.initialize()\n  activeTerminalManager = terminalManager\n\n  const workspaces = new WorkspaceRegistry(join(userData, 'workspaces.json'))\n"],
  ['  const disposeIpc = registerIpc({ window, preloadPath: preload, browser, dshSurface, engines, engineRouter, harness, projectWorkspace, workspaces, theme, providers, externalElements, recentPicks, git, qa, sessionArchive, capabilities })\n', '  const disposeIpc = registerIpc({ window, preloadPath: preload, browser, dshSurface, engines, engineRouter, harness, projectWorkspace, workspaces, theme, providers, externalElements, recentPicks, git, qa, sessionArchive, capabilities })\n  const disposeTerminalIpc = registerTerminalIpc(window, terminalManager)\n'],
  ['    disposeOrganizationIpc()\n    disposeDesignIpc()\n    disposeIpc()\n', '    disposeOrganizationIpc()\n    disposeDesignIpc()\n    disposeTerminalIpc()\n    disposeIpc()\n'],
  ['    if (activeCodexEngine === codexEngine) activeCodexEngine = undefined\n    beginCodexClose(codexEngine)\n    beginHarnessClose(harness)\n', '    if (activeCodexEngine === codexEngine) activeCodexEngine = undefined\n    if (activeTerminalManager === terminalManager) { activeTerminalManager = undefined; beginTerminalClose(terminalManager) }\n    beginCodexClose(codexEngine)\n    beginHarnessClose(harness)\n'],
  ['  if (activeCodexEngine) {\n    const codexEngine = activeCodexEngine\n    activeCodexEngine = undefined\n    beginCodexClose(codexEngine)\n  }\n', '  if (activeCodexEngine) {\n    const codexEngine = activeCodexEngine\n    activeCodexEngine = undefined\n    beginCodexClose(codexEngine)\n  }\n  if (activeTerminalManager) {\n    const terminalManager = activeTerminalManager\n    activeTerminalManager = undefined\n    beginTerminalClose(terminalManager)\n  }\n'],
  ['function beginNdPencilClose(ndPencil: NdPencilController): void {\n', "function beginTerminalClose(terminalManager: TerminalManager): void {\n  trackClose(terminalManager.shutdown().catch((error) => console.error('Failed to close session terminals cleanly:', error)))\n}\n\nfunction beginNdPencilClose(ndPencil: NdPencilController): void {\n"],
])

await patch('src/renderer/src/components/ChatPanel.tsx', [
  ["import { cn } from '../lib/utils'\n", "import { cn } from '../lib/utils'\nimport { TerminalDock } from './TerminalDock'\n"],
  ['  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)\n', '  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)\n  const [terminalOpen, setTerminalOpen] = useState(false)\n'],
  ['  const activeEngineSession = activeSessionId !== null ? engineSessions.find((session) => session.sessionId === activeSessionId) : undefined\n', '  const activeEngineSession = activeSessionId !== null ? engineSessions.find((session) => session.sessionId === activeSessionId) : undefined\n  const terminalCwd = activeSession?.cwd ?? activeEngineSession?.cwd\n'],
  ['  const menuRef = useRef<HTMLDivElement>(null)\n\n', "  const menuRef = useRef<HTMLDivElement>(null)\n\n  useEffect(() => {\n    const onShortcut = (event: globalThis.KeyboardEvent): void => {\n      if (!(event.ctrlKey || event.metaKey) || event.key !== '`') return\n      event.preventDefault()\n      if (activeSessionId) setTerminalOpen((open) => !open)\n    }\n    window.addEventListener('keydown', onShortcut)\n    return () => window.removeEventListener('keydown', onShortcut)\n  }, [activeSessionId])\n\n"],
  [`          <span\n            className={cn(\n              'inline-block size-2 rounded-full',\n              status?.state === 'ready' && 'bg-primary',\n              (status?.state === 'running' || status?.state === 'starting') && 'animate-pulse-dot bg-info',\n              status?.state === 'error' && 'bg-destructive',\n              !status?.state || status.state === 'stopped' ? 'bg-faint' : '',\n            )}\n            title={status?.error}\n          />`, `          <div className="flex shrink-0 items-center gap-1.5">\n            <button\n              type="button"\n              disabled={!activeSessionId}\n              className={cn('flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[9px] transition-colors disabled:opacity-40', terminalOpen ? 'border-primary/25 bg-primary/[0.08] text-primary' : 'border-border-soft text-faint hover:bg-accent hover:text-foreground')}\n              title="Toggle this chat's isolated terminal (Ctrl/Cmd + Backtick)"\n              onClick={() => setTerminalOpen((open) => !open)}\n            >\n              <span>&gt;_</span><span>Terminal</span>\n            </button>\n            <span\n              className={cn(\n                'inline-block size-2 rounded-full',\n                status?.state === 'ready' && 'bg-primary',\n                (status?.state === 'running' || status?.state === 'starting') && 'animate-pulse-dot bg-info',\n                status?.state === 'error' && 'bg-destructive',\n                !status?.state || status.state === 'stopped' ? 'bg-faint' : '',\n              )}\n              title={status?.error}\n            />\n          </div>`],
  ['        <div className="mx-3 my-1.5 flex flex-col rounded-xl border border-border bg-surface-1 px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.18)]" ref={menuRef}>', '        <TerminalDock open={terminalOpen} sessionId={activeSessionId} {...(terminalCwd ? { cwd: terminalCwd } : {})} onOpenChange={setTerminalOpen} onError={onError} />\n\n        <div className="mx-3 my-1.5 flex flex-col rounded-xl border border-border bg-surface-1 px-2.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.18)]" ref={menuRef}>'],
])

console.log('Terminal integration materialized')
