#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const HOST = 'com.nddsh.browser_companion'

function arg(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length)
}

const extensionId = arg('extension-id')?.trim()
if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
  throw new Error('Pass the unpacked Chrome extension id: --extension-id=<32 lowercase a-p characters>')
}

const defaultBinary = process.platform === 'win32'
  ? resolve('target/release/nd-browser-host.exe')
  : resolve('target/release/nd-browser-host')
const hostPath = resolve(arg('host-path')?.trim() || defaultBinary)

await fs.access(hostPath)
const manifest = {
  name: HOST,
  description: 'ND Browser Companion native host',
  path: hostPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
}

const manifestPath = await writeManifest(manifest)
if (process.platform === 'win32') {
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`
  await execFileAsync('reg.exe', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true })
}
process.stdout.write(`Registered ${HOST}\nManifest: ${manifestPath}\nHost: ${hostPath}\nExtension: ${extensionId}\n`)

async function writeManifest(value) {
  let path
  if (process.platform === 'darwin') {
    path = join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`)
  } else if (process.platform === 'linux') {
    path = join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST}.json`)
  } else {
    path = join(homedir(), '.nd-dsh', 'native-messaging', `${HOST}.json`)
  }
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return path
}
