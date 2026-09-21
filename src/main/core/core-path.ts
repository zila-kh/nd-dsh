import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { projectRoot } from '../app-paths.js'

export function ndCoreBinaryPath(): string {
  const override = process.env.ND_DSH_CORE_BIN?.trim()
  if (override) return resolve(override)

  const executable = process.platform === 'win32' ? 'nd-core.exe' : 'nd-core'
  if (app.isPackaged) return join(process.resourcesPath, 'nd-core', executable)

  const profile = process.env.ND_DSH_CORE_PROFILE === 'release' ? 'release' : 'debug'
  return join(projectRoot(), 'target', profile, executable)
}

export function assertNdCoreBinary(path = ndCoreBinaryPath()): string {
  if (!existsSync(path)) {
    throw new Error('ND Core binary is missing at ' + path + '. Run pnpm core:build:dev for development or stage a release build.')
  }
  return path
}
