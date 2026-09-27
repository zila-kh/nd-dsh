import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ downloads: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'downloads') throw new Error(`unexpected path: ${name}`)
      return electronState.downloads
    },
  },
}))

import { BrowserDownloadManager } from '../src/main/browser/browser-download-manager.js'

const dirs: string[] = []

class FakeSession extends EventEmitter {}

class FakeDownloadItem extends EventEmitter {
  paused = false
  resumed = false
  cancelled = false
  savePath = ''
  received = 0
  total = 100

  constructor(private readonly filename = 'report.txt', private readonly url = 'https://example.test/report.txt') {
    super()
  }

  getFilename(): string { return this.filename }
  getURL(): string { return this.url }
  getReceivedBytes(): number { return this.received }
  getTotalBytes(): number { return this.total }
  setSavePath(path: string): void { this.savePath = path }
  pause(): void { this.paused = true }
  resume(): void { this.resumed = true; this.paused = false }
  cancel(): void { this.cancelled = true }
}

beforeEach(async () => {
  electronState.downloads = await mkdtemp(join(tmpdir(), 'nd-downloads-'))
  dirs.push(electronState.downloads)
})

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

describe('BrowserDownloadManager', () => {
  it('lets direct user downloads proceed without agent policy state', () => {
    const session = new FakeSession()
    const changed = vi.fn()
    const manager = new BrowserDownloadManager(session as never, 'builtin', () => 'tab-1', changed)
    const item = new FakeDownloadItem()

    session.emit('will-download', {}, item, { id: 42 })

    expect(item.paused).toBe(false)
    expect(item.cancelled).toBe(false)
    expect(item.savePath).toContain('report.txt')
    expect(manager.list()[0]).toMatchObject({
      targetId: 'builtin',
      tabId: 'tab-1',
      origin: 'https://example.test',
      filename: 'report.txt',
      state: 'starting',
    })
    expect(changed).toHaveBeenCalled()
    manager.dispose()
  })

  it('fails closed when an agent-caused download has no authorization handler', () => {
    const session = new FakeSession()
    const manager = new BrowserDownloadManager(session as never, 'builtin', () => 'tab-1', () => undefined)
    const item = new FakeDownloadItem()
    manager.armAgentDownload('tab-1', 'session-1')

    session.emit('will-download', {}, item, { id: 42 })

    expect(item.paused).toBe(true)
    expect(item.cancelled).toBe(true)
    expect(item.resumed).toBe(false)
    manager.dispose()
  })

  it('resumes only after the dedicated agent download policy allows it', async () => {
    const session = new FakeSession()
    const manager = new BrowserDownloadManager(session as never, 'builtin', () => 'tab-1', () => undefined)
    const authorize = vi.fn(async () => true)
    manager.setAuthorizationHandler(authorize)
    manager.armAgentDownload('tab-1', 'session-1')
    const item = new FakeDownloadItem('bad:name?.txt')

    session.emit('will-download', {}, item, { id: 42 })
    await Promise.resolve()
    await Promise.resolve()

    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      tabId: 'tab-1',
      origin: 'https://example.test',
      filename: 'bad_name_.txt',
    }))
    expect(item.resumed).toBe(true)
    expect(item.cancelled).toBe(false)
    expect(manager.list()[0]?.state).toBe('progressing')

    item.received = 100
    item.emit('done', {}, 'completed')
    expect(manager.list()[0]).toMatchObject({ state: 'completed', receivedBytes: 100, totalBytes: 100 })
    manager.dispose()
  })

  it('cancels when the dedicated agent download policy denies it', async () => {
    const session = new FakeSession()
    const manager = new BrowserDownloadManager(session as never, 'builtin', () => 'tab-1', () => undefined)
    manager.setAuthorizationHandler(async () => false)
    manager.armAgentDownload('tab-1', 'session-1')
    const item = new FakeDownloadItem()

    session.emit('will-download', {}, item, { id: 42 })
    await Promise.resolve()
    await Promise.resolve()

    expect(item.paused).toBe(true)
    expect(item.cancelled).toBe(true)
    expect(item.resumed).toBe(false)
    manager.dispose()
  })
})
