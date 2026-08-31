import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { BrowserState } from '../../../shared/contracts'
import { ArrowLeftIcon, ArrowRightIcon, CameraIcon, ContextIcon, ExternalIcon, PencilIcon, ReloadIcon } from './Icons'
import { BridgePill } from './bridge-pill'
import { cn } from '../lib/utils'

interface BrowserTab {
  id: number
  url: string
}

interface BrowserPaneProps {
  active: boolean
  state: BrowserState | null
  onSnapshot(result: string): void
  onError(message: string): void
}

const iconButtonClasses = cn(
  'grid size-[27px] shrink-0 place-items-center rounded-[5px] text-muted-foreground transition-colors',
  'hover:bg-accent hover:text-foreground',
  'disabled:pointer-events-none disabled:text-fainter [&_svg]:size-[15px]',
)

// Bordered/filled variant used by the snapshot camera and as the active
// marker for the inspect/annotation toggles.
const activeIconButtonClasses = cn(
  'inline-flex h-[27px] w-auto items-center gap-[5px] rounded-[5px] border border-border bg-secondary px-[7px]',
  'text-muted-foreground transition-colors hover:border-(--border-focus) hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[15px]',
)

export function BrowserPane({ active, state, onSnapshot, onError }: BrowserPaneProps) {
  const uiPreview = window.ndDshRuntimeMode === 'ui-preview'
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressFocused = useRef(false)
  const [address, setAddress] = useState(state?.url ?? 'about:blank')
  // Sub-tabs share the single embedded WebContentsView; each remembers its own
  // URL and re-navigates the shared surface on switch.
  const nextTabId = useRef(1)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = useState<number | null>(null)

  useEffect(() => {
    if (!addressFocused.current && state?.url) setAddress(state.url)
  }, [state?.url])

  // Keep the active tab's remembered URL in sync with the shared surface.
  useEffect(() => {
    if (activeTabId === null || !state?.url) return
    setTabs((current) => current.map((tab) => (tab.id === activeTabId ? { ...tab, url: state.url } : tab)))
  }, [state?.url, activeTabId])

  const createTab = (): void => {
    const id = nextTabId.current++
    setTabs((current) => [...current, { id, url: 'about:blank' }])
    setActiveTabId(id)
    setAddress('about:blank')
    if (state?.url && state.url !== 'about:blank') {
      void runBrowserAction(() => window.ndDsh.browser.navigate('about:blank'))
    }
  }

  const switchTab = (id: number): void => {
    setActiveTabId(id)
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    setAddress(tab.url)
    if (state?.url !== tab.url) {
      void runBrowserAction(() => window.ndDsh.browser.navigate(tab.url))
    }
  }

  const closeTab = (id: number): void => {
    setTabs((current) => {
      const index = current.findIndex((t) => t.id === id)
      const next = current.filter((t) => t.id !== id)
      if (activeTabId === id) {
        const fallback = next[Math.min(index, next.length - 1)] ?? null
        setActiveTabId(fallback?.id ?? null)
        if (fallback) {
          setAddress(fallback.url)
          if (state?.url !== fallback.url) {
            void runBrowserAction(() => window.ndDsh.browser.navigate(fallback.url))
          }
        }
      }
      return next
    })
  }

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let animationFrame = 0
    const syncBounds = (): void => {
      if (!active) return
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        void window.ndDsh.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
          .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
      })
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(surface)
    window.addEventListener('resize', syncBounds)
    if (active) syncBounds()
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [active, onError])

  useEffect(() => {
    void window.ndDsh.browser.setVisible(active)
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
    if (active) {
      requestAnimationFrame(() => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) {
          void window.ndDsh.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
            .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
        }
      })
    }
    return () => {
      void window.ndDsh.browser.setVisible(false).catch(() => undefined)
    }
  }, [active, onError])

  const navigate = async (): Promise<void> => {
    try {
      await window.ndDsh.browser.navigate(address)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runBrowserAction = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const snapshot = async (): Promise<void> => {
    try {
      const result = await window.ndDsh.browser.snapshot()
      onSnapshot(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const toggleInspectMode = async (): Promise<void> => {
    const setInspectMode = window.ndDsh.browser.setInspectMode
    if (!setInspectMode) {
      onError('UI inspect mode is available in the ND-DSH desktop app.')
      return
    }
    await runBrowserAction(() => setInspectMode(!state?.inspectMode))
  }

  const clearSelection = async (): Promise<void> => {
    const clear = window.ndDsh.browser.clearSelection
    if (!clear) return
    await runBrowserAction(() => clear())
  }

  const toggleAnnotationMode = async (): Promise<void> => {
    const setAnnotationMode = window.ndDsh.browser.setAnnotationMode
    if (!setAnnotationMode) {
      onError('UI annotation mode is available in the ND-DSH desktop app.')
      return
    }
    await runBrowserAction(() => setAnnotationMode(!state?.annotationMode))
  }

  const clearAnnotation = async (): Promise<void> => {
    const clear = window.ndDsh.browser.clearAnnotation
    if (!clear) return
    await runBrowserAction(() => clear())
  }

  const selected = state?.selectedTarget
  const selectedSource = selected?.source ?? selected?.react?.source
  const selectedName = selected?.react?.component ?? selected?.tagName
  const selectedTitle = selected
    ? `${selectedName ?? 'element'} · ${selectedSource ? `${selectedSource.file}:${selectedSource.line}` : selected.selector}`
    : undefined
  const annotation = state?.annotation
  const annotationTitle = annotation
    ? `${annotation.marks.length} mark${annotation.marks.length === 1 ? '' : 's'} · ${annotation.elements.length} referenced element${annotation.elements.length === 1 ? '' : 's'} · click to clear`
    : undefined

  return (
    <section className="flex flex-1 flex-col h-full w-full min-h-0 min-w-0 bg-background" aria-label="Built-in browser">
      <div className="flex h-[39px] shrink-0 min-w-0 items-center gap-[3px] border-b border-border-soft bg-secondary px-[7px] py-[5px]">
        <button className={iconButtonClasses} disabled={!state?.canGoBack || state?.annotationMode} onClick={() => void runBrowserAction(() => window.ndDsh.browser.back())} title="Back"><ArrowLeftIcon /></button>
        <button className={iconButtonClasses} disabled={!state?.canGoForward || state?.annotationMode} onClick={() => void runBrowserAction(() => window.ndDsh.browser.forward())} title="Forward"><ArrowRightIcon /></button>
        <button className={iconButtonClasses} disabled={Boolean(state?.annotationMode)} onClick={() => void runBrowserAction(() => window.ndDsh.browser.reload())} title="Reload"><ReloadIcon className={state?.loading ? 'animate-spin' : ''} /></button>
        <form
          className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-[7px] rounded-[7px] border border-border-strong bg-background px-[9px] transition-colors focus-within:border-(--border-focus)"
          onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!state?.annotationMode) void navigate() }}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', state?.url.startsWith('https:') ? 'bg-primary' : 'bg-warning')} />
          <input
            aria-label="Address"
            value={address}
            disabled={Boolean(state?.annotationMode)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)}
            onFocus={() => { addressFocused.current = true }}
            onBlur={() => { addressFocused.current = false }}
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent font-mono text-[9px] text-soft outline-none"
          />
        </form>
        <button className={activeIconButtonClasses} disabled={Boolean(state?.annotationMode)} onClick={() => void snapshot()} title="Interactive snapshot"><CameraIcon /></button>
        <button
          className={state?.inspectMode ? activeIconButtonClasses : iconButtonClasses}
          aria-pressed={Boolean(state?.inspectMode)}
          disabled={Boolean(state?.annotationMode)}
          onClick={() => void toggleInspectMode()}
          title={state?.inspectMode ? 'Cancel UI inspect mode (Esc)' : 'Inspect UI element and attach runtime context to the agent'}
        >
          <ContextIcon />
        </button>
        <button
          className={state?.annotationMode ? activeIconButtonClasses : iconButtonClasses}
          aria-pressed={Boolean(state?.annotationMode)}
          onClick={() => void toggleAnnotationMode()}
          title={state?.annotationMode
            ? 'Finish annotation and attach it to the next agent prompt'
            : 'Freeze the viewport and draw visual instructions for the agent'}
        >
          <PencilIcon />
        </button>
        <button
          className={iconButtonClasses}
          disabled={!state?.url || state.url === 'about:blank' || Boolean(state?.annotationMode)}
          onClick={() => void runBrowserAction(() => window.ndDsh.browser.openExternal(state?.url ?? address))}
          title="Open in system browser"
        >
          <ExternalIcon />
        </button>
        {state?.annotationMode ? (
          <BridgePill state="ready" onClick={() => void toggleAnnotationMode()} title="Finish drawing and attach this annotated frame">
            Annotating
          </BridgePill>
        ) : annotation ? (
          <BridgePill state="ready" onClick={() => void clearAnnotation()} title={annotationTitle}>
            Annotation: {annotation.marks.length}
          </BridgePill>
        ) : null}
        {selected ? (
          <BridgePill state="ready" onClick={() => void clearSelection()} title={`${selectedTitle ?? 'Selected UI'} · click to clear`}>
            UI: {selectedName ?? 'element'}
          </BridgePill>
        ) : null}
        <BridgePill state={state?.agentBrowser ?? 'binding'} title={state?.agentBrowserError}>
          {state?.agentBrowser === 'ready' ? 'Agent linked' : state?.agentBrowser === 'unavailable' ? 'Agent offline' : 'Linking'}
        </BridgePill>
      </div>
      {/* Sub-tabs: each remembers its own URL and drives the shared surface on switch. */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border-soft bg-secondary px-[7px] py-[3px]" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab) => {
          const tabActive = tab.id === activeTabId
          const label = tab.url === 'about:blank' ? `Tab ${tab.id}` : tab.url.replace(/^https?:\/\//, '').split(/[/?]/)[0] || `Tab ${tab.id}`
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tabActive}
              className={cn(
                'group flex max-w-[160px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-[5px] px-2 py-[3px] text-[9px]',
                tabActive ? 'bg-surface-0 text-strong' : 'text-soft hover:bg-accent/60'
              )}
              title={tab.url}
              onClick={() => switchTab(tab.id)}
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={`Close ${label}`}
                className={cn(
                  'shrink-0 rounded px-1 text-[10px] leading-none text-faint hover:bg-border-soft hover:text-foreground',
                  tabActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="shrink-0 rounded px-1.5 py-[2px] text-[11px] leading-none text-faint transition-colors hover:bg-accent hover:text-foreground"
          title="New tab"
          onClick={createTab}
        >
          +
        </button>
      </div>
      {/* Native WebContentsView host — bounds-synced over CDP; keep this DOM stable. */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-browser" ref={surfaceRef}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[10px] text-fainter">
          {state?.loading ? <div className="size-[34px] animate-spin rounded-full border border-border-strong border-t-primary" /> : null}
          <span>{state?.loading ? `Loading ${state.url}` : uiPreview ? 'Browser canvas is desktop-only; controls are simulated in UI preview.' : state?.url === 'about:blank' ? 'Enter a URL to open the shared agent browser.' : 'Shared Electron browser surface'}</span>
        </div>
      </div>
    </section>
  )
}
