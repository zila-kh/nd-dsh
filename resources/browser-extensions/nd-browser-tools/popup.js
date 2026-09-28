const title = document.getElementById('title')
const url = document.getElementById('url')
const reload = document.getElementById('reload')
const status = document.getElementById('status')

let activeTab

function finish(message) {
  if (status) status.textContent = message
}

chrome.storage.local.get(['popupOpenCount'], (value) => {
  const next = Number(value?.popupOpenCount || 0) + 1
  chrome.storage.local.set({ popupOpenCount: next }, () => {
    if (!chrome.runtime.lastError) finish(`ND runtime connected · opened ${next} time${next === 1 ? '' : 's'}`)
  })
})

chrome.tabs.query({ active: true }, (tabs) => {
  if (chrome.runtime.lastError) {
    finish(`Active tab unavailable: ${chrome.runtime.lastError.message || 'unknown error'}`)
    return
  }

  activeTab = Array.isArray(tabs)
    ? tabs.find((tab) => typeof tab?.url === 'string' && !tab.url.startsWith('chrome-extension://'))
    : undefined

  if (!activeTab) {
    if (title) title.textContent = 'No active website tab'
    if (url) url.textContent = ''
    finish('ND runtime connected')
    return
  }

  if (title) title.textContent = activeTab.title || 'Active tab'
  if (url) url.textContent = activeTab.url || ''
  if (reload && typeof activeTab.id === 'number') reload.disabled = false
})

reload?.addEventListener('click', () => {
  if (typeof activeTab?.id !== 'number') return
  chrome.tabs.reload(activeTab.id, () => {
    if (chrome.runtime.lastError) {
      finish(`Reload failed: ${chrome.runtime.lastError.message || 'unknown error'}`)
      return
    }
    window.close()
  })
})
