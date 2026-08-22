import { app, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { BrowserBounds, DshSurface, ThemeMode } from '../shared/contracts.js'
import { IPC } from '../shared/contracts.js'
import { projectRoot } from './app-paths.js'
import type { BrowserController } from './browser/browser-controller.js'
import type { DshSurfaceController } from './dsh/dsh-surface.js'
import type { CodingEngineRegistry } from './engines/coding-engine-registry.js'
import type { HarnessService } from './harness/harness-service.js'
import type { ProviderStore } from './providers.js'
import type { ThemeService } from './theme.js'
import type { WorkspaceService } from './workspace/workspace-service.js'

interface IpcDependencies {
  window: BrowserWindow
  browser: BrowserController
  dshSurface: DshSurfaceController
  engines: CodingEngineRegistry
  harness: HarnessService
  workspace: WorkspaceService
  theme: ThemeService
  providers: ProviderStore
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

const GATEWAY_METHOD_PATTERN = /^[a-z]+\.[a-zA-Z][a-zA-Z0-9]*$/
const GATEWAY_METHOD_MAX_LENGTH = 64

export function registerIpc(deps: IpcDependencies): () => void {
  const channels: string[] = []
  const handle = (channel: string, listener: Handler): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      assertTrustedSender(event, deps.window)
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  handle(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    projectRoot: projectRoot(),
  }))

  handle(IPC.enginesList, () => deps.engines.list())

  handle(IPC.browserState, () => deps.browser.state())
  handle(IPC.browserSetBounds, (_event, value) => deps.browser.setBounds(asBounds(value)))
  handle(IPC.browserSetVisible, (_event, visible) => deps.browser.setVisible(Boolean(visible)))
  handle(IPC.browserNavigate, (_event, value) => deps.browser.navigate(asString(value, 'Browser URL', 8_192)))
  handle(IPC.browserBack, () => deps.browser.back())
  handle(IPC.browserForward, () => deps.browser.forward())
  handle(IPC.browserReload, () => deps.browser.reload())
  handle(IPC.browserSnapshot, () => deps.browser.snapshot())
  handle(IPC.browserOpenExternal, (_event, value) => openExternal(asString(value, 'URL', 8_192)))

  handle(IPC.workspaceState, () => deps.workspace.state())
  handle(IPC.workspacePick, async () => {
    await deps.harness.stop()
    return deps.workspace.pick()
  })
  handle(IPC.workspaceSetRoot, async (_event, value) => {
    await deps.harness.stop()
    return deps.workspace.setRoot(asString(value, 'Workspace path', 4_096))
  })
  handle(IPC.workspaceList, (_event, value) =>
    deps.workspace.list(value === undefined ? '.' : asString(value, 'Workspace path', 4_096)),
  )
  handle(IPC.workspaceRead, (_event, value) =>
    deps.workspace.read(asString(value, 'Workspace file path', 4_096)),
  )

  handle(IPC.harnessStatus, () => deps.harness.status())
  handle(IPC.harnessRun, (_event, value, options) => deps.harness.run(asString(value, 'Prompt', 100_000), asSessionOptions(options)))
  handle(IPC.harnessStop, () => deps.harness.stop())
  handle(IPC.harnessPermissionGet, () => deps.theme.permissionMode())
  handle(IPC.harnessPermissionSet, async (_event, value) => {
    const mode = deps.theme.setPermissionMode(asPermissionMode(value))
    return deps.harness.restartWithPermissionMode(mode)
  })

  handle(IPC.dshRpc, (_event, method, payload) => deps.harness.gatewayRpc(asGatewayMethod(method), payload))
  handle(IPC.dshRespond, (_event, rpcId, value) => deps.harness.respond(asString(rpcId, 'RPC id', 128), value))

  handle(IPC.surfaceState, () => ({ surface: deps.theme.surface(), view: deps.dshSurface.state() }))
  handle(IPC.surfaceSet, (_event, value) => {
    const surface = deps.theme.setSurface(asSurface(value))
    if (surface === 'dsh') deps.harness.warmup()
    return { surface, view: deps.dshSurface.state() }
  })

  handle(IPC.dshViewSetBounds, (_event, value) => deps.dshSurface.setBounds(asBounds(value)))
  handle(IPC.dshViewSetVisible, (_event, visible) => deps.dshSurface.setVisible(Boolean(visible)))
  handle(IPC.dshViewReload, () => deps.dshSurface.reload())

  handle(IPC.themeState, () => deps.theme.state())
  handle(IPC.themeSet, (_event, value) => deps.theme.set(asThemeMode(value)))

  handle(IPC.providersList, () => deps.providers.list())
  handle(IPC.providersSave, (_event, value) => deps.providers.save(value))

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected IPC from an untrusted renderer frame')
  }
}

function asBounds(value: unknown): BrowserBounds {
  if (!value || typeof value !== 'object') throw new Error('Browser bounds are required')
  const record = value as Record<string, unknown>
  const read = (key: keyof BrowserBounds): number => {
    const number = Number(record[key])
    if (!Number.isFinite(number) || number < 0 || number > 100_000) {
      throw new Error(`${key} must be a finite non-negative number`)
    }
    return number
  }
  return { x: read('x'), y: read('y'), width: read('width'), height: read('height') }
}

function asString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  if (!value.trim()) throw new Error(`${label} cannot be empty`)
  if (value.length > maxLength) throw new Error(`${label} exceeds ${maxLength.toLocaleString()} characters`)
  return value
}

function asThemeMode(value: unknown): ThemeMode {
  if (value !== 'system' && value !== 'light' && value !== 'dark') {
    throw new Error('Theme mode must be one of: system, light, dark')
  }
  return value
}

function asSurface(value: unknown): DshSurface {
  if (value !== 'dsh' && value !== 'workbench') {
    throw new Error('Surface must be one of: dsh, workbench')
  }
  return value
}

function asPermissionMode(value: unknown): string {
  if (value !== 'read-only' && value !== 'workspace-write' && value !== 'danger-full-access') {
    throw new Error('Permission mode must be one of: read-only, workspace-write, danger-full-access')
  }
  return value
}

function asGatewayMethod(value: unknown): string {
  if (typeof value !== 'string' || value.length > GATEWAY_METHOD_MAX_LENGTH || !GATEWAY_METHOD_PATTERN.test(value)) {
    throw new Error('Gateway method must be a dotted name like "session.list"')
  }
  return value
}

function asSessionOptions(value: unknown): { sessionId?: string } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new Error('Harness run options must be an object')
  const record = value as Record<string, unknown>
  const sessionId = record.sessionId
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 128)) {
    throw new Error('sessionId must be a short non-empty string')
  }
  return { ...(typeof sessionId === 'string' ? { sessionId: sessionId.trim() } : {}) }
}

async function openExternal(value: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('URL must be a valid absolute web address')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be opened in a system browser')
  }
  await shell.openExternal(parsed.toString())
}
