import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { LocalRuntimeSettings, LocalRuntimeState } from '../../shared/local-runtime.js'

const DEFAULT_SETTINGS: LocalRuntimeSettings = {
  version: 1,
  alwaysOn: false,
  startAtLogin: false,
}

export interface LocalRuntimeAppPort {
  isPackaged: boolean
  getLoginItemSettings(options?: { args?: string[] }): { openAtLogin: boolean; wasOpenedAtLogin?: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void
}

export class LocalRuntimeService {
  private loaded = false
  private settingsValue: LocalRuntimeSettings = { ...DEFAULT_SETTINGS }
  private readonly startedAt = Date.now()
  private background = false
  private lastSchedulerTickAt: number | undefined
  private lastHeartbeatTickAt: number | undefined
  private lastEventTickAt: number | undefined
  private onChanged: ((state: LocalRuntimeState) => void) | undefined

  constructor(
    private readonly filePath: string,
    private readonly appPort: LocalRuntimeAppPort,
    private readonly platform: NodeJS.Platform,
  ) {}

  async initialize(): Promise<LocalRuntimeState> {
    await this.load()
    if ((!this.settingsValue.alwaysOn || !this.canManageStartAtLogin()) && this.settingsValue.startAtLogin) {
      this.settingsValue.startAtLogin = false
      await this.save()
    }
    this.applyLoginItem()
    return this.state()
  }

  setOnChanged(listener: ((state: LocalRuntimeState) => void) | undefined): void {
    this.onChanged = listener
  }

  settings(): LocalRuntimeSettings {
    return { ...this.settingsValue }
  }

  isAlwaysOn(): boolean {
    return this.settingsValue.alwaysOn
  }

  shouldLaunchInBackground(argv: readonly string[]): boolean {
    if (!this.settingsValue.alwaysOn) return false
    if (argv.includes('--background')) return true
    if (this.platform !== 'darwin' || !this.appPort.isPackaged) return false
    try {
      return this.appPort.getLoginItemSettings().wasOpenedAtLogin === true
    } catch {
      return false
    }
  }

  setBackground(background: boolean): void {
    if (this.background === background) return
    this.background = background
    this.emit()
  }

  noteSchedulerTick(at = Date.now()): void {
    this.lastSchedulerTickAt = at
    this.emit()
  }

  noteHeartbeatTick(at = Date.now()): void {
    this.lastHeartbeatTickAt = at
    this.emit()
  }

  noteEventTick(at = Date.now()): void {
    this.lastEventTickAt = at
    this.emit()
  }

  async state(): Promise<LocalRuntimeState> {
    await this.load()
    const supported = this.canManageStartAtLogin()
    let applied = false
    if (supported) {
      try {
        applied = this.platform === 'win32'
          ? this.appPort.getLoginItemSettings({ args: ['--background'] }).openAtLogin
          : this.appPort.getLoginItemSettings().openAtLogin
      } catch (error) {
        console.warn('Failed to read ND start-at-login state:', error)
      }
    }
    return {
      settings: { ...this.settingsValue },
      startedAt: this.startedAt,
      background: this.background,
      startAtLoginSupported: supported,
      startAtLoginApplied: applied,
      ...(this.lastSchedulerTickAt ? { lastSchedulerTickAt: this.lastSchedulerTickAt } : {}),
      ...(this.lastHeartbeatTickAt ? { lastHeartbeatTickAt: this.lastHeartbeatTickAt } : {}),
      ...(this.lastEventTickAt ? { lastEventTickAt: this.lastEventTickAt } : {}),
    }
  }

  async update(patch: Partial<Pick<LocalRuntimeSettings, 'alwaysOn' | 'startAtLogin'>>): Promise<LocalRuntimeState> {
    await this.load()
    this.settingsValue = {
      ...this.settingsValue,
      ...(patch.alwaysOn !== undefined ? { alwaysOn: Boolean(patch.alwaysOn) } : {}),
      ...(patch.startAtLogin !== undefined ? { startAtLogin: Boolean(patch.startAtLogin) } : {}),
    }
    if ((!this.settingsValue.alwaysOn || !this.canManageStartAtLogin()) && this.settingsValue.startAtLogin) {
      this.settingsValue.startAtLogin = false
    }
    await this.save()
    this.applyLoginItem()
    const next = await this.state()
    this.onChanged?.(next)
    return next
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<LocalRuntimeSettings>
      if (parsed.version === 1) {
        this.settingsValue = {
          version: 1,
          alwaysOn: parsed.alwaysOn === true,
          startAtLogin: parsed.startAtLogin === true,
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.warn('Failed to load local runtime settings:', error)
      }
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    const content = `${JSON.stringify(this.settingsValue)}\n`
    try {
      await fs.writeFile(temp, content, 'utf8')
      await fs.rename(temp, this.filePath)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private canManageStartAtLogin(): boolean {
    return this.appPort.isPackaged && (this.platform === 'win32' || this.platform === 'darwin')
  }

  private applyLoginItem(): void {
    if (!this.canManageStartAtLogin()) return
    try {
      this.appPort.setLoginItemSettings({
        openAtLogin: this.settingsValue.alwaysOn && this.settingsValue.startAtLogin,
        ...(this.platform === 'win32' ? { args: ['--background'] } : {}),
      })
    } catch (error) {
      console.warn('Failed to apply ND start-at-login setting:', error)
    }
  }

  private emit(): void {
    if (!this.onChanged) return
    void this.state().then((state) => this.onChanged?.(state)).catch(() => undefined)
  }
}
