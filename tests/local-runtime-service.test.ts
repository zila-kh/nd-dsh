import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalRuntimeService, type LocalRuntimeAppPort } from '../src/main/local-runtime/local-runtime-service.js'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(initialOpenAtLogin = false) {
  const root = await mkdtemp(join(tmpdir(), 'nd-local-runtime-'))
  temporary.push(root)
  const path = join(root, 'local-runtime.json')
  let openAtLogin = initialOpenAtLogin
  const setLoginItemSettings = vi.fn((settings: { openAtLogin: boolean }) => {
    openAtLogin = settings.openAtLogin
  })
  const appPort: LocalRuntimeAppPort = {
    isPackaged: true,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings,
  }
  return { path, appPort, setLoginItemSettings, service: new LocalRuntimeService(path, appPort, 'win32') }
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
