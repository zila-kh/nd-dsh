import { app, nativeTheme, type BrowserWindow, type TitleBarOverlay } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import type { EffectiveTheme, ThemeMode, ThemeState } from '../shared/contracts.js'

const SETTINGS_FILE = 'settings.json'

interface PersistedSettings {
  theme?: ThemeMode
}

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

/**
 * Owns the user's theme preference. The renderer reads the effective theme
 * (resolved against the OS when in `system` mode) and applies it as a
 * `data-theme` attribute; this service keeps the native window chrome and the
 * embedded browser view in sync and persists the choice across restarts.
 */
export class ThemeService {
  private readonly settingsPath: string
  private mode: ThemeMode
  private window: BrowserWindow | undefined
  private setViewBackground: ((color: string) => void) | undefined
  private onChanged: ((state: ThemeState) => void) | undefined

  constructor() {
    this.settingsPath = join(app.getPath('userData'), SETTINGS_FILE)
    this.mode = this.readMode()
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

  private persist(): void {
    try {
      writeFileSync(this.settingsPath, `${JSON.stringify({ theme: this.mode }, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn('Failed to persist theme preference:', error)
    }
  }
}
