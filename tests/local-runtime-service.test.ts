import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRuntimeService, type LocalRuntimeAppPort } from '../src/main/local-runtime/local-runtime-service.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(
  initialOpenAtLogin = false,
  platform: NodeJS.Platform = 'win32',
  wasOpenedAtLogin = false,
  isPackaged = true,
) {
  const root = await mkdtemp(join(tmpdir(), 'nd-local-runtime-'))
  temporary.push(root)
  const path = join(root, 'local-runtime.json')
  let openAtLogin = initialOpenAtLogin
  const getLoginItemSettings = vi.fn((_options?: { args?: string[] }) => ({ openAtLogin, wasOpenedAtLogin }))
  const setLoginItemSettings = vi.fn((settings: { openAtLogin: boolean }) => {
    openAtLogin = settings.openAtLogin
  })
  const appPort: LocalRuntimeAppPort = {
    isPackaged,
    getLoginItemSettings,
    setLoginItemSettings,
  }
  return { path, appPort, getLoginItemSettings, setLoginItemSettings, service: new LocalRuntimeService(path, appPort, platform) }
}

describe('LocalRuntimeService', () => {
  it('defaults to foreground-only and persists Always-On + start-at-login atomically', async () => {
    const { path, appPort, service, setLoginItemSettings } = await fixture()
    expect((await service.initialize()).settings).toEqual({ version: 1, alwaysOn: false, startAtLogin: false })

    let state = await service.update({ alwaysOn: true, startAtLogin: true })
    expect(state.settings).toEqual({ version: 1, alwaysOn: true, startAtLogin: true })
    expect(state.startAtLoginApplied).toBe(true)
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, args: ['--background'] })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, alwaysOn: true, startAtLogin: true })

    const reloaded = new LocalRuntimeService(path, appPort, 'win32')
    state = await reloaded.initialize()
    expect(state.settings.alwaysOn).toBe(true)
    expect(state.settings.startAtLogin).toBe(true)
  })

  it('cannot leave start-at-login enabled when Always-On is disabled', async () => {
    const { service, setLoginItemSettings } = await fixture()
    await service.initialize()
    await service.update({ alwaysOn: true, startAtLogin: true })
    const state = await service.update({ alwaysOn: false })
    expect(state.settings).toEqual({ version: 1, alwaysOn: false, startAtLogin: false })
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, args: ['--background'] })
  })

  it('reports background state and scheduler/heartbeat/event liveness without writing a model turn', async () => {
    const { service } = await fixture()
    await service.initialize()
    const changed: number[] = []
    service.setOnChanged((state) => changed.push(
      Number(Boolean(state.lastSchedulerTickAt))
      + Number(Boolean(state.lastHeartbeatTickAt))
      + Number(Boolean(state.lastEventTickAt)),
    ))
    service.setBackground(true)
    service.noteSchedulerTick(100)
    service.noteHeartbeatTick(200)
    service.noteEventTick(300)
    const state = await service.state()
    expect(state.background).toBe(true)
    expect(state.lastSchedulerTickAt).toBe(100)
    expect(state.lastHeartbeatTickAt).toBe(200)
    expect(state.lastEventTickAt).toBe(300)
    expect(changed.at(-1)).toBe(3)
  })

  it('starts hidden from the Windows login argument only when Always-On is enabled', async () => {
    const { service } = await fixture(false, 'win32')
    await service.initialize()
    expect(service.shouldLaunchInBackground(['nd-dsh', '--background'])).toBe(false)
    await service.update({ alwaysOn: true })
    expect(service.shouldLaunchInBackground(['nd-dsh', '--background'])).toBe(true)
    expect(service.shouldLaunchInBackground(['nd-dsh'])).toBe(false)
  })

  it('detects a packaged macOS login launch without relying on Windows-only args', async () => {
    const { service, getLoginItemSettings, setLoginItemSettings } = await fixture(false, 'darwin', true)
    await service.initialize()
    await service.update({ alwaysOn: true, startAtLogin: true })
    expect(service.shouldLaunchInBackground(['nd-dsh'])).toBe(true)
    expect(setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true })
    expect(getLoginItemSettings).toHaveBeenCalledWith()
  })

  it('does not advertise start-at-login from an unpackaged dev build', async () => {
    const { service, setLoginItemSettings } = await fixture(false, 'win32', false, false)
    await service.initialize()
    const state = await service.update({ alwaysOn: true, startAtLogin: true })
    expect(state.settings.alwaysOn).toBe(true)
    expect(state.settings.startAtLogin).toBe(false)
    expect(state.startAtLoginSupported).toBe(false)
    expect(state.startAtLoginApplied).toBe(false)
    expect(setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('does not claim unsupported Linux start-at-login integration', async () => {
    const { path, appPort } = await fixture()
    const service = new LocalRuntimeService(path, appPort, 'linux')
    await service.initialize()
    const state = await service.update({ alwaysOn: true, startAtLogin: true })
    expect(state.settings.startAtLogin).toBe(false)
    expect(state.startAtLoginSupported).toBe(false)
    expect(state.startAtLoginApplied).toBe(false)
  })
})
