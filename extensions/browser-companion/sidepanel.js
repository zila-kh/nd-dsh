const status = document.querySelector('#status')
const site = document.querySelector('#site')
const permissionText = document.querySelector('#permissionText')
const allowSite = document.querySelector('#allowSite')
const profile = document.querySelector('#profile')
const saveProfile = document.querySelector('#saveProfile')

let activeOrigin

void refresh()
chrome.tabs.onActivated.addListener(() => { void refresh() })
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (tab.active && (info.url || info.status === 'complete')) void refresh() })

saveProfile.addEventListener('click', async () => {
  const value = profile.value.trim().slice(0, 128)
  if (value) await chrome.storage.local.set({ profileLabel: value })
  await chrome.runtime.sendMessage({ kind: 'companion.reconnect' }).catch(() => undefined)
  void refresh()
})

allowSite.addEventListener('click', async () => {
  if (!activeOrigin) return
  const granted = await chrome.permissions.request({ origins: [activeOrigin] })
  permissionText.textContent = granted ? 'Access granted for this site.' : 'Access was not granted.'
  void refresh()
})

async function refresh() {
  const current = await chrome.runtime.sendMessage({ kind: 'companion.status' }).catch(() => ({ connected: false }))
  status.textContent = current?.connected ? 'Connected' : 'Disconnected'
  status.className = current?.connected ? 'ok' : 'bad'

  const stored = await chrome.storage.local.get('profileLabel')
  if (document.activeElement !== profile) profile.value = typeof stored.profileLabel === 'string' ? stored.profileLabel : ''

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url ?? ''
  site.textContent = url || 'No active web tab'
  activeOrigin = originPattern(url)
  if (!activeOrigin) {
    allowSite.disabled = true
    permissionText.textContent = 'Open an http/https tab to grant access.'
    return
  }
  const allowed = await chrome.permissions.contains({ origins: [activeOrigin] })
  allowSite.disabled = allowed
  permissionText.textContent = allowed ? 'ND can control this site.' : 'Grant this site before an agent can inspect or act on it.'
}

function originPattern(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return `${parsed.origin}/*`
  } catch {
    return undefined
  }
}
