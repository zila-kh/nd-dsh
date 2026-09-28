/// <reference lib="dom" />

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test } from '@playwright/test'
import type { BrowserExtensionRecord, BrowserPlatformState } from '../src/shared/browser-platform.js'
import { closeApp, launchApp, type LaunchedApp } from './fixtures.js'

type RendererWindow = {
  ndDsh: {
    browser: { navigate(url: string): Promise<unknown> }
    browserPlatform: {
      state(): Promise<BrowserPlatformState>
      installCatalogExtension(catalogId: string): Promise<BrowserExtensionRecord | null>
      showExtensionPopup(extensionId: string): Promise<BrowserPlatformState>
    }
  }
}

interface PopupSnapshot {
  title: string
  url: string
  status: string
  reloadDisabled: boolean
}

const PAGE_TITLE = 'ND Extension E2E Page'

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp
let server: Server
let origin = ''
let pageHits = 0

test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/page') pageHits += 1
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html><head><title>${PAGE_TITLE}</title></head><body><h1>${PAGE_TITLE}</h1></body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  launched = await launchApp()
  // The catalog install asks for native confirmation; accept it inside this throwaway app only.
  await launched.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
})

test.afterAll(async () => {
  await closeApp(launched)
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('bundled ND Browser Tools popup reads and reloads the active built-in browser tab', async () => {
  const { app, page } = launched
  await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
  await page.getByRole('tablist', { name: 'Agent workspace panes' }).getByRole('button', { name: 'Browser' }).click()
  await expect(page.getByRole('region', { name: 'Built-in browser' })).toBeVisible()

  const pageUrl = `${origin}/page`
  await page.evaluate((url) => (window as unknown as RendererWindow).ndDsh.browser.navigate(url), pageUrl)
  await expect.poll(() => pageHits).toBe(1)

  const record = await page.evaluate(() =>
    (window as unknown as RendererWindow).ndDsh.browserPlatform.installCatalogExtension('nd-browser-tools'))
  expect(record, 'catalog install returned no record').not.toBeNull()
  expect(record?.error).toBeUndefined()
  expect(record?.status).toBe('compatible')
  expect(record?.id).toMatch(/^[a-p]{32}$/)
  const extensionId = record!.id

  const shown = await page.evaluate((id) =>
    (window as unknown as RendererWindow).ndDsh.browserPlatform.showExtensionPopup(id), extensionId)
  expect(shown.extensionPopupId).toBe(extensionId)

  const readPopup = () => app.evaluate(async ({ webContents }, id): Promise<PopupSnapshot | null> => {
    const popup = webContents.getAllWebContents().find((contents) =>
      contents.getURL().startsWith(`chrome-extension://${id}/`))
    if (!popup) return null
    return popup.executeJavaScript(`({
      title: document.getElementById('title')?.textContent ?? '',
      url: document.getElementById('url')?.textContent ?? '',
      status: document.getElementById('status')?.textContent ?? '',
      reloadDisabled: document.getElementById('reload')?.disabled ?? true,
    })`) as Promise<PopupSnapshot>
  }, extensionId)

  await expect.poll(async () => (await readPopup())?.status ?? '', { timeout: 15_000 })
    .toContain('ND runtime connected')
  const popup = await readPopup()
  expect(popup?.title, 'popup did not resolve the active website tab').toBe(PAGE_TITLE)
  expect(popup?.url).toBe(pageUrl)
  expect(popup?.reloadDisabled).toBe(false)

  await app.evaluate(async ({ webContents }, id) => {
    const contents = webContents.getAllWebContents().find((item) =>
      item.getURL().startsWith(`chrome-extension://${id}/`))
    await contents?.executeJavaScript(`document.getElementById('reload').click()`)
  }, extensionId)
  await expect.poll(() => pageHits, { timeout: 15_000 }).toBe(2)
  await expect.poll(async () =>
    (await page.evaluate(() => (window as unknown as RendererWindow).ndDsh.browserPlatform.state())).extensionPopupId ?? null,
  ).toBeNull()
})
