const status = document.getElementById('status')
document.documentElement.dataset.ndPopupRuntime = chrome.runtime?.id ? 'ok' : 'missing'
chrome.storage.local.set({ ndPopupProbe: 'ok' }, () => {
  document.documentElement.dataset.ndPopupStorage = chrome.runtime.lastError ? 'failed' : 'ok'
  if (status) status.textContent = 'ready'
})
