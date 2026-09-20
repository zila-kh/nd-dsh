import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LogFile, quarantineFile, quarantinePathFor, redactLogText } from '../src/main/logging/log-file.js'

describe('redactLogText', () => {
  it('keeps provider credentials out of a log line', () => {
    expect(redactLogText('using sk-abc12345XYZ9876543210 for the request')).toBe('using sk-abc12345… for the request')
    expect(redactLogText('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6')).toBe('Authorization: Bearer [redacted]')
    expect(redactLogText('DEEPSEEK_API_KEY=deadbeefdeadbeef')).toBe('DEEPSEEK_API_KEY=[redacted]')
    expect(redactLogText('{"apiKey":"live-secret-value","model":"m"}')).toBe('{"apiKey":"[redacted]","model":"m"}')
  })

  it('leaves ordinary diagnostic text alone', () => {
    const line = 'harness gateway did not become ready within the timeout: connect ECONNREFUSED 127.0.0.1:9922'
    expect(redactLogText(line)).toBe(line)
  })
})

describe('LogFile', () => {
  it('writes timestamped lines and rotates past the cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-log-'))
    const path = join(dir, 'logs', 'nd-dsh.log')
    const log = new LogFile({ path, maxBytes: 200, captureConsole: false })
    await log.open()
    for (let index = 0; index < 12; index += 1) log.write('info', `line ${String(index)} ${'x'.repeat(40)}`)
    await log.flush()

    const active = await readFile(path, 'utf8')
    expect(active).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO /m)
    // Rotation keeps the previous generation rather than dropping history.
    const previous = await readFile(`${path}.1`, 'utf8')
    expect(previous.length).toBeGreaterThan(0)
  })

  it('redacts a credential written through console capture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-log-'))
    const path = join(dir, 'nd-dsh.log')
    const log = new LogFile({ path, captureConsole: true })
    await log.open()
    console.log('provider key sk-abcdefgh12345678 rejected')
    await log.flush()

    const written = await readFile(path, 'utf8')
    expect(written).toContain('sk-abcdefgh…')
    expect(written).not.toContain('sk-abcdefgh12345678')
  })

  it('never throws when the log location cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-log-'))
    // A directory where the file belongs makes every append fail.
    const path = join(dir, 'blocked.log')
    await writeFile(join(dir, 'placeholder'), '', 'utf8')
    const log = new LogFile({ path: join(dir, 'placeholder', 'nd-dsh.log'), captureConsole: false })
    await log.open()
    log.write('error', 'this must not escape')
    await expect(log.flush()).resolves.toBeUndefined()
  })
})

describe('quarantineFile', () => {
  it('keeps an unreadable file instead of letting the store overwrite it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-quarantine-'))
    const path = join(dir, 'session-archive.json')
    await writeFile(path, '{ this is not json', 'utf8')

    const quarantined = await quarantineFile(path, new Error('unsupported schema'))
    expect(quarantined).toBeDefined()
    expect(await readFile(quarantined!, 'utf8')).toBe('{ this is not json')
    // The original name is free again, so the store's next save is a fresh file
    // rather than a silent overwrite of the user's only copy.
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('reports nothing to quarantine for a file that is not there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-quarantine-'))
    await expect(quarantineFile(join(dir, 'missing.json'), new Error('ENOENT'))).resolves.toBeUndefined()
  })

  it('gives each quarantine a distinct name', () => {
    const path = 'C:/tmp/store.json'
    expect(quarantinePathFor(path, 1)).not.toBe(quarantinePathFor(path, 1))
    expect(quarantinePathFor(path, 1).startsWith(`${path}.corrupt-1-`)).toBe(true)
  })
})
