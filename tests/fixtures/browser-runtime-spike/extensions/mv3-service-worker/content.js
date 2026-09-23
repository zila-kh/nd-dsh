document.documentElement.dataset.ndSpikeMv3Content = 'ok'
chrome.runtime.sendMessage({ kind: 'nd-browser-runtime-spike' }, (response) => {
  document.documentElement.dataset.ndSpikeMv3Runtime = response?.ok ? 'ok' : 'failed'
})
