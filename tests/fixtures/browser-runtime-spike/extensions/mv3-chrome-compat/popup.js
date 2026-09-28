async function probe() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabs = await chrome.tabs.query({})
  const currentTab = await chrome.tabs.getCurrent()
  const currentWindow = chrome.windows ? await chrome.windows.getCurrent() : null
  const background = await chrome.runtime.sendMessage({ type: 'nd-compat-probe' })
  return {
    activeUrl: active?.url ?? null,
    activeWindowId: active?.windowId ?? null,
    tabUrls: tabs.map((tab) => tab.url),
    currentTab: currentTab ?? null,
    windowId: currentWindow?.id ?? null,
    background,
  }
}

probe().then(
  (result) => {
    document.body.dataset.result = JSON.stringify(result)
    document.body.dataset.status = 'ready'
    document.getElementById('status').textContent = 'ready'
  },
  (error) => {
    document.body.dataset.result = JSON.stringify({ error: String(error) })
    document.body.dataset.status = 'error'
    document.getElementById('status').textContent = 'error'
  },
)
