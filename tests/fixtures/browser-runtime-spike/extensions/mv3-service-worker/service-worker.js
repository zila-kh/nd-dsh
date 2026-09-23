chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.kind !== 'nd-browser-runtime-spike') return false
  chrome.storage.local.set({ lastRuntimePing: Date.now() }).then(() => {
    sendResponse({ ok: true, source: 'mv3-service-worker' })
  })
  return true
})
