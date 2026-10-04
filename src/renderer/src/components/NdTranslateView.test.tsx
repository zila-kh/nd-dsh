import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NdInvocationResult } from '../../../shared/nd-invocations'

// Drive the actual form handlers without adding a DOM dependency to the app.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, cleanup: null as (() => void) | null }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useId: () => 'translate',
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useEffect: (effect: () => (() => void)) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) { hooks.values[index] = true; hooks.cleanup = effect() }
  },
}))
import NdTranslateView from './NdTranslateView'

type TestElement = ReactElement<Record<string, unknown>>
function elements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const item = node as TestElement
  return [item, ...elements(item.props.children as ReactNode)]
}
function render(): TestElement {
  hooks.cursor = 0
  return NdTranslateView({ context: { kind: 'personal' }, onOpenBrowser }) as TestElement
}
function field(id: string): TestElement {
  const item = elements(render()).find((element) => element.props.id === `translate-${id}`)
  if (!item) throw new Error(`Missing form field: ${id}`)
  return item
}
function change(id: string, value: string): void {
  ;(field(id).props.onChange as (event: unknown) => void)({ target: { value } })
}
async function submit(): Promise<void> {
  ;(render().props.onSubmit as (event: unknown) => void)({ preventDefault() {} })
  await Promise.resolve()
  await Promise.resolve()
}
function deferred(): { promise: Promise<NdInvocationResult>; resolve(result: NdInvocationResult): void } {
  let resolve!: (result: NdInvocationResult) => void
  const promise = new Promise<NdInvocationResult>((done) => { resolve = done })
  return { promise, resolve }
}
function message(): string {
  return String(elements(render()).find((element) => element.props.role === 'alert')?.props.children ?? '')
}
function button(label: string): TestElement {
  const item = elements(render()).find((element) => element.props['aria-label'] === label
    || (Array.isArray(element.props.children) && element.props.children.includes(label)))
  if (!item) throw new Error(`Missing button: ${label}`)
  return item
}

const invoke = vi.fn<(request: unknown) => Promise<NdInvocationResult>>()
const onOpenBrowser = vi.fn<(tabId: string) => Promise<void>>()
beforeEach(() => {
  hooks.values = []
  hooks.cursor = 0
  hooks.cleanup = null
  invoke.mockReset()
  onOpenBrowser.mockReset()
  vi.stubGlobal('window', { ndDsh: { ndExtensions: { invoke } } })
})
afterEach(() => {
  hooks.cleanup?.()
  vi.unstubAllGlobals()
})

