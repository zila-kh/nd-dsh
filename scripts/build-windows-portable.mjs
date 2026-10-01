import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPortableBuildStaging } from './portable-build-staging.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const packagePath = require.resolve('electron-builder/package.json')
const cli = resolve(dirname(packagePath), JSON.parse(readFileSync(packagePath, 'utf8')).bin['electron-builder'])
function build(args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--publish', 'never'], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error || new Error('Windows package build failed: ' + result.status)
}
if (process.platform !== 'win32') throw new Error('Windows portable release builds must run on Windows.')
build(['--win', '--dir'])
await withPortableBuildStaging(root, async (staged) => build(['--win', 'portable', '--prepackaged', staged]))
