import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeftRight, Check, Copy, ExternalLink, Languages, LoaderCircle } from 'lucide-react'
import type { NdContext } from '../../../shared/nd-context'
import { contextKey } from '../../../shared/nd-context'
import {
  ND_TRANSLATE_LANGUAGES,
  ND_TRANSLATE_MAX_TEXT,
  type NdTranslateProvider,
  type NdTranslateRequest,
  type NdTranslateResult,
} from '../../../shared/nd-translate'
import { Button } from './ui/button'

const PROVIDERS: Array<{ id: NdTranslateProvider; label: string }> = [
  { id: 'google', label: 'Google Translate' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'gemini', label: 'Gemini' },
]
const SELECT_CLASS = 'h-8 rounded-md border border-border-soft bg-surface-0 px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring'
const TEXT_CLASS = 'min-h-48 w-full resize-none bg-transparent p-4 text-sm leading-relaxed text-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-60'
// Keep retry text only in this renderer's memory, scoped to the authorized context.
const browserDrafts = new Map<string, NdTranslateRequest>()
const manuallySelectedTargets = new Set<string>()

function restoreBrowserDraft(context: NdContext): NdTranslateRequest | undefined {
  const key = contextKey(context)
  const draft = browserDrafts.get(key)
  if (!draft) return undefined

  const migrated = { ...draft }
  // Older in-memory drafts captured English as the default before Khmer was
  // added. Preserve an intentional English choice, but migrate the old default.
  if (migrated.targetLanguage === 'en' && !manuallySelectedTargets.has(key)) migrated.targetLanguage = 'km'
  // Thai was removed from the language list in favor of Khmer.
  if (migrated.sourceLanguage === 'th') migrated.sourceLanguage = 'km'
  if (migrated.targetLanguage === 'th') migrated.targetLanguage = 'km'
  browserDrafts.set(key, migrated)
  return migrated
}

