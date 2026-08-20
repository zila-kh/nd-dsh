import { useEffect, useRef } from 'react'
import type { DshViewState } from '../../../shared/contracts'
import { ExternalIcon, ReloadIcon } from './Icons'

interface DshPaneProps {
  active: boolean
  state: DshViewState | null
  onError(message: string): void
}

/**
 * Hosts the official DeepSeek Harness UI: the sandboxed WebContentsView the
 * main process created, layered over this container. Bounds stay in sync with
 * the layout through the same ResizeObserver contract the browser pane uses.
 */
export function DshPane({ active, state, onError }: DshPaneProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const webMode = document.documentElement.dataset.webMode === 'true'

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let animationFrame = 0
    const syncBounds = (): void => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const rect = surface.getBoundingClientRect()
        void window.ndDsh.dshView.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
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
    void window.ndDsh.dshView.setVisible(active)
    if (active) {
      requestAnimationFrame(() => {
        const rect = surfaceRef.current?.getBoundingClientRect()
        if (rect) void window.ndDsh.dshView.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      })
    }
    return () => {
      void window.ndDsh.dshView.setVisible(false)
    }
  }, [active])

  const reload = async (): Promise<void> => {
    try {
      await window.ndDsh.dshView.reload()
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <section className={`browser-pane dsh-pane ${active ? 'is-active' : ''}`} aria-label="DeepSeek Harness UI">
      <div className="browser-toolbar dsh-toolbar">
        <span className="dsh-toolbar-brand"><span className="mini-logo">DSH</span>DeepSeek Harness UI</span>
        <span className={`bridge-pill ${state?.ready ? 'ready' : 'binding'}`}>
          <span />{state?.ready ? `gateway :${state.port ?? ''}` : 'Starting runtime'}
        </span>
        <button className="icon-button" disabled={!state?.ready} onClick={() => void reload()} title="Reload the DeepSeek UI"><ReloadIcon className={state?.loading ? 'spin' : ''} /></button>
        <button
          className="icon-button"
          disabled={!state?.url}
          onClick={() => void window.ndDsh.browser.openExternal(state?.url ?? '')}
          title="Open in system browser"
        >
          <ExternalIcon />
        </button>
      </div>
      <div className="browser-native-surface" ref={surfaceRef}>
        {webMode ? (
          <div className="browser-placeholder"><div className="placeholder-ring" /><span>DeepSeek UI is served by the harness runtime in the desktop app.</span></div>
        ) : (
          <div className="browser-placeholder">
            <div className="placeholder-ring" />
            <span>{state?.loading ? 'Loading the DeepSeek UI' : state?.ready ? 'DeepSeek Harness UI' : 'Waiting for the harness runtime'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
