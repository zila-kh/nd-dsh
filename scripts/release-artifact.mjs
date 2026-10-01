import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { electronTargetIdentity } from './e2e-electron-target.mjs'

/** Resolve one current-version artifact; old packages must never satisfy release checks. */
export function releaseArtifact(root, configured) {
  let executable
  if (configured?.trim()) {
    executable = resolve(configured)
  } else {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const dist = join(root, 'dist')
    const prefix = `ND-DSH-${version}-private-beta-`
    const names = existsSync(dist) ? readdirSync(dist).filter((name) => name.startsWith(prefix)
      && name.endsWith('.exe') && statSync(join(dist, name)).isFile()) : []
    if (names.length !== 1) throw new Error(`Expected one Windows portable artifact for ${version}; found ${names.length}.`)
    executable = join(dist, names[0])
  }
  return electronTargetIdentity({ ND_DSH_E2E_EXECUTABLE: executable })
}
