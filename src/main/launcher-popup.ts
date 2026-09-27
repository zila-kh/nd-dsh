import { BrowserWindow, screen, type Display } from 'electron'
import { IPC } from '../shared/contracts.js'
import type { LauncherHandoffTarget } from '../shared/quick-launcher.js'

const LAUNCHER_POPUP_WIDTH = 700
const LAUNCHER_POPUP_HEIGHT = 540

export interface LauncherPopupController {
  /** Raycast-style: hidden → show, visible → hide. */
  toggle(): void
  hide(): void
  /** Hide the popup, bring the full app window forward, and forward the picked action. */
  handoff(target: LauncherHandoffTarget, text?: string): void
  /** The popup window when it exists; used to admit its renderer to trusted desktop IPC. */
  window(): BrowserWindow | null
}

/**
 * Owns the frameless launcher popup window: a second sandboxed renderer on the
 * same preload and bundle under #/launcher that draws only the quick launcher
 * card. Created lazily on first toggle so a user who never touches the global
 * shortcut pays nothing for it.
 */
export function createLauncherPopup(options: {
  preloadPath: string
  getMainWindow: () => BrowserWindow | undefined
}): LauncherPopupController {
  const { preloadPath, getMainWindow } = options
  let popup: BrowserWindow | null = null

  const ensureWindow = (): BrowserWindow | null => {
    if (popup && !popup.isDestroyed()) return popup
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return null
    const currentUrl = main.webContents.getURL()
    if (!currentUrl) return null
    popup = new BrowserWindow({
      width: LAUNCHER_POPUP_WIDTH,
      height: LAUNCHER_POPUP_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    popup.setAlwaysOnTop(true, 'floating')
    popup.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    void popup.loadURL(`${currentUrl.split('#')[0]}#/launcher`)
    popup.on('closed', () => {
      popup = null
    })
    // Focus leaving the popup (click into another app) dismisses it, like
    // Raycast. Hide instead of destroy so the next toggle reuses the surface.
    popup.on('blur', () => {
      if (popup && !popup.isDestroyed() && popup.isVisible()) popup.hide()
    })
    return popup
  }

  const displayForPopup = (): Display => {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    } catch {
      return screen.getPrimaryDisplay()
    }
  }

  const showPopup = (target: BrowserWindow): void => {
    const { x, y, width, height } = displayForPopup().workArea
    target.setBounds({
      x: Math.round(x + (width - LAUNCHER_POPUP_WIDTH) / 2),
      y: Math.round(y + Math.max(0, (height - LAUNCHER_POPUP_HEIGHT) / 3)),
      width: LAUNCHER_POPUP_WIDTH,
      height: LAUNCHER_POPUP_HEIGHT,
    })
    target.show()
    target.focus()
  }

  const toggle = (): void => {
    if (popup && !popup.isDestroyed() && popup.isVisible()) {
      popup.hide()
      return
    }
    const ensured = ensureWindow()
    if (!ensured) return
    if (ensured.webContents.isLoading()) {
      ensured.once('ready-to-show', () => {
        if (!ensured.isDestroyed() && !ensured.isVisible()) showPopup(ensured)
      })
      return
    }
    showPopup(ensured)
  }

  const hide = (): void => {
    if (popup && !popup.isDestroyed()) popup.hide()
  }

  const handoff = (target: LauncherHandoffTarget, text?: string): void => {
    hide()
    const main = getMainWindow()
    if (!main || main.isDestroyed()) return
    if (main.isMinimized()) main.restore()
    main.show()
    main.setAlwaysOnTop(true)
    main.focus()
    main.setAlwaysOnTop(false)
    main.webContents.send(IPC.windowLauncherHandoffEvent, target, text)
  }

  return {
    toggle,
    hide,
    handoff,
    window: () => (popup && !popup.isDestroyed() ? popup : null),
  }
}
