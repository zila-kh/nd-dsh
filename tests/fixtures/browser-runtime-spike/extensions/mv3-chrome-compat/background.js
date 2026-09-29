// Captured synchronously while the worker script first evaluates, which is
// when real extensions register their listeners. Cross-browser extensions
// resolve `self.browser || self.chrome`, so both namespaces must agree.
const separateBrowser = globalThis.browser && globalThis.browser !== globalThis.chrome ? globalThis.browser : null
const atStart = {
  permissionsGetAll: typeof chrome.permissions?.getAll,
  permissionsOnRemoved: typeof chrome.permissions?.onRemoved?.addListener,
  commandsGetAll: typeof chrome.commands?.getAll,
  commandsOnCommand: typeof chrome.commands?.onCommand?.addListener,
  browserPermissionsGetAll: separateBrowser ? typeof separateBrowser.permissions?.getAll : 'no-separate-browser',
  browserCommandsGetAll: separateBrowser ? typeof separateBrowser.commands?.getAll : 'no-separate-browser',
}

chrome.permissions?.onRemoved?.addListener(() => undefined)
chrome.commands?.onCommand?.addListener(() => undefined)

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'nd-compat-probe') return undefined
  Promise.all([
    chrome.permissions.getAll(),
    chrome.permissions.contains({ permissions: ['bookmarks'] }),
    chrome.permissions.request({ origins: ['https://example.com/*'] }),
    chrome.commands.getAll(),
  ]).then(
    ([granted, hasUndeclared, escalated, commands]) => reply({ atStart, granted, hasUndeclared, escalated, commands }),
    (error) => reply({ atStart, error: String(error) }),
  )
  return true
})
