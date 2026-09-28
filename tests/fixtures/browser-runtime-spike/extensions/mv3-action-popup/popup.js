const status = document.getElementById('status')
document.documentElement.dataset.ndPopupRuntime = chrome.runtime?.id ? 'ok' : 'missing'

let pending = 2
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
    document.documentElement.dataset.ndPopupTabs = chrome.runtime.lastError
      ? 'failed'
      : Array.isArray(tabs)
        ? 'ok'
        : 'failed'
    document.documentElement.dataset.ndPopupActiveTabUrl = Array.isArray(tabs) && typeof tabs[0]?.url === 'string'
      ? tabs[0].url
      : ''
    done()
  })
} else {
  document.documentElement.dataset.ndPopupTabs = 'missing'
  done()
}
