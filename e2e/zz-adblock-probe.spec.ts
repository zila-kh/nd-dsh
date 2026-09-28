/// <reference lib="dom" />
// Temporary compatibility probe: real Chromium vs ND built-in browser for one unpacked extension.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, test } from '@playwright/test'
import { closeApp, launchApp } from './fixtures.js'

const EXT = process.env.PROBE_EXTENSION_PATH ?? ''
const VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const API_PROBE = `(() => ({
  declarativeNetRequest: typeof chrome.declarativeNetRequest?.updateDynamicRules,
  alarms: typeof chrome.alarms?.create,
  webNavigation: typeof chrome.webNavigation?.onCommitted,
  webRequest: typeof chrome.webRequest?.onBeforeRequest,
  scriptingExecute: typeof chrome.scripting?.executeScript,
  tabsQuery: typeof chrome.tabs?.query,
  storage: typeof chrome.storage?.local,
  action: typeof chrome.action?.setBadgeText,
}))()`
const RULES_PROBE = `(async () => chrome.declarativeNetRequest?.getDynamicRules ? (await chrome.declarativeNetRequest.getDynamicRules()).length : 'api-missing')()`
const STYLE_PROBE = `document.querySelectorAll('style').length`

test.setTimeout(240_000)

test('real Chromium baseline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'probe-chromium-'))
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 20_000 })
    await new Promise((r) => setTimeout(r, 5_000))
    const apis = await worker.evaluate(API_PROBE)
    const rules = await worker.evaluate(RULES_PROBE)
    const page = await context.newPage()
    let blocked = 0
    page.on('requestfailed', (request) => { if (request.failure()?.errorText.includes('BLOCKED_BY_CLIENT')) blocked += 1 })
    await page.goto(VIDEO, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(12_000)
    const styles = await page.evaluate(STYLE_PROBE)
    console.log('PROBE chromium ' + JSON.stringify({ apis, dynamicRules: rules, blockedRequests: blocked, styleTags: styles }))
  } finally {
    await context.close()
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

test('ND built-in browser', async () => {
  const launched = await launchApp()
  const { app, page } = launched
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never
    }, EXT)
    await page.getByRole('navigation', { name: 'ND-DSH navigation' }).getByTitle('Agent').click()
    await page.getByRole('tablist', { name: 'Agent workspace panes' }).getByRole('button', { name: 'Browser' }).click()
    await page.evaluate(() => (window as any).ndDsh.browserPlatform.setDeveloperMode(true))
    const record = await page.evaluate(() => (window as any).ndDsh.browserPlatform.installExtension())
    console.log('PROBE nd-install ' + JSON.stringify({ id: record?.id, status: record?.status, error: record?.error, notes: record?.compatibilityNotes }))
    await new Promise((r) => setTimeout(r, 5_000))

    await page.evaluate((url) => (window as any).ndDsh.browser.navigate(url), VIDEO)
    const tabId = await app.evaluate(async ({ webContents }) => {
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        const tab = webContents.getAllWebContents().find((w) => w.getURL().includes('youtube.com'))
        if (tab) return tab.id
        await new Promise((r) => setTimeout(r, 200))
      }
      return -1
    })
    const blocked = await app.evaluate(async ({ webContents }, id) => {
      const tab = webContents.fromId(id)!
      let count = 0
      tab.debugger.attach('1.3')
      tab.debugger.on('message', (_e, method, params) => {
        if (method === 'Network.loadingFailed' && (params.blockedReason || String(params.errorText).includes('BLOCKED_BY_CLIENT'))) count += 1
      })
      await tab.debugger.sendCommand('Network.enable')
      tab.reload()
      await new Promise((r) => setTimeout(r, 12_000))
      tab.debugger.detach()
      return count
    }, tabId)
    const styles = await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript(STYLE_PROBE), tabId)

    await page.evaluate((id) => (window as any).ndDsh.browserPlatform.showExtensionPopup(id), record.id)
    const popupProbe = await app.evaluate(async ({ webContents }, input) => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        const popup = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`chrome-extension://${input.id}/`))
        if (popup && !popup.isLoading()) {
          await new Promise((r) => setTimeout(r, 1_500))
          return {
            apis: await popup.executeJavaScript(input.api),
            rules: await popup.executeJavaScript(input.rules).catch((e: Error) => `error: ${e.message}`),
            popupText: (await popup.executeJavaScript(`document.body.innerText`)).slice(0, 200),
          }
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      return null
    }, { id: record.id, api: API_PROBE, rules: RULES_PROBE })
    console.log('PROBE nd ' + JSON.stringify({ blockedRequests: blocked, styleTags: styles, popup: popupProbe }))
  } finally {
    await closeApp(launched)
  }
})
