import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { spawnCliCommand } from '../src/main/engines/agent-cli/agent-cli-support.js'

/**
 * `cmd.exe` parses its `/c` command string line by line, so a newline inside an
 * argument ends the command and the rest is parsed as further commands. ND's
 * prompts are multi-line by construction (`workerPrompt`/`reviewPrompt`), so a
 * `.cmd`-shimmed engine used to receive only the first line of every prompt and
 * still report success. These tests inspect the child's argv to prove the whole
 * prompt arrives. They are Windows-only: no shim exists elsewhere.
 */
const PROMPT = [
  'You are Builder acting as Software Engineer inside company Fixture Co.',
  'Second line carries a "quote", an & ampersand and a | pipe.',
  'Third line.',
  'Fourth line ends the prompt.',
].join('\n')

const root = mkdtempSync(join(tmpdir(), 'nd-cli-shim-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function writeShim(name: string, body: string[]): string {
  const path = join(root, name)
  writeFileSync(path, body.join('\r\n'))
  return path
}

/** The npm/pnpm shim shape: forward to a node script through `%dp0%`. */
function writeNodeShim(name: string): string {
  writeFileSync(
    join(root, 'print-argv.cjs'),
    'process.stdout.write(JSON.stringify({' +
      'argvCount: process.argv.length - 2,' +
      'promptLength: (process.argv[2] ?? "").length,' +
      'lineCount: (process.argv[2] ?? "").split("\\n").length,' +
      'hasDoubleQuote: (process.argv[2] ?? "").includes(\'"\'),' +
      'hasAmp: (process.argv[2] ?? "").includes("&"),' +
      'hasPipe: (process.argv[2] ?? "").includes("|"),' +
      '}))\n',
  )
  return writeShim(name, [
    '@ECHO off',
    'SETLOCAL',
    'SET dp0=%~dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    'endLocal & "%_prog%"  "%dp0%\\print-argv.cjs" %*',
  ])
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCliCommand(spawn, bin, args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let out = ''
    child.stdout?.on('data', (chunk) => { out += String(chunk) })
    child.once('error', reject)
    child.once('close', () => resolvePromise(out))
  })
}

describe.skipIf(process.platform !== 'win32')('Windows CLI shim argument transport', () => {
  it('delivers a multi-line prompt intact to a .cmd-shimmed engine', async () => {
    const seen = JSON.parse(await run(writeNodeShim('fixture-tool.cmd'), [PROMPT])) as Record<string, unknown>
    expect(seen.promptLength).toBe(PROMPT.length)
    expect(seen.lineCount).toBe(4)
    expect(seen.argvCount).toBe(1)
  })

  it('keeps quotes, ampersands and pipes out of the command parser', async () => {
    const seen = JSON.parse(await run(writeNodeShim('fixture-meta.cmd'), [PROMPT])) as Record<string, unknown>
    expect(seen.hasDoubleQuote).toBe(true)
    expect(seen.hasAmp).toBe(true)
    expect(seen.hasPipe).toBe(true)
  })

  it('still spawns a .cmd that is not a node shim', async () => {
    const bin = writeShim('plain-tool.cmd', ['@ECHO off', 'echo FALLBACK-OK'])
    expect(await run(bin, ['ignored'])).toContain('FALLBACK-OK')
  })
})
