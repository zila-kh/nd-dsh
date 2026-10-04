import { app, clipboard, dialog, ipcMain, nativeImage, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import process from 'node:process'
import { asNdContext, contextKey, type NdContext } from '../../shared/nd-context.js'
import { ND_HOST_METHODS, manifestPermissionIssues, validateNdExtensionManifest, type NdHostMethod } from '../../shared/extension-package.js'
import {
  ND_EXTENSIONS_IPC,
  ND_HOME_IPC,
  type NdExtensionsStateView,
  type NdAvailablePackageView,
  type NdInvocationRequest,
} from '../../shared/nd-invocations.js'
import type { OrganizationMutation, OrganizationSnapshot } from '../../shared/organization.js'
import { BUILTIN_EXTENSION_PACKAGES, defaultActivationContexts, WALLPAPER_MANAGER_ID } from '../../shared/builtin-extension-packages.js'
import { captureDisplayUnderPointer, captureScreenRegion } from '../capture/app-capture.js'
import {
  applyWallpaperFromFolder,
  cycleWallpaper,
  getActiveWallpaperState,
  listWallpapersInFolder,
  normalizeWallpaperPath,
  resolveDefaultWallpaperFolder,
  setDesktopWallpaper,
} from '../os/wallpaper.js'
import { ProcessInventory } from '../os/process-inventory.js'
import type { BrowserController } from '../browser/browser-controller.js'
import type { WorkflowService } from '../workflows/workflow-service.js'
import type { HomeStore } from '../home/home-store.js'
import type { ExtensionPackageStore } from './package-store.js'
import type { InvocationBroker, NdOrganizationPort } from './invocation-broker.js'
import type { InvocationStateStore } from './invocation-state.js'
import type { NativeHostRegistry } from './native-host.js'
import { NdTranslateService, type TranslateBrowserPort } from './translate-service.js'
import { ND_TRANSLATE_ID } from '../../shared/nd-translate.js'

export interface NdOrganizationPortFull extends NdOrganizationPort {
  mutate(mutation: OrganizationMutation): Promise<unknown>
  policy(companyId: string, action: string): Promise<'allow' | 'ask' | 'deny'>
}

export interface NdIpcDependencies {
  window: BrowserWindow
  /** The launcher popup renderer; admitted for launcher-facing extension channels only. */
  launcherPopup?: () => BrowserWindow | null
  home: HomeStore
  packages: ExtensionPackageStore
  state: InvocationStateStore
  broker: InvocationBroker
  host: NativeHostRegistry
  organization: NdOrganizationPortFull
  browser: Pick<BrowserController, 'navigate'> & TranslateBrowserPort
  workflow: Pick<WorkflowService, 'projectView' | 'refresh'>
  /** Notified after ND Home records change, so other services can re-derive views. */
  onHomeChanged?: () => void
}

const NOTE_TITLE_MAX = 80
const MAX_OPEN_TARGETS = 1
const QUIT_PROCESS_ID = 'nd.quit-process'

function quitProcessPackagePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'nd-extensions', 'quit-process')
    : join(app.getAppPath(), 'extensions', 'quit-process')
}

function translatePackagePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'nd-extensions', 'translate')
    : join(app.getAppPath(), 'extensions', 'translate')
}

/**
 * The ND extension invocation surface plus the ND Home personal surface. Every
 * handler runs in the trusted main process, is registered on narrow channels
 * admitted only from the primary renderer (or the launcher popup for the
 * launcher-facing subset), and delegates authorization to the broker.
 */
