const status = document.getElementById('status')
document.documentElement.dataset.ndPopupRuntime = chrome.runtime?.id ? 'ok' : 'missing'

let pending = 3
const done = () => {
  pending -= 1
  if (pending === 0 && status) status.textContent = 'ready'
}

chrome.storage.local.set({ ndPopupProbe: 'ok' }, () => {
  document.documentElement.dataset.ndPopupStorage = chrome.runtime.lastError ? 'failed' : 'ok'
  done()
})

if (chrome.tabs?.query) {
  chrome.tabs.query({ active: true }, (tabs) => {
    const tab = Array.isArray(tabs) ? tabs[0] : undefined
    document.documentElement.dataset.ndPopupTabs = chrome.runtime.lastError
      ? 'failed'
      : Array.isArray(tabs)
        ? 'ok'
        : 'failed'
    document.documentElement.dataset.ndPopupActiveTabUrl = typeof tab?.url === 'string' ? tab.url : ''
    done()

    if (chrome.tabs?.reload && typeof tab?.id === 'number') {
      chrome.tabs.reload(tab.id, () => {
        document.documentElement.dataset.ndPopupTabsReload = chrome.runtime.lastError ? 'failed' : 'ok'
        done()
      })
    } else {
      document.documentElement.dataset.ndPopupTabsReload = 'missing'
      done()
    }
  })
} else {
  document.documentElement.dataset.ndPopupTabs = 'missing'
  document.documentElement.dataset.ndPopupTabsReload = 'missing'
  done()
  done()
}
