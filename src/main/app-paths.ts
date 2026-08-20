import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))

function candidateProjectRoots(): string[] {
  const values = [
    process.env.ND_DSH_PROJECT_ROOT,
    app.isPackaged ? process.resourcesPath : undefined,
    app.getAppPath(),
    resolve(currentDirectory, '../../..'),
    process.cwd(),
  ]
  return values.filter((value): value is string => Boolean(value))
}

export function projectRoot(): string {
  for (const root of candidateProjectRoots()) {
    if (existsSync(join(root, 'package.json'))) return root
  }
  return app.getAppPath()
}

export function harnessRoot(): string {
  return resolve(process.env.ND_DSH_HARNESS_ROOT ?? join(projectRoot(), 'vendor/deepseek-harness'))
}

/** The dsh CLI launcher bin: boots the `web` profile the desktop shells. */
export function harnessCliBinPath(): string {
  return join(harnessRoot(), 'apps/cli/lib/bin.js')
}

/** ND-DSH's patch overlay applied on top of the web profile. */
export function dshPatchPath(): string {
  return resolve(process.env.ND_DSH_PATCH ?? join(projectRoot(), 'configs/dsh/nd-dsh.patch.yml'))
}

/** Shipped ND-DSH agent presets (installed into the harness home at launch). */
export function presetSourceDir(): string {
  return resolve(process.env.ND_DSH_PRESET_DIR ?? join(projectRoot(), 'configs/dsh/agent-presets'))
}