export function registerNdExtensionIpc(deps: NdIpcDependencies): () => void {
  const channels: string[] = []
  let seeded: Promise<void> | undefined
  let wallpaperTimer: NodeJS.Timeout | null = null

  const syncWallpaperRotation = async (): Promise<void> => {
    if (wallpaperTimer) {
      clearInterval(wallpaperTimer)
      wallpaperTimer = null
    }
    try {
      const personalContext: NdContext = { kind: 'personal' }
      const activation = await deps.state.activation(WALLPAPER_MANAGER_ID, personalContext)
      if (!activation?.enabled) return
      const intervalMinutes = typeof activation.settings.intervalMinutes === 'number' ? activation.settings.intervalMinutes : 0
      if (intervalMinutes <= 0) return
      const folder = typeof activation.settings.folder === 'string' && activation.settings.folder ? activation.settings.folder : undefined
      const mode = activation.settings.mode === 'random' ? 'random' : 'next'
      const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000
      wallpaperTimer = setInterval(() => {
        void cycleWallpaper({ folder, mode }).catch(() => undefined)
      }, intervalMs)
    } catch {
      // Ignore background rotation failure
    }
  }

  const ensureSeeded = (): Promise<void> => {
    seeded ??= seedBuiltinPackages(deps).then(() => {
      void syncWallpaperRotation()
    })
    return seeded
  }

  const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertNdSender(event, deps.window)
      await ensureSeeded()
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  // The launcher popup is a separate sandboxed renderer; it may list and run
  // contributions but reaches no management or Home channel.
  const handleLauncherSurface = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== deps.window.webContents || event.senderFrame !== deps.window.webContents.mainFrame) {
        const popup = deps.launcherPopup?.() ?? null
        if (!popup || popup.isDestroyed() || event.sender !== popup.webContents || event.senderFrame !== popup.webContents.mainFrame) {
          throw new Error('Rejected ND extension IPC from an untrusted renderer frame')
        }
      }
      await ensureSeeded()
      return listener(event, ...args)
    })
    channels.push(channel)
  }

  const stateView = async (): Promise<NdExtensionsStateView> => {
    const state = await deps.broker.stateView()
    return { ...state, available: await Promise.all([quitProcessCatalogView(state), translateCatalogView(state)]) }
  }
  const emitState = async (): Promise<void> => {
    if (deps.window.isDestroyed()) return
    deps.window.webContents.send(ND_EXTENSIONS_IPC.changedEvent, await stateView())
  }
  const homeView = async () => deps.home.state()
  const emitHome = async (): Promise<void> => {
    if (deps.window.isDestroyed()) return
    deps.window.webContents.send(ND_HOME_IPC.changedEvent, await homeView())
  }

  const disposeNativeHost = registerNativeHostHandlers(deps)

  deps.broker.setOnApprovalRequested(() => { void emitState() })
  deps.home.setOnChanged(() => { void emitHome(); deps.onHomeChanged?.() })

  // --- Extension packages ----------------------------------------------------

  handle(ND_EXTENSIONS_IPC.state, () => stateView())

  handle(ND_EXTENSIONS_IPC.installLocal, async () => {
    const result = await dialog.showOpenDialog(deps.window, {
      title: 'Choose an extension package folder',
      properties: ['openDirectory'],
    })
    const selected = result.filePaths[0]
    if (result.canceled || !selected) return null
    await deps.packages.installFromDirectory(selected)
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.installFromPath, async (_event, rawPath) => {
    await deps.packages.installFromDirectory(absolutePath(rawPath))
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.installAvailable, async (_event, extensionId) => {
    if (extensionId !== QUIT_PROCESS_ID && extensionId !== ND_TRANSLATE_ID) throw new Error('Unknown available ND extension')
    const packagePath = extensionId === ND_TRANSLATE_ID ? translatePackagePath() : quitProcessPackagePath()
    if (!existsSync(join(packagePath, 'nd-extension.json'))) throw new Error('This extension is missing from this ND build')
    await deps.packages.installFromDirectory(packagePath, { expectId: extensionId })
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.update, async (_event, extensionId, rawPath) => {
    const id = shortId(extensionId, 'Extension id')
    const record = await deps.packages.record(id)
    if (!record) throw new Error(`Unknown extension package: ${id}`)
    const sourcePath = typeof rawPath === 'string' && rawPath.trim()
      ? absolutePath(rawPath)
      : record.source.kind === 'local' || record.source.kind === 'git' ? record.source.location : undefined
    if (!sourcePath) throw new Error('This package records no local source; choose the updated package folder')
    await deps.packages.installFromDirectory(sourcePath, { expectId: id })
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.rollback, async (_event, extensionId) => {
    const id = shortId(extensionId, 'Extension id')
    await deps.packages.rollback(id)
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.uninstall, async (_event, extensionId) => {
    const id = shortId(extensionId, 'Extension id')
    await deps.packages.uninstall(id)
    // Uninstall revokes activation and executable access; personal notes and
    // captures are user data and stay untouched.
    await deps.state.revokeActivationsForExtension(id)
    await deps.state.revokeGrantsForExtension(id)
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.setActivation, async (_event, extensionId, context, enabled) => {
    const id = shortId(extensionId, 'Extension id')
    const target = await deps.broker.resolveContext(asNdContext(context))
    const manifest = await deps.packages.activeManifest(id)
    if (!manifest) throw new Error(`Unknown extension package: ${id}`)
    await deps.state.setActivation(id, target, enabled === true)
    if (enabled !== true) await deps.state.revokeGrantsForExtension(id)
    if (id === WALLPAPER_MANAGER_ID) void syncWallpaperRotation()
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.setSetting, async (_event, extensionId, context, key, value) => {
    const id = shortId(extensionId, 'Extension id')
    const target = await deps.broker.resolveContext(asNdContext(context))
    const manifest = await deps.packages.activeManifest(id)
    if (!manifest) throw new Error(`Unknown extension package: ${id}`)
    const field = manifest.settings.find((setting) => setting.key === key)
    if (!field) throw new Error(`Unknown setting for ${manifest.name}: ${String(key)}`)
    if (typeof value !== field.type) throw new Error(`"${field.title}" must be a ${field.type}`)
    await deps.state.setSetting(id, target, field.key, value)
    if (id === WALLPAPER_MANAGER_ID) void syncWallpaperRotation()
    await emitState()
    return stateView()
  })

  handle(ND_EXTENSIONS_IPC.revokeGrant, async (_event, grantId) => {
    await deps.state.revokeGrant(shortId(grantId, 'Grant id'))
    await emitState()
    return stateView()
  })

  handleLauncherSurface(ND_EXTENSIONS_IPC.commands, async (_event, context) => deps.broker.commands(await deps.broker.resolveContext(asNdContext(context))))

  handleLauncherSurface(ND_EXTENSIONS_IPC.invoke, async (_event, request) => {
    if (!request || typeof request !== 'object') throw new Error('An invocation request is required')
    // A renderer can only ever act as the user: agent authority arrives solely
    // through run credentials minted trusted-side.
    const result = await deps.broker.invoke({ ...(request as NdInvocationRequest), caller: 'user' })
    if (!result.ok && result.error?.code !== 'approval-required') await emitState()
    return result
  })

  handle(ND_EXTENSIONS_IPC.view, async (_event, extensionId, viewId, context) =>
    deps.broker.loadView(shortId(extensionId, 'Extension id'), shortId(viewId, 'View id'), await deps.broker.resolveContext(asNdContext(context))))

  handle(ND_EXTENSIONS_IPC.approve, async (_event, approvalId, remember) => {
    const result = await deps.broker.approve(shortId(approvalId, 'Approval id'), remember === true)
    await emitState()
    return result
  })

  handle(ND_EXTENSIONS_IPC.deny, async (_event, approvalId) => {
    await deps.broker.deny(shortId(approvalId, 'Approval id'))
    await emitState()
  })

  // --- ND Home ---------------------------------------------------------------

  handle(ND_HOME_IPC.state, () => homeView())

  handle(ND_HOME_IPC.noteCreate, async (_event, input) => {
    const request = asNoteInput(input)
    await deps.home.createNote({ ...request, context: request.context ?? { kind: 'personal' } })
    return homeView()
  })

  handle(ND_HOME_IPC.noteUpdate, async (_event, id, input) => {
    await deps.home.updateNote(shortId(id, 'Note id'), asNoteInput(input))
    return homeView()
  })

  handle(ND_HOME_IPC.noteDelete, async (_event, id) => {
    await deps.home.deleteNote(shortId(id, 'Note id'))
    return homeView()
  })

  handle(ND_HOME_IPC.noteSearch, (_event, query) => deps.home.searchNotes(typeof query === 'string' ? query : ''))

  handle(ND_HOME_IPC.captureScreen, async () => {
    const image = await captureDisplayUnderPointer()
    const record = await deps.home.addCapture(image, { kind: 'personal' })
    return { captureId: record.id, width: record.width, height: record.height, displayLabel: record.displayLabel, data: image.data }
  })

  handle(ND_HOME_IPC.captureArea, async (_event, rawRect) => {
    const rect = asRect(rawRect)
    if (!rect) return null
    const image = await captureScreenRegion(rect)
    const record = await deps.home.addCapture(image, { kind: 'personal' })
    return { captureId: record.id, width: record.width, height: record.height, displayLabel: record.displayLabel, data: image.data }
  })

  handle(ND_HOME_IPC.captureRead, async (_event, id) => deps.home.readCapture(shortId(id, 'Capture id')))

  handle(ND_HOME_IPC.captureDelete, async (_event, id) => {
    await deps.home.deleteCapture(shortId(id, 'Capture id'))
    return homeView()
  })

  handle(ND_HOME_IPC.captureAttach, async (_event, id, sessionId) => {
    await deps.home.attachCapture(shortId(id, 'Capture id'), shortId(sessionId, 'Session id'))
    return homeView()
  })

  handle(ND_HOME_IPC.chatEnsure, async (_event, context) => deps.home.ensureChat(await deps.broker.resolveContext(asNdContext(context))))

  handle(ND_HOME_IPC.chatBind, async (_event, chatId, sessionId) =>
    deps.home.bindChatSession(shortId(chatId, 'Chat id'), shortId(sessionId, 'Session id')))

  handle(ND_HOME_IPC.chatTitle, async (_event, sessionId, title) => {
    await deps.home.setChatTitle(shortId(sessionId, 'Session id'), typeof title === 'string' ? title : '')
    return homeView()
  })

  handle(ND_HOME_IPC.reveal, async () => {
    const root = deps.home.storageRoot()
    if (!existsSync(root)) await fs.mkdir(root, { recursive: true })
    const error = await shell.openPath(root)
    if (error) throw new Error(error)
  })

  // Seeding happens before the first state read; failures stay visible instead
  // of silently shipping a half-registered platform.
  void ensureSeeded().catch((error) => console.warn('ND built-in extension packages failed to seed:', error))

  return () => {
    disposeNativeHost()
    if (wallpaperTimer) clearInterval(wallpaperTimer)
    for (const channel of channels) ipcMain.removeHandler(channel)
    deps.broker.setOnApprovalRequested(undefined)
    deps.home.setOnChanged(undefined)
  }
}

/**
 * Register the allowlisted native host methods. These closures are the only
 * bridge between extension contributions and trusted services: no arbitrary
 * IPC, shell strings, or renderer code ever crosses this boundary.
 */
export function registerNativeHostHandlers(deps: NdIpcDependencies): () => void {
  const { host } = deps
  const organization = deps.organization
  const translator = new NdTranslateService(deps.browser)
  host.register('browser.translate', async (input) => translator.translate(input))
  const processes = new ProcessInventory(undefined, () => [
    process.pid,
    ...app.getAppMetrics().map((metric) => metric.pid),
  ])

  host.register('note.create', async (input, context) => {
    const text = requiredText(input.text, 'Note text', 64_000)
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string') : []
    if (context.context.kind === 'personal') {
      const note = await deps.home.createNote({ body: text, tags, context: context.context })
      return { noteId: note.id, title: note.title }
    }
    await organization.mutate({
      type: 'memory.add',
      companyId: context.context.companyId,
      ...(context.context.kind === 'project' ? { projectId: context.context.projectId } : {}),
      title: firstLine(text, NOTE_TITLE_MAX),
      content: text,
      tags,
    })
    return { noteId: `memory:${firstLine(text, NOTE_TITLE_MAX)}`, title: firstLine(text, NOTE_TITLE_MAX) }
  })

  host.register('note.search', async (input, context) => {
    const query = typeof input.query === 'string' ? input.query : ''
    const target = context.context
    if (target.kind === 'personal') {
      const notes = await deps.home.searchNotes(query, target)
      return notes.map((note) => ({ id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt }))
    }
    const snapshot = await organization.state()
    const needle = query.trim().toLowerCase()
    return snapshot.memory
      .filter((entry) => entry.companyId === target.companyId)
      .filter((entry) => target.kind !== 'project' || entry.projectId === target.projectId || entry.projectId === undefined)
      .filter((entry) => !needle || entry.title.toLowerCase().includes(needle) || entry.content.toLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((entry) => ({ id: entry.id, title: entry.title, body: entry.content, updatedAt: entry.updatedAt }))
  })

  host.register('note.open', async (input, context) => {
    const id = requiredText(input.noteId, 'Note id', 160)
    const target = context.context
    if (target.kind === 'personal') {
      const notes = await deps.home.listNotes(target)
      const note = notes.find((item) => item.id === id)
      if (!note) throw new Error('That note no longer exists')
      return { id: note.id, title: note.title, body: note.body }
    }
    const snapshot = await organization.state()
    const entry = snapshot.memory.find((item) => item.id === id && item.companyId === target.companyId)
    if (!entry) throw new Error('That note no longer exists in this company')
    return { id: entry.id, title: entry.title, body: entry.content }
  })

  host.register('note.delete', async (input, context) => {
    const id = requiredText(input.noteId, 'Note id', 160)
    if (context.context.kind !== 'personal') {
      // Company/project memory belongs to the organization store, which has no
      // removal mutation yet; fail closed instead of pretending it was deleted.
      throw new Error('Company and project notes cannot be deleted from an extension yet; delete them in the Company workspace')
    }
    await deps.home.deleteNote(id)
    return { deleted: true }
  })

  host.register('capture.screen', async (input, context) => {
    const displayId = typeof input.displayId === 'number' && Number.isFinite(input.displayId) ? input.displayId : undefined
    const image = await captureDisplayUnderPointer(displayId)
    const record = await deps.home.addCapture(image, context.context)
    return { captureId: record.id, width: record.width, height: record.height, displayLabel: record.displayLabel }
  })

  host.register('capture.area', async (input, context) => {
    const rect = asRect(input.rect)
    if (!rect) throw new Error('Capture area needs the selected rectangle from the overlay')
    const image = await captureScreenRegion(rect)
    const record = await deps.home.addCapture(image, context.context)
    return { captureId: record.id, width: record.width, height: record.height, displayLabel: record.displayLabel }
  })

  host.register('capture.list', async (_input, context) => {
    const state = await deps.home.state()
    const key = contextKey(context.context)
    return state.captures
      .filter((capture) => capture.contextKey === key)
      .map((capture) => ({
        id: capture.id,
        title: capture.name,
        detail: `${capture.displayLabel} · ${new Date(capture.createdAt).toLocaleString()}`,
        status: capture.attachedSessionId ? 'attached' : 'local',
      }))
  })

  host.register('capture.copy', async (input) => {
    const id = requiredText(input.captureId, 'Capture id', 160)
    const capture = await deps.home.readCapture(id)
    if (!capture) throw new Error('That capture is no longer available')
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(capture.data, 'base64')))
    return { copied: true }
  })

  host.register('capture.export', async (input) => {
    const id = requiredText(input.captureId, 'Capture id', 160)
    const path = await deps.home.capturePath(id)
    if (!path) throw new Error('That capture is no longer available')
    const result = await dialog.showSaveDialog(deps.window, {
      title: 'Export capture',
      defaultPath: join(app.getPath('pictures'), basename(path)),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return { exported: false }
    await fs.copyFile(path, result.filePath)
    return { exported: true, path: result.filePath }
  })

  host.register('clipboard.read', async (_input, context) => {
    // An explicit user command authorizes exactly this one read; agent callers
    // reach this handler only through a grant or a per-action approval.
    const text = clipboard.readText().trim()
    if (!text) throw new Error('The clipboard does not contain text to capture')
    if (context.context.kind === 'personal') {
      const note = await deps.home.createNote({ body: text, tags: ['capture', 'clipboard'], context: context.context })
      return { noteId: note.id, title: note.title }
    }
    await organization.mutate({
      type: 'memory.add',
      companyId: context.context.companyId,
      ...(context.context.kind === 'project' ? { projectId: context.context.projectId } : {}),
      title: firstLine(text, NOTE_TITLE_MAX),
      content: text,
      tags: ['capture', 'clipboard'],
    })
    return { title: firstLine(text, NOTE_TITLE_MAX) }
  })

  host.register('clipboard.write', async (input) => {
    const text = typeof input.text === 'string' ? input.text : ''
    if (!text.trim()) throw new Error('There is nothing to copy')
    clipboard.writeText(text.slice(0, 256_000))
    return { copied: true }
  })

  host.register('browser.openUrl', async (input) => {
    const url = typeof input.url === 'string' && input.url.trim() ? httpUrl(input.url) : 'https://www.google.com'
    await deps.browser.navigate(url)
    return { url, surface: 'browser' }
  })

  host.register('browser.search', async (input, context) => {
    const query = requiredText(input.query, 'Search query', 512)
    const prefix = typeof context.settings.searchPrefix === 'string' ? context.settings.searchPrefix : 'https://www.google.com/search?q='
    const base = httpUrl(prefix.endsWith('=') || prefix.endsWith('/') ? prefix : `${prefix}${prefix.includes('?') ? '&q=' : '?q='}`)
    const url = `${base}${encodeURIComponent(query)}`
    await deps.browser.navigate(url)
    return { url, surface: 'browser' }
  })

  host.register('browser.openExternal', async (input) => {
    const url = httpUrl(requiredText(input.url, 'URL', 8_192))
    await shell.openExternal(url)
    return { url, surface: 'external' }
  })

  host.register('os.openTarget', async (input) => {
    const kind = input.kind === 'app' ? 'app' : input.kind === 'folder' ? 'folder' : 'file'
    const filters = kind === 'app' && process.platform === 'win32'
      ? [{ name: 'Applications', extensions: ['exe', 'lnk', 'bat', 'cmd'] }]
      : undefined
    const result = await dialog.showOpenDialog(deps.window, {
      title: kind === 'app' ? 'Choose an application' : kind === 'folder' ? 'Choose a folder' : 'Choose a file',
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile'],
      ...(filters ? { filters } : {}),
    })
    if (result.canceled || result.filePaths.length === 0 || result.filePaths.length > MAX_OPEN_TARGETS) return { opened: false }
    const target = result.filePaths[0]!
    const error = await shell.openPath(target)
    if (error) throw new Error(error)
    return { opened: true, path: target }
  })

  host.register('os.wallpaper.chooseAndSet', async () => {
    // The extension never supplies a filesystem path. ND owns the native picker
    // and passes the selected image directly to a fixed OS adapter.
    const result = await dialog.showOpenDialog(deps.window, {
      title: 'Choose desktop wallpaper',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] },
      ],
    })
    if (result.canceled || result.filePaths.length !== 1) return { changed: false }
    const target = result.filePaths[0]!
    await setDesktopWallpaper(target)
    return { changed: true, path: target, platform: process.platform }
  })

  host.register('os.wallpaper.next', async (_input, context) => {
    const folder = typeof context.settings?.folder === 'string' && context.settings.folder ? context.settings.folder : undefined
    const result = await cycleWallpaper({ folder, mode: 'next' })
    return { changed: result.changed, name: result.name, path: result.path }
  })

  host.register('os.wallpaper.previous', async (_input, context) => {
    const folder = typeof context.settings?.folder === 'string' && context.settings.folder ? context.settings.folder : undefined
    const result = await cycleWallpaper({ folder, mode: 'previous' })
    return { changed: result.changed, name: result.name, path: result.path }
  })

  host.register('os.wallpaper.random', async (_input, context) => {
    const folder = typeof context.settings?.folder === 'string' && context.settings.folder ? context.settings.folder : undefined
    const result = await cycleWallpaper({ folder, mode: 'random' })
    return { changed: result.changed, name: result.name, path: result.path }
  })

  host.register('os.wallpaper.setFolder', async (_input, context) => {
    const defaultPath = typeof context.settings?.folder === 'string' && context.settings.folder.trim()
      ? context.settings.folder.trim()
      : resolveDefaultWallpaperFolder()
    const result = await dialog.showOpenDialog(deps.window, {
      title: 'Choose wallpaper folder',
      defaultPath,
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length !== 1) return { changed: false }
    const selected = result.filePaths[0]!
    await deps.state.setSetting(WALLPAPER_MANAGER_ID, context.context, 'folder', selected)
    const items = await listWallpapersInFolder(selected)
    return { changed: true, folder: selected, count: items.length }
  })

  host.register('os.wallpaper.applySelected', async (input, context) => {
    const filename = requiredText(input.id ?? input.filename ?? input.path, 'Wallpaper file', 4096)
    const folder = normalizeWallpaperPath(typeof input?.folder === 'string' ? input.folder : undefined)
      || normalizeWallpaperPath(typeof context.settings?.folder === 'string' ? context.settings.folder : undefined)
      || undefined
    const result = await applyWallpaperFromFolder(folder, filename)
    return { changed: result.changed, name: result.name, path: result.path }
  })

  host.register('os.wallpaper.preview', async (input, context) => {
    const filename = requiredText(input.id ?? input.filename ?? input.path, 'Wallpaper file', 4096)
    const folder = normalizeWallpaperPath(typeof input?.folder === 'string' ? input.folder : undefined)
      || normalizeWallpaperPath(typeof context.settings?.folder === 'string' ? context.settings.folder : undefined)
      || undefined
    const targetFolder = folder || resolveDefaultWallpaperFolder()
    let targetPath = filename
    let exists = false
    try {
      await fs.access(filename)
      exists = true
      targetPath = filename
    } catch {
      // not direct/absolute
    }
    if (!exists) {
      try {
        const candidate = join(targetFolder, filename)
        await fs.access(candidate)
        exists = true
        targetPath = candidate
      } catch {
        // try basename
      }
    }
    if (!exists) {
      targetPath = join(targetFolder, basename(filename))
      await fs.access(targetPath)
    }
    const safeName = basename(targetPath)
    const img = nativeImage.createFromPath(targetPath)
    if (img.isEmpty()) throw new Error('Could not read image file')
    const originalSize = img.getSize()
    const previewImg = (originalSize.width > 1920 || originalSize.height > 1080)
      ? img.resize({ width: Math.min(1920, originalSize.width), height: Math.min(1080, Math.round(originalSize.height * (1920 / Math.max(1, originalSize.width)))) })
      : img
    const dataUrl = previewImg.toDataURL()
    const thumbnail = img.resize({ width: 240, quality: 'good' }).toDataURL()
    const fileStat = await fs.stat(targetPath)
    return {
      id: safeName,
      filename: safeName,
      path: targetPath,
      dataUrl,
      thumbnail,
      width: originalSize.width,
      height: originalSize.height,
      size: fileStat.size,
      modifiedAt: fileStat.mtimeMs,
    }
  })

  host.register('os.wallpaper.status', async (input, context) => {
    const inputFolder = normalizeWallpaperPath(typeof input?.folder === 'string' ? input.folder : undefined)
    const settingFolder = normalizeWallpaperPath(typeof context.settings?.folder === 'string' ? context.settings.folder : undefined)
    const folder = inputFolder || settingFolder || undefined
    const items = await listWallpapersInFolder(folder)
    const active = getActiveWallpaperState()
    return items.map((item, index) => {
      const isActive = active.path === item.path || (active.path !== null && active.path.endsWith(item.filename))
      let thumbnail: string | undefined
      if (index < 60) {
        try {
          const img = nativeImage.createFromPath(item.path)
          if (!img.isEmpty()) {
            thumbnail = img.resize({ width: 240, quality: 'good' }).toDataURL()
          }
        } catch {
          // fallback to undefined
        }
      }
      return {
        id: item.filename,
        title: item.filename,
        detail: `${Math.round(item.size / 1024)} KB · ${item.path}`,
        status: isActive ? 'Active' : undefined,
        thumbnail,
        path: item.path,
        size: item.size,
        modifiedAt: item.modifiedAt,
        sortValues: { size: item.size, date: item.modifiedAt },
      }
    })
  })

  host.register('process.list', async () => processes.list())

  const quitProcess = async (input: Record<string, unknown>, force: boolean): Promise<{ quit: boolean }> => {
    const id = requiredText(input.id, 'Process selection', 160)
    const selected = await processes.resolve(id)
    const result = await dialog.showMessageBox(deps.window, {
      type: 'warning',
      title: force ? 'Force quit process?' : 'Quit process?',
      message: `${force ? 'Force quit' : 'Quit'} ${selected.name} (PID ${selected.pid})?`,
      detail: force
        ? 'The process will stop immediately and may lose unsaved work.'
        : 'The process will be asked to stop. Unsaved work may be lost.',
      buttons: ['Cancel', force ? 'Force quit' : 'Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (result.response !== 1) return { quit: false }
    await processes.quit(id, force)
    return { quit: true }
  }
  host.register('process.quit', async (input) => quitProcess(input, false))
  host.register('process.forceQuit', async (input) => quitProcess(input, true))

  host.register('chat.ask', async (input, context) => {
    if (context.caller === 'agent') throw new Error('Starting a chat on ND’s behalf is a user action; ask the user to open ND Home')
    const text = requiredText(input.text, 'Chat prompt', 20_000)
    return { text, contextKey: contextKey(context.context) }
  })

  host.register('workflow.list', async (_input, context) => {
    const view = await workflowView(deps, context.context)
    return view
  })

  host.register('workflow.refresh', async (_input, context) => {
    if (context.context.kind !== 'project') throw new Error('Repository tasks require a project context')
    await deps.workflow.refresh(context.context.companyId, context.context.projectId)
    return workflowView(deps, context.context)
  })
  return () => translator.dispose()
}

async function translateCatalogView(state: NdExtensionsStateView): Promise<NdAvailablePackageView> {
  return packageCatalogView(state, ND_TRANSLATE_ID, translatePackagePath(), {
    name: 'ND Translate', description: 'Translate text with Google Translate, ChatGPT, or Gemini in the ND browser.', permissions: ['browser.navigate'],
  })
}

async function quitProcessCatalogView(state: NdExtensionsStateView): Promise<NdAvailablePackageView> {
  return packageCatalogView(state, QUIT_PROCESS_ID, quitProcessPackagePath(), {
    name: 'Quit Processes', description: 'Inspect running processes and quit a selected process from ND.', permissions: ['process.read', 'process.quit'],
  })
}

async function packageCatalogView(state: NdExtensionsStateView, id: string, packagePath: string, metadata: Pick<NdAvailablePackageView, 'name' | 'description' | 'permissions'>): Promise<NdAvailablePackageView> {
  const path = join(packagePath, 'nd-extension.json')
  const fallback: NdAvailablePackageView = {
    id,
    ...metadata,
    version: '1.0.0',
    installed: state.packages.some((item) => item.id === id),
    available: false,
  }
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path, 'utf8'))
    const validated = validateNdExtensionManifest(parsed)
    if (!validated.ok || validated.manifest.id !== id || manifestPermissionIssues(validated.manifest).length > 0) return fallback
    return {
      id: validated.manifest.id,
      name: validated.manifest.name,
      description: validated.manifest.description,
      version: validated.manifest.version,
      permissions: validated.manifest.permissions,
      installed: fallback.installed,
      available: true,
    }
  } catch {
    return fallback
  }
}

async function workflowView(deps: NdIpcDependencies, context: { kind: string; companyId?: string; projectId?: string }): Promise<unknown[]> {
  if (context.kind !== 'project' || !context.companyId || !context.projectId) {
    throw new Error('Repository tasks require a project context')
  }
  const view = await deps.workflow.projectView(context.companyId, context.projectId)
  if (!view.binding && !view.snapshot) throw new Error('Bind the project workflow integration before opening repository tasks')
  const tasks = view.snapshot?.tasks ?? []
  return tasks
    .filter((task) => !task.archived)
    .map((task) => ({
      id: task.key ?? task.sourcePath,
      title: task.title,
      detail: [task.displayStatus ?? task.lifecycle, task.outcome, task.prdRefs.join(' ')].filter(Boolean).join(' · '),
      status: task.displayStatus ?? task.lifecycle,
    }))
}

/** Seed ND-maintained packages and their Personal activations exactly once. */
async function seedBuiltinPackages(deps: NdIpcDependencies): Promise<void> {
  for (const manifest of BUILTIN_EXTENSION_PACKAGES) {
    await deps.packages.registerBuiltin(manifest)
    for (const kind of defaultActivationContexts(manifest)) {
      const context = kind === 'personal' ? { kind: 'personal' as const } : undefined
      if (!context) continue
      const existing = await deps.state.activation(manifest.id, context)
      if (!existing) await deps.state.setActivation(manifest.id, context, true)
    }
  }
}

async function installPreparedPackage(deps: NdIpcDependencies, sourcePath: string): Promise<void> {
  await deps.packages.installFromDirectory(sourcePath)
}

function assertNdSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Rejected ND extension IPC from an untrusted renderer frame')
  }
}

function absolutePath(value: unknown): string {
  const path = requiredText(value, 'Package folder', 4_096)
  if (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith('/') && !path.startsWith('\\\\')) {
    throw new Error('Package folder must be an absolute path')
  }
  return path
}

function shortId(value: unknown, label: string): string {
  return requiredText(value, label, 160)
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`${label} must be at most ${max} characters`)
  return trimmed
}

function firstLine(text: string, max: number): string {
  const line = text.split(/\r?\n/)[0]?.trim() ?? ''
  return line.slice(0, max) || 'Quick note'
}

function httpUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('URL must be a valid absolute web address')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http and https URLs are supported')
  return parsed.toString()
}

function asRect(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const numbers = [record.x, record.y, record.width, record.height]
  if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return undefined
  const rect = { x: record.x as number, y: record.y as number, width: record.width as number, height: record.height as number }
  if (rect.width <= 0 || rect.height <= 0) return undefined
  return rect
}

function asNoteInput(value: unknown): { body: string; title?: string; tags?: string[]; context?: NdContext } {
  if (!value || typeof value !== 'object') throw new Error('Note input is required')
  const record = value as Record<string, unknown>
  const body = requiredText(record.body, 'Note text', 64_000)
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0).map((tag) => tag.trim().slice(0, 48)).slice(0, 16)
    : undefined
  const context = record.context === undefined ? undefined : asNdContext(record.context)
  return {
    body,
    ...(typeof record.title === 'string' && record.title.trim() ? { title: record.title.trim().slice(0, 160) } : {}),
    ...(tags ? { tags } : {}),
    ...(context ? { context } : {}),
  }
}

/** Probe that the host allowlist and the registry cannot drift apart. */
export function missingNativeHostMethods(host: NativeHostRegistry): NdHostMethod[] {
  return host.missing(ND_HOST_METHODS.map((method) => method.id))
}
