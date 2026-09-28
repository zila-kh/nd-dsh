/// <reference lib="dom" />
// Opt-in compatibility probe: real Chromium vs ND built-in browser for one unpacked ad-blocking extension.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test, type ElectronApplication } from '@playwright/test'
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
  permissions: typeof chrome.permissions?.getAll,
  windows: typeof chrome.windows?.getCurrent,
}))()`
const RULES_PROBE = `(async () => chrome.declarativeNetRequest?.getDynamicRules ? (await chrome.declarativeNetRequest.getDynamicRules()).length : 'api-missing')()`
const STYLE_PROBE = `document.querySelectorAll('style').length`
const BROWSER_PARTITION = 'persist:nd-dsh-browser'

test.setTimeout(240_000)
test.skip(!EXT, 'Manual probe: set PROBE_EXTENSION_PATH to an unpacked extension folder')

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

    await page.evaluate((url) => (window as any).ndDsh.browser.navigate(url), VIDEO)
    const without = await measureNetwork(app)
    console.log('PROBE nd-network-without-extension ' + JSON.stringify(without))

    await page.evaluate(() => (window as any).ndDsh.browserPlatform.setDeveloperMode(true))
    const record = await page.evaluate(() => (window as any).ndDsh.browserPlatform.installExtension())
    console.log('PROBE nd-install ' + JSON.stringify({ id: record?.id, status: record?.status, error: record?.error, notes: record?.compatibilityNotes }))
    expect(record?.error).toBeUndefined()
    await new Promise((r) => setTimeout(r, 5_000))

    const withExtension = await measureNetwork(app)
    console.log('PROBE nd-network-with-extension ' + JSON.stringify(withExtension))
    expect(withExtension.blocked).toBeGreaterThan(without.blocked)

    const exceptions = await workerExceptions(app, record.id)
    console.log('PROBE nd-worker-exceptions ' + JSON.stringify(exceptions))

    await page.evaluate((id) => (window as any).ndDsh.browserPlatform.showExtensionPopup(id), record.id)
    const popup = await app.evaluate(async ({ webContents }, input) => {
      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        const contents = webContents.getAllWebContents().find((w) => w.getURL().startsWith(`chrome-extension://${input.id}/`))
        if (contents && !contents.isLoading()) {
          await new Promise((r) => setTimeout(r, 3_000))
          if (contents.isDestroyed()) return { error: 'popup closed before it could be read' }
          const state = await contents.executeJavaScript(`(async () => ({
            apis: ${input.api},
            activeUrl: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url ?? null,
            text: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 200),
          }))()`)
          const screenshot = await Promise.race([
            contents.capturePage().then((image) => image.toDataURL()),
            new Promise<string>((resolve) => setTimeout(() => resolve(''), 5_000)),
          ])
          return { ...state, screenshot }
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      return { error: 'popup did not load' }
    }, { id: record.id, api: API_PROBE })
    if ('screenshot' in popup && popup.screenshot) {
      await writeFile(join('test-results', 'nd-extension-popup.png'), Buffer.from(popup.screenshot.split(',')[1]!, 'base64'))
    }
    console.log('PROBE nd-popup ' + JSON.stringify({ ...popup, screenshot: 'screenshot' in popup && popup.screenshot ? 'test-results/nd-extension-popup.png' : 'none' }))

    expect('error' in popup ? popup.error : undefined).toBeUndefined()
    expect('activeUrl' in popup ? popup.activeUrl : null).toBe(VIDEO)
    expect(exceptions).toEqual([])
  } finally {
    await closeApp(launched)
  }
})

async function measureNetwork(app: ElectronApplication) {
  const tabId = await app.evaluate(async ({ webContents }) => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const tab = webContents.getAllWebContents().find((w) => w.getURL().includes('youtube.com'))
      if (tab) return tab.id
      await new Promise((r) => setTimeout(r, 200))
    }
    return -1
  })
  const network = await app.evaluate(async ({ webContents }, id) => {
    const tab = webContents.fromId(id)!
    const adHost = /doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|googletagmanager\.com|\/pagead\/|\/ptracking|\/api\/stats\/ads/
    const urls = new Map<string, string>()
    let blocked = 0
    let adRequestsSent = 0
    let adRequestsLoaded = 0
    tab.debugger.attach('1.3')
    tab.debugger.on('message', (_event, method, params) => {
      if (method === 'Network.requestWillBeSent') {
        urls.set(params.requestId, params.request.url)
        if (adHost.test(params.request.url)) adRequestsSent += 1
      } else if (method === 'Network.loadingFinished' && adHost.test(urls.get(params.requestId) ?? '')) {
        adRequestsLoaded += 1
      } else if (method === 'Network.loadingFailed'
        && (params.blockedReason || String(params.errorText).includes('BLOCKED_BY_CLIENT'))) {
        blocked += 1
      }
    })
    await tab.debugger.sendCommand('Network.enable')
    tab.reload()
    await new Promise((r) => setTimeout(r, 12_000))
    tab.debugger.detach()
    return { blocked, adRequestsSent, adRequestsLoaded }
  }, tabId)
  const styleTags = await app.evaluate(({ webContents }, input) =>
    webContents.fromId(input.id)!.executeJavaScript(input.script), { id: tabId, script: STYLE_PROBE })
  return { ...network, styleTags }
}

// Uncaught errors an extension worker hit since it started; the loopback CDP
// endpoint replays them to a newly attached client.
async function workerExceptions(app: ElectronApplication, extensionId: string): Promise<string[]> {
  const cdpPort = await app.evaluate(({ app: electronApp }) => electronApp.commandLine.getSwitchValue('remote-debugging-port'))
  if (!cdpPort) return ['no loopback CDP port']
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const worker = targets.find((target) => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`))
  if (!worker) {
    const running = await app.evaluate(({ session }, partition) =>
      Object.values(session.fromPartition(partition).serviceWorkers.getAllRunning()).map((item: any) => item.scope), BROWSER_PARTITION)
    return running.some((scope: string) => scope.startsWith(`chrome-extension://${extensionId}/`)) ? ['worker not exposed over CDP'] : []
  }
  const exceptions: string[] = []
  const socket = new WebSocket(worker.webSocketDebuggerUrl)
  await new Promise<void>((done) => { socket.onopen = () => done() })
  socket.onmessage = (message) => {
    const data = JSON.parse(String(message.data))
    if (data.method !== 'Runtime.exceptionThrown') return
    const details = data.params.exceptionDetails
    exceptions.push(String(details.exception?.description ?? details.text).split('\n').slice(0, 2).join(' '))
  }
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
  await new Promise((r) => setTimeout(r, 1_000))
  socket.close()
  return exceptions
}
