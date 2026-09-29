import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserExtensionPopupContext } from '../shared/browser-platform.js'

// Must equal BROWSER_EXTENSION_POPUP_IPC.context. Importing the value would make
// the bundler split shared code into a chunk, and sandboxed preloads cannot
// require local files.
const POPUP_CONTEXT_CHANNEL = 'browser-extension-popup:context'

// Loaded as the preload of ND-hosted action popups and as the session's
// service-worker preload. Service-worker preloads run in every worker of the
// session, including websites', and their preload realm has no `location`, so
// the extension-origin check happens in the main world.
contextBridge.executeInMainWorld({
  func: installExtensionCompat,
  args: [process.type === 'service-worker'
    ? null
    : () => ipcRenderer.invoke(POPUP_CONTEXT_CHANNEL) as Promise<BrowserExtensionPopupContext>],
})

type ChromeTab = { id?: number; active?: boolean; highlighted?: boolean; index?: number; [key: string]: unknown }
type QueryInfo = Record<string, unknown>

// Serialized into the extension's main world: must not reference anything
// outside its own body.
function installExtensionCompat(loadPopupContext: (() => Promise<BrowserExtensionPopupContext>) | null): void {
  if (globalThis.location?.protocol !== 'chrome-extension:') return
  const chromeApi = (globalThis as { chrome?: Record<string, any> }).chrome
  if (!chromeApi?.runtime?.getManifest) return

  const settle = <T>(promise: Promise<T>, callback: unknown, fallback: T): Promise<T> | undefined => {
    if (typeof callback !== 'function') return promise
    const done = callback as (value: T) => void
    promise.then(done, (error: unknown) => {
      console.error(error)
      done(fallback)
    })
    return undefined
  }
  const define = (target: Record<string, unknown>, name: string, value: unknown) => {
    try {
      Object.defineProperty(target, name, { value, configurable: true, enumerable: true, writable: true })
    } catch {
      target[name] = value
    }
  }
  // ND never changes an extension's grants or shortcuts at runtime, so these
  // events can never fire.
  const inertEvent = () => ({
    addListener: () => undefined,
    removeListener: () => undefined,
    hasListener: () => false,
    hasListeners: () => false,
  })

  // Chromium also exposes a separate `browser` object that shares the native
  // namespaces with `chrome`; anything added here must be visible through both.
  const roots = [chromeApi, (globalThis as { browser?: Record<string, any> }).browser]
    .filter((root, index, all): root is Record<string, any> =>
      Boolean(root) && typeof root === 'object' && all.indexOf(root) === index)
  const provide = (name: string, create: () => unknown) => {
    let value: unknown
    for (const root of roots) {
      if (root[name]) continue
      value ??= create()
      define(root, name, value)
    }
  }

  const manifest = chromeApi.runtime.getManifest() as Record<string, any>

  // Electron grants exactly the manifest's required permissions at load and
  // never grants optional ones, which is what this reports.
  provide('permissions', () => {
    const isOrigin = (value: string) => value === '<all_urls>' || value.includes('://')
    const declared: string[] = [
      ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
      ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
    ].filter((value): value is string => typeof value === 'string')
    const granted = {
      permissions: [...new Set(declared.filter((value) => !isOrigin(value)))],
      origins: [...new Set(declared.filter(isOrigin))],
    }
    const coversOrigin = (pattern: string) =>
      granted.origins.includes(pattern)
      || granted.origins.includes('<all_urls>')
      || (granted.origins.includes('*://*/*') && /^(\*|https?):\/\//.test(pattern))
    const contains = (request?: { permissions?: string[]; origins?: string[] }) =>
      (request?.permissions ?? []).every((permission) => granted.permissions.includes(permission))
      && (request?.origins ?? []).every(coversOrigin)
    return {
      getAll: (callback?: unknown) => settle(
        Promise.resolve({ permissions: [...granted.permissions], origins: [...granted.origins] }), callback, undefined),
      contains: (request: unknown, callback?: unknown) =>
        settle(Promise.resolve(contains(request as never)), callback, false),
      request: (request: unknown, callback?: unknown) =>
        settle(Promise.resolve(contains(request as never)), callback, false),
      remove: (_request: unknown, callback?: unknown) => settle(Promise.resolve(false), callback, false),
      onAdded: inertEvent(),
      onRemoved: inertEvent(),
    }
  })

  // ND does not bind extension keyboard shortcuts, so every command is unbound.
  provide('commands', () => {
    const commands = manifest.commands && typeof manifest.commands === 'object' ? manifest.commands as Record<string, any> : {}
    return {
      getAll: (callback?: unknown) => settle(Promise.resolve(Object.entries(commands).map(([name, command]) => ({
        name,
        description: typeof command?.description === 'string' ? command.description : '',
        shortcut: '',
      }))), callback, []),
      onCommand: inertEvent(),
    }
  })

  // Electron's chrome.tabs counts every WebContents in the session as a tab,
  // derives `active` from keyboard focus, and ignores window filters, so a
  // focused action popup reports itself as the active tab. Chrome never treats
  // a popup as a tab: scope tab queries to ND's tab strip and the tab the popup
  // was opened over.
  const tabs = chromeApi.tabs as Record<string, unknown> | undefined
  if (!loadPopupContext || !tabs || typeof tabs.query !== 'function') return

  const WINDOW_ID_NONE = -1
  const WINDOW_ID_CURRENT = -2
  const nativeQuery = (tabs.query as (info: QueryInfo) => Promise<ChromeTab[]>).bind(tabs)

  const scope = async (filters: QueryInfo) => {
    const context = await loadPopupContext().catch(() => undefined)
    if (!context) return undefined
    const order = new Map(context.tabIds.map((id, index) => [id, index] as const))
    const list = (await nativeQuery(filters))
      .filter((tab) => typeof tab.id === 'number' && order.has(tab.id))
      .sort((a, b) => order.get(a.id!)! - order.get(b.id!)!)
      .map((tab) => {
        const active = tab.id === context.hostTabId
        return {
          ...tab,
          active,
          highlighted: active,
          selected: active,
          index: order.get(tab.id!)!,
          windowId: context.windowId,
          pinned: false,
          incognito: false,
          discarded: false,
          autoDiscardable: true,
          groupId: -1,
        }
      })
    return { context, tabs: list }
  }

  const query = (queryInfo?: QueryInfo, callback?: unknown) => settle((async () => {
    const info = queryInfo ?? {}
    const filters: QueryInfo = {}
    for (const key of ['url', 'title', 'audible', 'muted']) {
      if (info[key] !== undefined) filters[key] = info[key]
    }
    const scoped = await scope(filters)
    if (!scoped) return nativeQuery(info)
    const { context } = scoped
    return scoped.tabs.filter((tab) => {
      if (info.active !== undefined && tab.active !== info.active) return false
      if (info.highlighted !== undefined && tab.highlighted !== info.highlighted) return false
      if (info.currentWindow === false || info.lastFocusedWindow === false) return false
      if (typeof info.windowId === 'number' && info.windowId !== WINDOW_ID_CURRENT && info.windowId !== context.windowId) return false
      if (info.windowType !== undefined && info.windowType !== 'normal') return false
      if (typeof info.index === 'number' && tab.index !== info.index) return false
      if (info.pinned === true || info.discarded === true || info.autoDiscardable === false) return false
      if (typeof info.groupId === 'number' && info.groupId !== -1) return false
      return true
    })
  })(), callback, [] as ChromeTab[])

  define(tabs, 'query', query)
  // A popup is not a tab, so Chrome resolves getCurrent to undefined there.
  define(tabs, 'getCurrent', (callback?: unknown) => settle(Promise.resolve(undefined), callback, undefined))

  const describe = async (options?: { populate?: boolean }) => {
    const scoped = await scope({})
    if (!scoped) throw new Error('No current window')
    return {
      id: scoped.context.windowId,
      focused: true,
      incognito: false,
      alwaysOnTop: false,
      type: 'normal',
      state: 'normal',
      ...(options?.populate ? { tabs: scoped.tabs } : {}),
    }
  }
  const split = (options: unknown, callback: unknown): [{ populate?: boolean } | undefined, unknown] =>
    typeof options === 'function' ? [undefined, options] : [options as { populate?: boolean } | undefined, callback]
  const current = (options?: unknown, callback?: unknown) => {
    const [opts, done] = split(options, callback)
    return settle(describe(opts), done, undefined)
  }
  provide('windows', () => ({
    WINDOW_ID_NONE,
    WINDOW_ID_CURRENT,
    getCurrent: current,
    getLastFocused: current,
    get: (windowId: number, options?: unknown, callback?: unknown) => {
      const [opts, done] = split(options, callback)
      return settle(describe(opts).then((window) => {
        if (windowId !== WINDOW_ID_CURRENT && windowId !== window.id) throw new Error(`No window with id: ${windowId}.`)
        return window
      }), done, undefined)
    },
    getAll: (options?: unknown, callback?: unknown) => {
      const [opts, done] = split(options, callback)
      return settle(describe(opts).then((window) => [window]), done, [])
    },
  }))
}
