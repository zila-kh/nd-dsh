#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const openPencilRoot = join(root, 'vendor', 'openpencil')
const manifestPath = join(openPencilRoot, 'Cargo.toml')
const binaryName = process.platform === 'win32' ? 'op-host-web-server.exe' : 'op-host-web-server'
const builtBinary = join(openPencilRoot, 'target', 'release', binaryName)
const stagedDirectory = join(root, 'resources', 'openpencil', 'bin')
const stagedBinary = join(stagedDirectory, binaryName)

if (!existsSync(manifestPath)) {
  throw new Error('Pinned OpenPencil source is missing. Run `pnpm bootstrap -- --check` or initialize vendor/openpencil first.')
}

await run('cargo', ['build', '--release', '-p', 'op-host-web-server', '--manifest-path', manifestPath], root)
if (!existsSync(builtBinary)) throw new Error(`OpenPencil build completed without ${builtBinary}`)

await fs.mkdir(stagedDirectory, { recursive: true })
await fs.copyFile(builtBinary, stagedBinary)
if (process.platform !== 'win32') await fs.chmod(stagedBinary, 0o755)

console.log(`\nOpenPencil Freeform runtime staged for ND: ${stagedBinary}`)
console.log('Packaged ND builds should copy resources/openpencil into process.resourcesPath/openpencil.')

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited with code ${String(code)}`))
    })
  })
}
