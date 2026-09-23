document.documentElement.dataset.ndSpikeMv2Content = 'ok'
chrome.runtime.sendMessage({ kind: 'nd-browser-runtime-spike' }, (response) => {
  document.documentElement.dataset.ndSpikeMv2Runtime = response?.ok ? 'ok' : 'failed'
})
