import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { BrowserState } from '../../../shared/contracts'
import { ArrowLeftIcon, ArrowRightIcon, CameraIcon, ExternalIcon, ReloadIcon } from './Icons'

interface BrowserPaneProps {
  active: boolean
  state: BrowserState | null
  onSnapshot(result: string): void
  onError(message: string): void
}

export function BrowserPane({ active, state, onSnapshot, onError }: BrowserPaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressFocused = useRef(false)
  const [address, setAddress] = useState(state?.url ?? 'about:blank')

  useEffect(() => {
    if (!addressFocused.current && state?.url) setAddress(state.url)
  }, [state?.url])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let animationFrame = 0
    const syncBounds = (): void => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect()
        void window.ndDsh.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      })
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(surface)
    window.addEventListener('resize', syncBounds)
    syncBounds()
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [])

  useEffect(() => {
    void window.ndDsh.browser.setVisible(active)
    if (active) {
      requestAnimationFrame(() => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (rect) void window.ndDsh.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      })
    }
    return () => {
      void window.ndDsh.browser.setVisible(false)
    }
  }, [active])

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

  return (
    <section className={`browser-pane ${active ? 'is-active' : ''}`} aria-label="Built-in browser">
      <div className="browser-toolbar">
        <button className="icon-button" disabled={!state?.canGoBack} onClick={() => void runBrowserAction(() => window.ndDsh.browser.back())} title="Back"><ArrowLeftIcon /></button>
        <button className="icon-button" disabled={!state?.canGoForward} onClick={() => void runBrowserAction(() => window.ndDsh.browser.forward())} title="Forward"><ArrowRightIcon /></button>
        <button className="icon-button" onClick={() => void runBrowserAction(() => window.ndDsh.browser.reload())} title="Reload"><ReloadIcon className={state?.loading ? 'spin' : ''} /></button>
        <form className="address-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void navigate() }}>
          <span className={`connection-dot ${state?.url.startsWith('https:') ? 'secure' : ''}`} />
          <input
            aria-label="Address"
            value={address}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setAddress(event.target.value)}
            onFocus={() => { addressFocused.current = true }}
            onBlur={() => { addressFocused.current = false }}
            spellCheck={false}
          />
        </form>
        <button className="icon-button snapshot-button" onClick={() => void snapshot()} title="Interactive snapshot"><CameraIcon /></button>
        <button
          className="icon-button"
          disabled={!state?.url || state.url === 'about:blank'}
          onClick={() => void runBrowserAction(() => window.ndDsh.browser.openExternal(state?.url ?? address))}
          title="Open in system browser"
        >
          <ExternalIcon />
        </button>
        <span className={`bridge-pill ${state?.agentBrowser ?? 'binding'}`} title={state?.agentBrowserError}>
          <span />{state?.agentBrowser === 'ready' ? 'Agent linked' : state?.agentBrowser === 'unavailable' ? 'Agent offline' : 'Linking'}
        </span>
      </div>
      <div className="browser-native-surface" ref={surfaceRef}>
        <div className="browser-placeholder">
          {state?.loading ? <div className="placeholder-ring" /> : null}
          <span>{state?.loading ? `Loading ${state.url}` : state?.url === 'about:blank' ? 'Enter a URL to open the shared agent browser.' : 'Shared Electron browser surface'}</span>
        </div>
      </div>
    </section>
  )
}
