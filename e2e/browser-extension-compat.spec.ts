/// <reference lib="dom" />

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { BrowserExtensionRecord, BrowserPlatformState } from '../src/shared/browser-platform.js'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

type RendererWindow = {
  ndDsh: {
    browser: { navigate(url: string): Promise<unknown> }
    browserPlatform: {
      setDeveloperMode(enabled: boolean): Promise<BrowserPlatformState>
      installExtension(): Promise<BrowserExtensionRecord | null>
      showExtensionPopup(extensionId: string): Promise<BrowserPlatformState>
    }
  }
}

interface ProbeResult {
  error?: string
  activeUrl: string | null
  activeWindowId: number | null
  tabUrls: string[]
  currentTab: unknown
  windowId: number | null
  background: {
    error?: string
    atStart: Record<string, string>
    granted: { permissions: string[]; origins: string[] }
    hasUndeclared: boolean
    escalated: boolean
    commands: Array<{ name: string; description: string; shortcut: string }>
  }
}

const EXTENSION_PATH = resolve('tests/fixtures/browser-runtime-spike/extensions/mv3-chrome-compat')

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
let server: Server
let origin = ''

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end('<!doctype html><html><head><title>ND Compat Page</title></head><body>ND Compat Page</body></html>')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  launched = await launchApp()
  // Load unpacked asks for a folder and a native confirmation; answer both inside this throwaway app only.
  await launched.app.evaluate(({ dialog }, path) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, EXTENSION_PATH)
})

test.afterAll(async () => {
  await closeApp(launched)
  await new Promise<void>((done) => server.close(() => done()))
})

test('unpacked MV3 extension gets Chrome tab, window, permissions, and commands semantics', async () => {
  const { app, page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
  await page.getByRole('tablist', { name: 'Agent workspace panes' }).getByRole('button', { name: 'Browser' }).click()
  await expect(page.getByRole('region', { name: 'Built-in browser' })).toBeVisible()

  const pageUrl = `${origin}/page`
  await page.evaluate((url) => (window as unknown as RendererWindow).ndDsh.browser.navigate(url), pageUrl)

  await page.evaluate(() => (window as unknown as RendererWindow).ndDsh.browserPlatform.setDeveloperMode(true))
  const record = await page.evaluate(() => (window as unknown as RendererWindow).ndDsh.browserPlatform.installExtension())
  expect(record?.error).toBeUndefined()
  const extensionId = record!.id

  await page.evaluate((id) => (window as unknown as RendererWindow).ndDsh.browserPlatform.showExtensionPopup(id), extensionId)

  const readPopup = () => app.evaluate(async ({ webContents }, id) => {
    const popup = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(`chrome-extension://${id}/`))
    if (!popup || popup.isDestroyed()) return null
    return popup.executeJavaScript(`({ status: document.body.dataset.status, result: document.body.dataset.result ?? '' })`) as Promise<{ status: string; result: string }>
  }, extensionId)
  await expect.poll(async () => (await readPopup())?.status ?? 'missing', { timeout: 20_000 }).not.toBe('loading')
  const snapshot = await readPopup()
  expect(snapshot?.status, snapshot?.result).toBe('ready')
  const result = JSON.parse(snapshot!.result) as ProbeResult

  // A Chrome action popup is not a tab: the active tab is the page it opened over.
  expect(result.activeUrl).toBe(pageUrl)
  expect(result.tabUrls).toEqual([pageUrl])
  expect(result.currentTab).toBeNull()
  expect(typeof result.windowId).toBe('number')
  expect(result.activeWindowId).toBe(result.windowId)

  // The worker must see these APIs while its script first evaluates, not only later.
  expect(result.background.error).toBeUndefined()
  const { browserPermissionsGetAll, browserCommandsGetAll, ...chromeAtStart } = result.background.atStart
  expect(chromeAtStart).toEqual({
    permissionsGetAll: 'function',
    permissionsOnRemoved: 'function',
    commandsGetAll: 'function',
    commandsOnCommand: 'function',
  })
  expect(['function', 'no-separate-browser']).toContain(browserPermissionsGetAll)
  expect(['function', 'no-separate-browser']).toContain(browserCommandsGetAll)
  expect(result.background.granted.permissions).toContain('storage')
  expect(result.background.granted.origins).toContain('http://127.0.0.1/*')
  expect(result.background.hasUndeclared).toBe(false)
  expect(result.background.escalated).toBe(false)
  expect(result.background.commands).toEqual([{ name: 'probe-command', description: 'Probe command', shortcut: '' }])
})