/** ND-owned view; all provider access stays behind the installed extension broker. */
export default function NdTranslateView({ context, onOpenBrowser }: {
  context: NdContext
  onOpenBrowser?: ((tabId: string) => Promise<void>) | undefined
}): React.ReactNode {
  const id = useId()
  const [initial] = useState(() => restoreBrowserDraft(context))
  const [text, setText] = useState(initial?.text ?? '')
  const [sourceLanguage, setSourceLanguage] = useState(initial?.sourceLanguage ?? 'auto')
  const [targetLanguage, setTargetLanguage] = useState(initial?.targetLanguage ?? 'km')
  const [provider, setProvider] = useState<NdTranslateProvider>(initial?.provider ?? 'google')
  const [result, setResult] = useState<NdTranslateResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [openingBrowser, setOpeningBrowser] = useState(false)
  const mounted = useRef(true)
  const revision = useRef(0)
  const pending = useRef(false)
  const opening = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current += 1
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  const invalidate = (): void => {
    revision.current += 1
    setResult(null)
    setMessage(null)
    setCopied(false)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    browserDrafts.delete(contextKey(context))
  }

  const openBrowser = async (): Promise<void> => {
    const tabId = result?.browserTabId
    if (!onOpenBrowser || typeof tabId !== 'string' || !tabId.trim() || opening.current) return
    const openedRevision = revision.current
    const draft: NdTranslateRequest = { text, sourceLanguage, targetLanguage, provider }
    const key = contextKey(context)
    opening.current = true
    setOpeningBrowser(true)
    browserDrafts.delete(key)
    browserDrafts.set(key, draft)
    if (browserDrafts.size > 32) browserDrafts.delete(browserDrafts.keys().next().value!)
    try {
      // The successful route closes this view; retain text for the next opening.
      await onOpenBrowser(tabId)
    } catch (cause) {
      if (browserDrafts.get(key) === draft) browserDrafts.delete(key)
      if (mounted.current && openedRevision === revision.current) {
        setMessage(cause instanceof Error ? cause.message : 'The provider tab could not be opened. Translate again to create a new tab.')
      }
    } finally {
      opening.current = false
      if (mounted.current) setOpeningBrowser(false)
    }
  }

  const translate = async (): Promise<void> => {
    if (pending.current || opening.current || !text.trim() || text.length > ND_TRANSLATE_MAX_TEXT) return
    const request: NdTranslateRequest = { text, sourceLanguage, targetLanguage, provider }
    const submittedRevision = revision.current
    pending.current = true
    setBusy(true)
    setResult(null)
    setMessage(null)
    setCopied(false)
    try {
      const response = await window.ndDsh.ndExtensions.invoke({
        extensionId: 'nd.translate',
        contributionKind: 'view',
        contributionId: 'translator',
        caller: 'user',
        context,
        input: { ...request },
      })
      if (!mounted.current || submittedRevision !== revision.current) return
      if (!response.ok) {
        setMessage(response.error?.message ?? 'Translation failed. Please try again.')
        return
      }
      const value = response.value as Partial<NdTranslateResult> | undefined
      if (!value || typeof value !== 'object' || !['idle', 'translated', 'login-required', 'challenge', 'error', 'busy'].includes(String(value.status))) {
        setMessage('The translation provider returned an invalid response. Please try again.')
        return
      }
      if (value.status === 'translated') {
        if (typeof value.translatedText !== 'string' || !value.translatedText.trim()) {
          setMessage('The provider did not return translated text. Please try again.')
          return
        }
        // Preserve the exact submitted source and settings alongside the result.
        setResult({ ...value, ...request, status: 'translated', translatedText: value.translatedText })
        return
      }
      setResult({ ...value, ...request, status: value.status as NdTranslateResult['status'] })
      setMessage(typeof value.message === 'string' && value.message.trim()
        ? value.message
        : value.status === 'login-required'
          ? `Sign in to ${PROVIDERS.find((item) => item.id === provider)?.label} in the ND browser, then translate again.`
          : value.status === 'challenge'
            ? 'Complete the provider check in the ND browser, then translate again.'
            : value.status === 'busy'
              ? 'The ND browser is busy. Try again when its current task finishes.'
              : 'Translation is unavailable. Check the provider in the ND browser and try again.')
    } catch (cause) {
      if (mounted.current && submittedRevision === revision.current) {
        setMessage(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const copy = async (): Promise<void> => {
    if (result?.status !== 'translated' || !result.translatedText) return
    const copiedRevision = revision.current
    try {
      await navigator.clipboard.writeText(result.translatedText)
      if (!mounted.current || copiedRevision !== revision.current) return
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => { if (mounted.current) setCopied(false) }, 2000)
    } catch {
      if (mounted.current && copiedRevision === revision.current) {
        setMessage('Clipboard access failed. Select the translation text and copy it manually.')
      }
    }
  }

  const swap = (): void => {
    if (sourceLanguage === 'auto' || opening.current) return
    const translated = result?.status === 'translated' ? result.translatedText : undefined
    invalidate()
    setSourceLanguage(targetLanguage)
    setTargetLanguage(sourceLanguage)
    if (translated) {
      setText(translated)
      if (translated.length > ND_TRANSLATE_MAX_TEXT) setMessage(`Shorten the text to ${ND_TRANSLATE_MAX_TEXT.toLocaleString()} characters before translating again.`)
    }
  }
  const needsBrowser = result?.status === 'login-required' || result?.status === 'challenge'

  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void translate() }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-soft"><Languages className="size-4 text-primary" /> Quick translation</div>
        <label className="flex items-center gap-2 text-xs text-faint" htmlFor={`${id}-provider`}>
          Provider
          <select id={`${id}-provider`} className={SELECT_CLASS} disabled={openingBrowser} value={provider} onChange={(event) => { if (opening.current) return; invalidate(); setProvider(event.target.value as NdTranslateProvider) }}>
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-source`} className="sr-only">Source language</label>
        <select id={`${id}-source`} className={`${SELECT_CLASS} min-w-0 flex-1`} disabled={openingBrowser} value={sourceLanguage} onChange={(event) => { if (opening.current) return; invalidate(); setSourceLanguage(event.target.value) }}>
          <option value="auto">Detect language</option>
          {ND_TRANSLATE_LANGUAGES.filter((item) => item.code !== 'auto').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Swap languages" title={sourceLanguage === 'auto' ? 'Choose a source language to swap' : 'Swap languages'} disabled={sourceLanguage === 'auto' || busy || openingBrowser} onClick={swap}><ArrowLeftRight className="size-4" /></Button>
        <label htmlFor={`${id}-target`} className="sr-only">Target language</label>
        <select id={`${id}-target`} className={`${SELECT_CLASS} min-w-0 flex-1`} disabled={openingBrowser} value={targetLanguage} onChange={(event) => { if (opening.current) return; manuallySelectedTargets.add(contextKey(context)); invalidate(); setTargetLanguage(event.target.value) }}>
          {ND_TRANSLATE_LANGUAGES.filter((item) => item.code !== 'auto').map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border-soft bg-surface-0/50 sm:grid-cols-2">
        <div className="border-b border-border-soft sm:border-b-0 sm:border-r">
          <label htmlFor={`${id}-text`} className="block px-4 pt-3 text-xs font-medium text-soft">Original text</label>
          <textarea id={`${id}-text`} className={TEXT_CLASS} disabled={openingBrowser} placeholder="Type or paste text to translate…" value={text} maxLength={ND_TRANSLATE_MAX_TEXT} onChange={(event) => { if (opening.current) return; invalidate(); setText(event.target.value) }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void translate() } }} />
          <div className="flex items-center justify-between px-4 pb-3 text-[11px] text-faint"><span>{text.length.toLocaleString()} / {ND_TRANSLATE_MAX_TEXT.toLocaleString()}</span><Button type="button" size="xs" variant="ghost" disabled={!text || busy || openingBrowser} onClick={() => { if (opening.current) return; invalidate(); setText('') }}>Clear</Button></div>
        </div>
        <div aria-busy={busy}>
          <label htmlFor={`${id}-result`} className="block px-4 pt-3 text-xs font-medium text-soft">Translation</label>
          <textarea id={`${id}-result`} className={TEXT_CLASS} readOnly value={result?.status === 'translated' ? result.translatedText ?? '' : ''} placeholder={busy ? 'Translating in the ND browser…' : 'Your translation appears here'} />
          <div className="flex min-h-9 items-center justify-between gap-2 px-4 pb-3"><span className="text-[11px] text-faint" role="status">{busy ? 'Translation in progress' : result?.status === 'translated' ? 'Translation ready' : 'Ready to translate'}</span><Button type="button" size="xs" variant="ghost" disabled={result?.status !== 'translated'} onClick={() => void copy()}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? 'Copied' : 'Copy'}</Button></div>
        </div>
      </div>
      {message ? <div role="alert" className="rounded-md border border-border-soft bg-surface-0/60 p-3 text-xs text-soft">{message}{needsBrowser ? <p className="mt-1 text-faint">The provider is open in the ND browser. Complete any sign-in or verification there, then retry.</p> : null}</div> : null}
      {onOpenBrowser && typeof result?.browserTabId === 'string' && result.browserTabId.trim() ? (
        <Button type="button" size="sm" variant="outline" disabled={busy || openingBrowser} onClick={() => void openBrowser()}>
          {openingBrowser ? <LoaderCircle className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
          {openingBrowser ? 'Opening provider…' : 'Open provider in ND browser'}
        </Button>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-[11px] text-faint">{provider === 'google' ? 'Google Translate usually works without signing in.' : `${PROVIDERS.find((item) => item.id === provider)?.label} may require sign-in or verification in the ND browser.`} Text is sent to the selected provider when you translate.</p>
        <Button type="submit" size="sm" disabled={busy || openingBrowser || !text.trim() || text.length > ND_TRANSLATE_MAX_TEXT}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Languages className="size-3.5" />}{busy ? 'Translating…' : 'Translate'}</Button>
      </div>
      <p className="text-[10px] text-faint">Ctrl / ⌘ + Enter to translate</p>
    </form>
  )
}
