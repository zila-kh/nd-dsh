import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
const self = fileURLToPath(import.meta.url)
if (process.argv[2] === '--leaf') {
  setInterval(() => {}, 1_000)
} else {
  const child = spawn(process.execPath, [self, '--leaf'], { stdio: 'ignore', windowsHide: true })
  process.stdout.write(JSON.stringify({ childPid: child.pid }) + '\n')
  setInterval(() => {}, 1_000)
}
