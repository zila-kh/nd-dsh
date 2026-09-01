import { app, nativeTheme, type BrowserWindow, type TitleBarOverlay } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { DshSurface, EffectiveTheme, ThemeMode, ThemeState } from '../shared/contracts.js'

const SETTINGS_FILE = 'settings.json'
const DEFAULT_PERMISSION_MODE = 'workspace-write'

interface PersistedSettings {
  theme?: ThemeMode
  surface?: DshSurface
  permissionMode?: string
}

export const PERMISSION_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const

interface WindowPalette {
  backgroundColor: string
  titleBar: TitleBarOverlay
}

const WINDOW_PALETTES: Record<EffectiveTheme, WindowPalette> = {
  light: {
    backgroundColor: '#f4f5f7',
    titleBar: { color: '#eef0f3', symbolColor: '#1a2027', height: 38 },
  },
  dark: {
    backgroundColor: '#0b0d10',
    titleBar: { color: '#101319', symbolColor: '#c5cad3', height: 38 },
  },
}

const BROWSER_VIEW_BACKGROUND: Record<EffectiveTheme, string> = {
  light: '#e9ebee',
  dark: '#080a0d',
}

const VALID_MODES: readonly ThemeMode[] = ['system', 'light', 'dark']
const VALID_SURFACES: readonly DshSurface[] = ['dsh', 'workbench']

/**
 * Owns the user's persisted preferences (settings.json): the theme and the
 * active UI surface. The renderer reads the effective theme (resolved against
 * the OS when in `system` mode) and applies it as a `data-theme` attribute;
 * this service keeps the native window chrome and the embedded views in sync
 * and persists the choices across restarts.
 */
export class ThemeService {
  private readonly settingsPath: string
  private mode: ThemeMode
  private surfaceValue: DshSurface
  private permissionModeValue: string
  private window: BrowserWindow | undefined
  private setViewBackground: ((color: string) => void) | undefined
  private onChanged: ((state: ThemeState) => void) | undefined
  private onSurfaceChanged: ((surface: DshSurface) => void) | undefined

  constructor() {
    this.settingsPath = join(app.getPath('userData'), SETTINGS_FILE)
    this.mode = this.readMode()
    this.surfaceValue = this.readSurface()
    this.permissionModeValue = process.env.ND_DSH_PERMISSION_MODE?.trim() || this.readPermissionMode()
    nativeTheme.themeSource = this.mode
    nativeTheme.on('updated', () => this.emit())
  }

  state(): ThemeState {
    return { mode: this.mode, effective: this.effective() }
  }

  set(mode: ThemeMode): ThemeState {
    if (!VALID_MODES.includes(mode)) throw new Error(`Unknown theme mode: ${mode}`)
    this.mode = mode
    nativeTheme.themeSource = mode
    this.persist()
    this.applyWindowChrome()
    this.emit()
    return this.state()
  }

  surface(): DshSurface {
    return this.surfaceValue
  }

  setSurface(surface: DshSurface): DshSurface {
    if (!VALID_SURFACES.includes(surface)) throw new Error(`Unknown surface: ${surface}`)
    this.surfaceValue = surface
    this.persist()
    this.onSurfaceChanged?.(surface)
    return surface
  }

  permissionMode(): string {
    return this.permissionModeValue
  }

  setPermissionMode(mode: string): string {
    if (!PERMISSION_MODES.includes(mode as (typeof PERMISSION_MODES)[number])) {
      throw new Error(`Unknown permission mode: ${mode}`)
    }
    this.permissionModeValue = mode
    this.persist()
    return mode
  }

  windowBackgroundColor(): string {
    return WINDOW_PALETTES[this.effective()].backgroundColor
  }

  titleBarOverlay(): TitleBarOverlay {
    return WINDOW_PALETTES[this.effective()].titleBar
  }

  /** Attach the live window so theme changes re-paint native chrome. */
  attach(window: BrowserWindow, setViewBackground: (color: string) => void): void {
    this.window = window
    this.setViewBackground = setViewBackground
    this.applyWindowChrome()
  }

  setOnChanged(listener: (state: ThemeState) => void): void {
    this.onChanged = listener
  }

  setOnSurfaceChanged(listener: (surface: DshSurface) => void): void {
    this.onSurfaceChanged = listener
  }

  private effective(): EffectiveTheme {
    if (this.mode !== 'system') return this.mode
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  }

  private applyWindowChrome(): void {
    if (!this.window || this.window.isDestroyed()) return
    const palette = WINDOW_PALETTES[this.effective()]
    this.window.setBackgroundColor(palette.backgroundColor)
    if (process.platform !== 'darwin') this.window.setTitleBarOverlay(palette.titleBar)
    this.setViewBackground?.(BROWSER_VIEW_BACKGROUND[this.effective()])
  }

  private emit(): void {
    if (this.window && !this.window.isDestroyed()) this.onChanged?.(this.state())
  }

  private readMode(): ThemeMode {
    try {
      const settings = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as PersistedSettings
      if (settings.theme && VALID_MODES.includes(settings.theme)) return settings.theme
    } catch {
      // Missing or unreadable settings fall back to following the OS.
    }
    return 'system'
  }

  private readSurface(): DshSurface {
    try {
      const settings = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as PersistedSettings
      if (settings.surface && VALID_SURFACES.includes(settings.surface)) return settings.surface
    } catch {
      // Missing or unreadable settings keep ND as the primary coding surface.
    }
    return 'workbench'
  }

  private readPermissionMode(): string {
    try {
      const settings = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as PersistedSettings
      if (settings.permissionMode && PERMISSION_MODES.includes(settings.permissionMode as (typeof PERMISSION_MODES)[number])) {
        return settings.permissionMode
      }
    } catch {
      // Missing or unreadable settings fall back to workspace-write.
    }
    return DEFAULT_PERMISSION_MODE
  }

  private persist(): void {
    try {
      const settings: PersistedSettings = {
        theme: this.mode,
        surface: this.surfaceValue,
        permissionMode: this.permissionModeValue,
      }
      writeFileSync(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn('Failed to persist settings:', error)
    }
  }
}
