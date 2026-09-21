import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bundledResourceRoot, dshPatchPath, harnessRoot, presetSourceDir, projectRoot } from '../src/main/app-paths.js'

/**
 * electron-builder splits a packaged ND install in two: the application code
 * (and the `package.json` that path discovery probes for) stays inside
 * `app.asar`, while the Harness, `configs/dsh`, and release scripts are staged
 * as `extraResources` beside it. Every one of these assertions fails if payload
 * resolution goes through the archive instead of the resources directory.
 */
const electronState = vi.hoisted(() => ({
  packaged: false,
  appPath: '',
  userData: '',
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronState.packaged
    },
    getAppPath: () => electronState.appPath,
    getPath: () => electronState.userData,
  },
}))

const RESOURCES = 'resources'
const ARCHIVE = 'app.asar'
const overrides = ['ND_DSH_PROJECT_ROOT', 'ND_DSH_HARNESS_ROOT', 'ND_DSH_PATCH', 'ND_DSH_PRESET_DIR', 'ND_DSH_MANAGED_RUNTIME_ROOT'] as const

let root = ''
const savedEnvironment = new Map<string, string | undefined>()

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nd-dsh-paths-'))
  const resources = join(root, RESOURCES)
  const archive = join(root, ARCHIVE)
  // The archive carries the application manifest; the resources directory
  // deliberately does not, which is what defeats a `package.json` probe.
  mkdirSync(archive, { recursive: true })
  writeFileSync(join(archive, 'package.json'), '{"name":"nd-dsh"}')
  mkdirSync(join(resources, 'configs', 'dsh', 'agent-presets'), { recursive: true })
  mkdirSync(join(resources, 'vendor', 'deepseek-harness'), { recursive: true })
  writeFileSync(join(resources, 'configs', 'dsh', 'nd-dsh.patch.yml'), '')
  writeFileSync(join(resources, 'vendor', 'deepseek-harness', 'package.json'), '{"name":"dsh-root"}')

  electronState.appPath = archive
  electronState.userData = join(root, 'userData')
  for (const key of overrides) {
    savedEnvironment.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  savedEnvironment.clear()
  rmSync(root, { recursive: true, force: true })
})

function packaged(packagedState: boolean): void {
  electronState.packaged = packagedState
  Object.assign(process, { resourcesPath: join(root, RESOURCES) })
}

describe('bundled runtime payload roots', () => {
  it('resolves packaged payloads against the resources directory, not app.asar', () => {
    packaged(true)

    expect(bundledResourceRoot()).toBe(join(root, RESOURCES))
    expect(projectRoot()).toBe(join(root, ARCHIVE))
    expect(harnessRoot()).toBe(join(root, RESOURCES, 'vendor', 'deepseek-harness'))
    expect(dshPatchPath()).toBe(join(root, RESOURCES, 'configs', 'dsh', 'nd-dsh.patch.yml'))
    expect(presetSourceDir()).toBe(join(root, RESOURCES, 'configs', 'dsh', 'agent-presets'))
  })

  it('keeps source checkouts resolving against the repository root', () => {
    packaged(false)
    electronState.appPath = root
    writeFileSync(join(root, 'package.json'), '{"name":"nd-dsh-source"}')

    expect(projectRoot()).toBe(root)
    expect(bundledResourceRoot()).toBe(root)
    expect(harnessRoot()).toBe(join(root, 'vendor', 'deepseek-harness'))
    expect(dshPatchPath()).toBe(join(root, 'configs', 'dsh', 'nd-dsh.patch.yml'))
  })

  it('still honours explicit payload overrides in a packaged build', () => {
    packaged(true)
    process.env.ND_DSH_PATCH = join(root, 'override.yml')
    process.env.ND_DSH_PRESET_DIR = join(root, 'override-presets')

    expect(dshPatchPath()).toBe(join(root, 'override.yml'))
    expect(presetSourceDir()).toBe(join(root, 'override-presets'))
  })
})
