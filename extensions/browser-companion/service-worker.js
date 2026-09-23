const HOST = 'com.nddsh.browser_companion'
const PROTOCOL = 1
const VERSION = chrome.runtime.getManifest().version

let nativePort
let reconnectTimer
let connecting
let connected = false

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined)
  void ensureNative()
})
chrome.runtime.onStartup.addListener(() => { void ensureNative() })
chrome.runtime.onConnect.addListener(() => undefined)

chrome.tabs.onRemoved.addListener((tabId) => {
  try {
    nativePort?.postMessage({ version: PROTOCOL, kind: 'event', event: 'tab.closed', tabId })
  } catch {
    // The disconnect handler owns reconnect.
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind === 'companion.status') {
    sendResponse({ connected })
    return false
  }
  if (message?.kind === 'companion.reconnect') {
    void ensureNative(true).then(() => sendResponse({ connected }))
    return true
  }
  return false
})

void ensureNative()

// Chrome fires `onInstalled`/`onStartup` while this module's own
// `ensureNative()` call is still awaiting storage, so concurrent callers must
// share one attempt: a second port would register a second companion (two
// installation ids, two connected records).
async function ensureNative(force = false) {
  if (connecting) return connecting
  if (nativePort && !force) return
  connecting = connectNative()
  try {
    await connecting
  } finally {
    connecting = undefined
  }
}

async function connectNative() {
  if (nativePort) {
    try { nativePort.disconnect() } catch {}
    nativePort = undefined
  }
  clearTimeout(reconnectTimer)
  try {
    const installationId = await getInstallationId()
    const port = chrome.runtime.connectNative(HOST)
    nativePort = port
    connected = true
    port.onMessage.addListener((message) => { void onNativeMessage(port, message) })
    port.onDisconnect.addListener(() => {
      if (nativePort === port) nativePort = undefined
      connected = false
      scheduleReconnect()
    })
    port.postMessage({
      version: PROTOCOL,
      kind: 'browser.hello',
      installationId,
      browser: detectBrowser(),
      profileLabel: await getProfileLabel(),
      extensionVersion: VERSION,
    })
  } catch {
    connected = false
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => { void ensureNative(true) }, 2_500)
}

async function onNativeMessage(port, message) {
  if (message?.kind !== 'command' || typeof message.id !== 'string') return
  try {
    const result = await dispatch(message.method, message.params ?? {})
    port.postMessage({ version: PROTOCOL, kind: 'response', id: message.id, result })
  } catch (error) {
    port.postMessage({
      version: PROTOCOL,
      kind: 'response',
      id: message.id,
      error: {
        code: error?.code ?? 'BROWSER_COMMAND_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'tabs.list': {
      const tabs = await chrome.tabs.query({})
      return tabs.filter((tab) => typeof tab.id === 'number').map(normalizeTab)
    }
    case 'page.navigate': {
      const tabId = tabIdOf(params)
      const url = String(params.url ?? '')
      if (!/^https?:\/\//i.test(url)) throw new Error('Only http/https navigation is allowed by the browser companion')
      await chrome.tabs.update(tabId, { url })
      await waitForComplete(tabId)
      return normalizeTab(await chrome.tabs.get(tabId))
    }
    case 'page.snapshot':
      return callContent(tabIdOf(params), { kind: 'snapshot' })
    case 'page.click':
      return callContent(tabIdOf(params), { kind: 'click', ref: params.ref, revision: params.revision })
    case 'page.fill':
      return callContent(tabIdOf(params), { kind: 'fill', ref: params.ref, revision: params.revision, text: String(params.text ?? '') })
    case 'page.press':
      return callContent(tabIdOf(params), { kind: 'press', ref: params.ref, revision: params.revision, key: String(params.key ?? '') })
    case 'page.scroll':
      return callContent(tabIdOf(params), { kind: 'scroll', deltaX: Number(params.deltaX ?? 0), deltaY: Number(params.deltaY ?? 0) })
    case 'page.screenshot': {
      const tabId = tabIdOf(params)
      const tab = await chrome.tabs.get(tabId)
      if (!tab.active) throw new Error('Screenshot requires the requested tab to be active in its window')
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
      return { tabId, dataUrl }
    }
    default:
      throw new Error(`Unknown browser companion command: ${method}`)
  }
}

async function callContent(tabId, message) {
  await ensureContent(tabId)
  try {
    const response = await chrome.tabs.sendMessage(tabId, message)
    if (response?.error) {
      const error = new Error(response.error.message ?? 'Page command failed')
      error.code = response.error.code
      throw error
    }
    return response?.result
  } catch (error) {
    if (String(error?.message ?? error).includes('Receiving end does not exist')) {
      await ensureContent(tabId, true)
      const response = await chrome.tabs.sendMessage(tabId, message)
      if (response?.error) throw new Error(response.error.message ?? 'Page command failed')
      return response?.result
    }
    throw error
  }
}

async function ensureContent(tabId, force = false) {
  if (!force) {
    try {
      const pong = await chrome.tabs.sendMessage(tabId, { kind: 'ping' })
      if (pong?.result?.ok) return
    } catch {}
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
  } catch (error) {
    throw new Error(`Site access is required before ND can control this page. Open the ND side panel and allow this site. ${error instanceof Error ? error.message : String(error)}`)
  }
}

function tabIdOf(params) {
  const tabId = Number(params?.tabId)
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('tabId is required')
  return tabId
}

function normalizeTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title ?? '',
    url: tab.url ?? '',
    active: tab.active === true,
    pinned: tab.pinned === true,
  }
}

function waitForComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, 15_000)
    const listener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return
      clearTimeout(timeout)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function getInstallationId() {
  const stored = await chrome.storage.local.get('installationId')
  if (typeof stored.installationId === 'string' && stored.installationId) return stored.installationId
  const installationId = crypto.randomUUID()
  await chrome.storage.local.set({ installationId })
  return installationId
}

async function getProfileLabel() {
  const stored = await chrome.storage.local.get('profileLabel')
  if (typeof stored.profileLabel === 'string' && stored.profileLabel.trim()) return stored.profileLabel.trim().slice(0, 128)
  return detectBrowser()
}

function detectBrowser() {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('edg/')) return 'edge'
  if (ua.includes('brave')) return 'brave'
  return ua.includes('chromium') ? 'chromium' : 'chrome'
}
