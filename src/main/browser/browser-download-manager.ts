import { randomUUID } from 'node:crypto'
import { app, type DownloadItem, type Event, type Session, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { extname, join, parse } from 'node:path'
import type { BrowserDownloadRecord } from '../../shared/browser-platform.js'

export class BrowserDownloadManager {
  private readonly records = new Map<string, BrowserDownloadRecord>()
  private readonly items = new Map<string, DownloadItem>()
  private readonly handler: (event: Event, item: DownloadItem, webContents: WebContents) => void

  constructor(
    private readonly browserSession: Session,
    private readonly targetId: string,
    private readonly tabIdForWebContents: (webContentsId: number) => string | undefined,
    private readonly onChanged: () => void,
  ) {
    this.handler = (_event, item, webContents) => this.track(item, webContents)
    this.browserSession.on('will-download', this.handler)
  }

  list(): BrowserDownloadRecord[] {
    return [...this.records.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((item) => structuredClone(item))
  }

  cancel(id: string): boolean {
    const item = this.items.get(id)
    if (!item) return false
    try { item.cancel() } catch { return false }
    return true
  }

  dispose(): void {
    this.browserSession.removeListener('will-download', this.handler)
    this.items.clear()
  }

  private track(item: DownloadItem, webContents: WebContents): void {
    const id = randomUUID()
    const filename = safeFilename(item.getFilename() || 'download')
    const savePath = uniqueDownloadPath(filename)
    item.setSavePath(savePath)

    const record: BrowserDownloadRecord = {
      id,
      targetId: this.targetId,
      ...(this.tabIdForWebContents(webContents.id) ? { tabId: this.tabIdForWebContents(webContents.id) } : {}),
      url: item.getURL(),
      ...(origin(item.getURL()) ? { origin: origin(item.getURL()) } : {}),
      filename,
      path: savePath,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      state: 'starting',
      startedAt: Date.now(),
    }
    this.records.set(id, record)
    this.items.set(id, item)
    this.onChanged()

    item.on('updated', (_event, state) => {
      const current = this.records.get(id)
      if (!current) return
      current.receivedBytes = item.getReceivedBytes()
      current.totalBytes = item.getTotalBytes()
      current.state = state === 'progressing' ? 'progressing' : 'interrupted'
      this.onChanged()
    })
    item.once('done', (_event, state) => {
      const current = this.records.get(id)
      if (!current) return
      current.receivedBytes = item.getReceivedBytes()
      current.totalBytes = item.getTotalBytes()
      current.state = state === 'completed'
        ? 'completed'
        : state === 'cancelled'
          ? 'cancelled'
          : 'interrupted'
      current.completedAt = Date.now()
      this.items.delete(id)
      this.onChanged()
    })
  }
}

function uniqueDownloadPath(filename: string): string {
  const parsed = parse(filename)
  const directory = app.getPath('downloads')
  const first = join(directory, filename)
  if (!existsSync(first)) return first
  const suffix = new Date().toISOString().replace(/[:.]/g, '-')
  return join(directory, `${parsed.name}-${suffix}${parsed.ext || extname(filename)}`)
}

function safeFilename(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return (cleaned || 'download').slice(0, 240)
}

function origin(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    return parsed.origin === 'null' ? undefined : parsed.origin
  } catch {
    return undefined
  }
}