describe('ND Translate form', () => {
  it('defaults to Google and sends the exact source only through the installed view broker', async () => {
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    expect(field('provider').props.value).toBe('google')
    expect(field('source').props.value).toBe('auto')
    change('text', '  សួស្តី  ')
    await submit()
    expect(invoke).toHaveBeenCalledWith({ extensionId: 'nd.translate', contributionId: 'translator', contributionKind: 'view', caller: 'user', context: { kind: 'personal' }, input: { text: '  សួស្តី  ', sourceLanguage: 'auto', targetLanguage: 'km', provider: 'google' } })
    expect(field('text').props.value).toBe('  សួស្តី  ')
    expect(field('result').props.value).toBe('Hello')
  })

  it('prevents duplicate submissions while a provider request is pending', async () => {
    const pending = deferred()
    invoke.mockReturnValue(pending.promise)
    change('text', 'សួស្តី')
    await submit()
    await submit()
    expect(invoke).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    await pending.promise
  })

  it.each(['text', 'source', 'target', 'provider'])('discards a pending result when %s changes', async (id) => {
    const pending = deferred()
    invoke.mockReturnValue(pending.promise)
    change('text', 'សួស្តី')
    await submit()
    change(id, { text: 'អរគុណ', source: 'km', target: 'fr', provider: 'gemini' }[id]!)
    pending.resolve({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    await pending.promise
    await Promise.resolve()
    expect(field('result').props.value).toBe('')
  })

  it('clears a previous translation when the source changes', async () => {
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    change('text', 'សួស្តី')
    await submit()
    change('text', 'អរគុណ')
    expect(field('result').props.value).toBe('')
  })

  it.each(['login-required', 'challenge', 'error', 'busy'])('reports provider %s without presenting it as translated text', async (status) => {
    invoke.mockResolvedValue({ ok: true, value: { status, message: 'Provider action required' } })
    change('text', 'សួស្តី')
    await submit()
    expect(message()).toContain('Provider action required')
    expect(field('result').props.value).toBe('')
  })

  it('shows permission denials and rejects empty or malformed provider responses', async () => {
    change('text', 'សួស្តី')
    invoke.mockResolvedValue({ ok: false, error: { code: 'denied', message: 'Extension is disabled' } })
    await submit()
    expect(message()).toContain('Extension is disabled')
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: '   ' } })
    await submit()
    expect(message()).toContain('did not return translated text')
    invoke.mockResolvedValue({ ok: true, value: { status: 'invented' } })
    await submit()
    expect(message()).toContain('invalid response')
  })

  it('does not contact a provider for blank or oversized input', async () => {
    change('text', '   ')
    await submit()
    change('text', 'a'.repeat(5001))
    await submit()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('swaps explicit languages and uses the translated text as the new original', async () => {
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    expect(button('Swap languages').props.disabled).toBe(true)
    change('text', 'សួស្តី')
    change('source', 'en')
    await submit()
    ;(button('Swap languages').props.onClick as () => void)()
    expect(field('source').props.value).toBe('km')
    expect(field('target').props.value).toBe('en')
    expect(field('text').props.value).toBe('Hello')
    expect(field('result').props.value).toBe('')
  })

  it('copies only the current translated text and reports clipboard failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    change('text', 'សួស្តី')
    await submit()
    ;(button('Copy').props.onClick as () => void)()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith('Hello')
    expect(button('Copied')).toBeDefined()
    writeText.mockRejectedValue(new Error('clipboard unavailable'))
    ;(button('Copied').props.onClick as () => void)()
    await Promise.resolve()
    expect(message()).toContain('Clipboard access failed')
    change('text', 'អរគុណ')
    expect(button('Copy').props.disabled).toBe(true)
  })

  it('recovers after a rejected provider request', async () => {
    invoke.mockRejectedValueOnce(new Error('provider timeout'))
    change('text', 'សួស្តី')
    await submit()
    expect(message()).toContain('provider timeout')
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    await submit()
    expect(field('result').props.value).toBe('Hello')
    expect(message()).toBe('')
  })

  it('ignores results that arrive after the view closes', async () => {
    const pending = deferred()
    invoke.mockReturnValue(pending.promise)
    change('text', 'សួស្តី')
    await submit()
    hooks.cleanup?.()
    pending.resolve({ ok: true, value: { status: 'translated', translatedText: 'Hello' } })
    await pending.promise
    await Promise.resolve()
    expect(field('result').props.value).toBe('')
  })

  it.each(['translated', 'login-required', 'challenge', 'error'])('opens the exact provider tab for %s results and keeps routing errors in the form', async (status) => {
    invoke.mockResolvedValue({ ok: true, value: { status, translatedText: 'Hello', browserTabId: 'owned-tab', url: 'https://untrusted.example/' } })
    onOpenBrowser.mockRejectedValue(new Error('Provider tab is no longer available'))
    change('text', 'សួស្តី')
    await submit()
    ;(button('Open provider in ND browser').props.onClick as () => void)()
    await Promise.resolve()
    expect(onOpenBrowser).toHaveBeenCalledWith('owned-tab')
    expect(message()).toContain('Provider tab is no longer available')
    expect(field('text').props.value).toBe('សួស្តី')
  })

  it('offers no browser route without a nonempty broker tab id and clears it when input changes', async () => {
    change('text', 'សួស្តី')
    invoke.mockResolvedValue({ ok: true, value: { status: 'error', browserTabId: ' ' } })
    await submit()
    expect(() => button('Open provider in ND browser')).toThrow('Missing button')
    invoke.mockResolvedValue({ ok: true, value: { status: 'error', browserTabId: 'owned-tab' } })
    await submit()
    expect(button('Open provider in ND browser')).toBeDefined()
    change('provider', 'gemini')
    expect(() => button('Open provider in ND browser')).toThrow('Missing button')
  })

  it('preserves source and preferences in memory after a successful browser route for sign-in', async () => {
    onOpenBrowser.mockResolvedValue(undefined)
    invoke.mockResolvedValue({ ok: true, value: { status: 'login-required', browserTabId: 'owned-tab' } })
    change('text', '  សួស្តី  ')
    change('source', 'km')
    change('target', 'fr')
    change('provider', 'chatgpt')
    await submit()
    ;(button('Open provider in ND browser').props.onClick as () => void)()
    await Promise.resolve()
    hooks.cleanup?.()
    hooks.values = []
    hooks.cursor = 0
    expect(field('text').props.value).toBe('  សួស្តី  ')
    expect(field('source').props.value).toBe('km')
    expect(field('target').props.value).toBe('fr')
    expect(field('provider').props.value).toBe('chatgpt')
    expect(field('result').props.value).toBe('')
    change('text', '') // Clear the in-memory draft for the next context opening.
  })

  it('locks source, preferences, swap, clear, and submissions until provider routing finishes', async () => {
    let finish!: () => void
    onOpenBrowser.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    invoke.mockResolvedValue({ ok: true, value: { status: 'translated', translatedText: 'Hello', browserTabId: 'owned-tab' } })
    change('text', 'សួស្តី')
    change('source', 'km')
    await submit()
    ;(button('Open provider in ND browser').props.onClick as () => void)()
    for (const id of ['text', 'provider', 'source', 'target']) expect(field(id).props.disabled).toBe(true)
    expect(button('Swap languages').props.disabled).toBe(true)
    expect(elements(render()).find((element) => element.props.children === 'Clear')?.props.disabled).toBe(true)
    change('text', 'changed during opening')
    change('provider', 'gemini')
    change('source', 'en')
    change('target', 'fr')
    ;(button('Swap languages').props.onClick as () => void)()
    await submit()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(field('text').props.value).toBe('សួស្តី')
    expect(field('source').props.value).toBe('km')
    expect(field('provider').props.value).toBe('google')
    expect(field('target').props.value).toBe('km')
    finish()
    await Promise.resolve()
    expect(field('text').props.disabled).toBe(false)
    change('text', '')
  })
})
