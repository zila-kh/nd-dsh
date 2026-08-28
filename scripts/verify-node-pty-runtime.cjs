'use strict'

const os = require('node:os')
const process = require('node:process')
const pty = require('node-pty')

const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh')
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'echo ND_DSH_PTY_OK']
  : ['-lc', 'printf ND_DSH_PTY_OK']

const terminal = pty.spawn(shell, args, {
  cols: 80,
  rows: 24,
  cwd: os.tmpdir(),
  env: process.env,
})

let output = ''
const timeout = setTimeout(() => {
  terminal.kill()
  console.error('node-pty runtime smoke timed out')
  process.exitCode = 1
}, 10_000)

terminal.onData((chunk) => {
  output += chunk
})

terminal.onExit(({ exitCode }) => {
  clearTimeout(timeout)
  if (exitCode !== 0 || !output.includes('ND_DSH_PTY_OK')) {
    console.error(`node-pty runtime smoke failed (exit ${exitCode}): ${JSON.stringify(output)}`)
    process.exit(1)
    return
  }
  console.log('node-pty runtime smoke passed')
  process.exit(0)
})
