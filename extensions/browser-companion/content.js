(() => {
  if (globalThis.__ND_BROWSER_COMPANION__) return
  const refs = new Map()
  const elementRefs = new WeakMap()
  let nextRef = 1
  let revision = 1

  const observer = new MutationObserver(() => { revision += 1 })
  if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })

  const api = {
    snapshot() {
      refs.clear()
      const candidates = [...document.querySelectorAll(
        'a[href],button,input,textarea,select,summary,[role],[tabindex],[contenteditable="true"]',
      )].filter((element) => visible(element)).slice(0, 500)
      const elements = candidates.map((element) => {
        let ref = elementRefs.get(element)
        if (!ref) {
          ref = `@e${nextRef++}`
          elementRefs.set(element, ref)
        }
        refs.set(ref, element)
        const tag = element.tagName.toLowerCase()
        const type = element instanceof HTMLInputElement ? element.type : undefined
        return {
          ref,
          tag,
          role: element.getAttribute('role') || implicitRole(element),
          name: accessibleName(element),
          text: textOf(element),
          type,
          disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          sensitive: type === 'password' ? true : undefined,
        }
      })
      return {
        revision,
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
        elements,
      }
    },
    click(message) {
      const element = requireElement(message)
      element.scrollIntoView({ block: 'center', inline: 'center' })
      element.click()
      return { ok: true, revision }
    },
    fill(message) {
      const element = requireElement(message)
      const value = String(message.text ?? '')
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.focus()
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        if (setter) setter.call(element, value)
        else element.value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return { ok: true, revision }
      }
      if (element instanceof HTMLElement && element.isContentEditable) {
        element.focus()
        element.textContent = value
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
        return { ok: true, revision }
      }
      throw coded('NOT_EDITABLE', 'Referenced element is not editable')
    },
    press(message) {
      const element = requireElement(message)
      const key = String(message.key ?? '')
      if (!key) throw coded('INVALID_KEY', 'A key is required')
      element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      element.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
      return { ok: true, revision }
    },
    scroll(message) {
      const deltaX = finite(message.deltaX)
      const deltaY = finite(message.deltaY)
      window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' })
      return { ok: true, revision, scrollX, scrollY }
    },
  }

  globalThis.__ND_BROWSER_COMPANION__ = api

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.kind === 'ping') {
      sendResponse({ result: { ok: true, revision } })
      return false
    }
    Promise.resolve().then(() => {
      if (!message || typeof message.kind !== 'string' || typeof api[message.kind] !== 'function') {
        throw coded('UNKNOWN_PAGE_COMMAND', 'Unknown page command')
      }
      return api[message.kind](message)
    }).then((result) => sendResponse({ result })).catch((error) => {
      sendResponse({ error: { code: error?.code ?? 'PAGE_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) } })
    })
    return true
  })

  function requireElement(message) {
    if (!Number.isInteger(message.revision) || message.revision !== revision) {
      throw coded('STALE_BROWSER_REFERENCE', 'Page changed after the snapshot; take a fresh snapshot before acting')
    }
    const ref = String(message.ref ?? '')
    const element = refs.get(ref)
    if (!(element instanceof Element) || !element.isConnected) throw coded('STALE_BROWSER_REFERENCE', 'Element reference is stale; take a fresh snapshot')
    return element
  }

  function accessibleName(element) {
    const aria = element.getAttribute('aria-label')?.trim()
    if (aria) return aria.slice(0, 300)
    if (element instanceof HTMLInputElement && element.labels?.length) {
      return [...element.labels].map((label) => label.textContent?.trim()).filter(Boolean).join(' ').slice(0, 300)
    }
    const title = element.getAttribute('title')?.trim()
    if (title) return title.slice(0, 300)
    return textOf(element)
  }

  function textOf(element) {
    if (element instanceof HTMLInputElement) {
      if (element.type === 'password') return ''
      return element.placeholder?.trim().slice(0, 300) ?? ''
    }
    if (element instanceof HTMLTextAreaElement) return element.placeholder?.trim().slice(0, 300) ?? ''
    return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }

  function visible(element) {
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  function implicitRole(element) {
    if (element instanceof HTMLButtonElement) return 'button'
    if (element instanceof HTMLAnchorElement) return 'link'
    if (element instanceof HTMLInputElement) return element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox'
    if (element instanceof HTMLTextAreaElement) return 'textbox'
    if (element instanceof HTMLSelectElement) return 'combobox'
    return undefined
  }

  function finite(value) {
    const result = Number(value ?? 0)
    if (!Number.isFinite(result) || Math.abs(result) > 1_000_000) throw coded('INVALID_SCROLL', 'Scroll delta is invalid')
    return result
  }

  function coded(code, message) {
    const error = new Error(message)
    error.code = code
    return error
  }
})()
