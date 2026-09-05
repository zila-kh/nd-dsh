import { useEffect, useRef, useState } from 'react'
import type { DshViewState, HarnessStatus } from '../../../shared/contracts'
import { ExternalIcon, ReloadIcon } from './Icons'
import { BridgePill } from './bridge-pill'

interface DshCodingSurfaceProps {
  active: boolean
  inspectOverlayVisible?: boolean
  state: DshViewState | null
  onNotify(message: string): void
}

export function shouldShowDshNativeView(active: boolean, inspectOverlayVisible: boolean): boolean {
  return active && !inspectOverlayVisible
}

/**
 * Renderer-owned frame for the sandboxed DSH WebContentsView. The main
 * process owns navigation and security; this component only synchronizes the
 * visible rectangle and exposes narrow reload/open-external controls.
 */
export function DshCodingSurface({ active, inspectOverlayVisible = false, state, onNotify }: DshCodingSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const updateLogRef = useRef<HTMLPreElement>(null)
  const uiPreview = window.ndDshRuntimeMode === 'ui-preview'
  const [runtimeStatus, setRuntimeStatus] = useState<HarnessStatus | null>(null)
  const [updating, setUpdating] = useState(false)
  const [updateLogOpen, setUpdateLogOpen] = useState(false)
  const [updateLog, setUpdateLog] = useState('')
  const [updateFeedback, setUpdateFeedback] = useState<{ message: string; error: boolean } | null>(null)
  // Native WebContentsViews always composite above renderer DOM. Yield the
  // view briefly so inspect result dialogs and their controls stay reachable.
  const nativeViewVisible = shouldShowDshNativeView(active, inspectOverlayVisible || updateLogOpen)
  const runtimeError = runtimeStatus?.state === 'error'
    ? runtimeStatus.error || 'The DSH runtime failed to start.'
    : runtimeStatus && !runtimeStatus.sourceReady
      ? 'The DSH runtime is not bootstrapped. Install/update DSH or run pnpm bootstrap from a source checkout.'
      : undefined

  useEffect(() => {
    let disposed = false
    void window.ndDsh.harness.status()
      .then((status) => { if (!disposed) setRuntimeStatus(status) })
      .catch((cause) => {
        if (!disposed) setRuntimeStatus({
          state: 'error',
          sourceReady: false,
          apiKeyPresent: false,
          apiKeyRequired: false,
          provider: '',
          model: '',
          error: cause instanceof Error ? cause.message : String(cause),
        })
      })
    const off = window.ndDsh.harness.onStatus((status) => {
      if (!disposed) setRuntimeStatus(status)
    })
    return () => {
      disposed = true
      off()
    }
  }, [])

  useEffect(() => {
    const host = surfaceRef.current
    if (!host) return
    let animationFrame = 0
    const syncBounds = (): void => {
      if (!active) return
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        void window.ndDsh.dshView
          .setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
          .catch((cause) => onNotify(cause instanceof Error ? cause.message : String(cause)))
      })
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(host)
    window.addEventListener('resize', syncBounds)
    syncBounds()
    return () => {
      cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [active, onNotify])

  useEffect(() => {
    void window.ndDsh.dshView
      .setVisible(nativeViewVisible)
      .catch((cause) => onNotify(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      void window.ndDsh.dshView.setVisible(false).catch(() => undefined)
    }
  }, [nativeViewVisible, onNotify])

  const reload = (): void => {
    void window.ndDsh.dshView.reload().catch((cause) => onNotify(cause instanceof Error ? cause.message : String(cause)))
  }

  const updateUpstream = (): void => {
    if (updating) return
    setUpdating(true)
    setUpdateLog('> Install @deepseek-ai/dsh@latest\n')
    setUpdateFeedback(null)
    void window.ndDsh.dshView.updateUpstream()
      .then((result) => {
        setUpdateLog((current) => `${current}\n[ND] ${result.message}\n`)
        setUpdateFeedback({ message: result.message, error: false })
        onNotify(result.message)
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        setUpdateLog((current) => `${current}\n[error] ${message}\n`)
        setUpdateFeedback({ message, error: true })
        onNotify(message)
      })
      .finally(() => setUpdating(false))
  }

  useEffect(() => window.ndDsh.dshView.onUpdateLog((entry) => {
    setUpdateLog((current) => `${current}${entry.chunk}`)
  }), [])

  useEffect(() => {
    if (!updateLogOpen) return
    const log = updateLogRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [updateLog, updateLogOpen])

  useEffect(() => {
    if (!updateFeedback) return
    const timeout = window.setTimeout(() => setUpdateFeedback(null), 12_000)
    return () => window.clearTimeout(timeout)
  }, [updateFeedback])

  return (
    <section className="flex h-full w-full min-h-0 min-w-0 flex-col bg-background" aria-label="DSH coding surface">
      <div className="flex h-[39px] shrink-0 items-center gap-2 border-b border-border-soft bg-secondary px-2">
        <strong className="text-[11px] tracking-[0.04em] text-strong">DSH coding</strong>
        <BridgePill state={runtimeError ? 'unavailable' : state?.ready ? 'ready' : 'binding'} className="ml-1 py-1" title={runtimeError}>
          {runtimeError ? 'Runtime error' : state?.ready ? `Gateway :${state.port ?? ''}` : 'Starting runtime'}
        </BridgePill>
        <button
          type="button"
          aria-label="Install or update DSH"
          aria-haspopup="dialog"
          className="flex h-6 shrink-0 items-center rounded-md border border-border-soft px-2 font-mono text-[9px] text-faint transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setUpdateLogOpen(true)}
          title={updating ? 'View the running DSH package install log' : 'Install or update the published DSH package'}
        >
          {updating ? 'Updating…' : 'Install / update DSH'}
        </button>
        <span
          role={runtimeError || updateFeedback ? 'status' : undefined}
          className={runtimeError || updateFeedback?.error
            ? 'min-w-0 flex-1 truncate font-mono text-[9px] text-destructive'
            : updateFeedback
              ? 'min-w-0 flex-1 truncate font-mono text-[9px] text-primary'
              : 'min-w-0 flex-1 truncate font-mono text-[9px] text-faint'}
          title={runtimeError ?? updateFeedback?.message ?? state?.title ?? 'DeepSeek route'}
        >
          {runtimeError ?? updateFeedback?.message ?? state?.title ?? 'DeepSeek route'}
        </span>
        <button
          type="button"
          aria-label="Reload DSH coding surface"
          className="grid size-[27px] shrink-0 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:text-fainter [&_svg]:size-[15px]"
          disabled={!state?.ready}
          onClick={reload}
          title="Reload DSH coding surface"
        >
          <ReloadIcon className={state?.loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          aria-label="Open DSH coding surface externally"
          className="grid size-[27px] shrink-0 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:text-fainter [&_svg]:size-[15px]"
          disabled={!state?.url}
          onClick={() => void window.ndDsh.browser.openExternal(state?.url ?? '').catch((cause) => onNotify(cause instanceof Error ? cause.message : String(cause)))}
          title="Open DSH coding surface in the system browser"
        >
          <ExternalIcon />
        </button>
      </div>
      {updateLogOpen ? (
        <div className="fixed inset-0 z-[220] grid place-items-center bg-black/55 p-5 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="DSH package install log"
            className="flex max-h-[min(620px,calc(100vh-40px))] w-[min(760px,calc(100vw-40px))] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-1 shadow-[0_24px_80px_rgba(0,0,0,0.58)]"
          >
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-soft bg-secondary px-3">
              <strong className="text-[11px] text-strong">Install or update DSH</strong>
              <span className="font-mono text-[9px] text-faint">{updating ? 'Running' : updateLog ? 'Finished' : 'Ready'}</span>
              <button
                type="button"
                className="ml-auto rounded-md border border-border-soft px-2 py-1 text-[10px] text-soft transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setUpdateLogOpen(false)}
              >
                Close
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
              <p className="m-0 text-[10px]/[1.5] text-faint">
                Installs the npm <code className="font-mono text-soft">latest</code> release of <code className="font-mono text-soft">@deepseek-ai/dsh</code> into ND's managed runtime. ND does not compile or patch the package.
              </p>
              <pre
                ref={updateLogRef}
                aria-live="polite"
                className="min-h-[280px] flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-border-soft bg-black/35 p-3 font-mono text-[10px]/[1.55] text-soft"
              >
                {updateLog || 'Ready. Select Run update to begin and stream the full updater log here.'}
              </pre>
            </div>
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-soft bg-secondary px-3 py-2">
              <button
                type="button"
                className="rounded-md border border-border-soft px-3 py-1.5 text-[10px] text-soft transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setUpdateLogOpen(false)}
              >
                {updating || updateLog ? 'Close' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={updating}
                className="rounded-md border border-primary/30 bg-primary/15 px-3 py-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/25 disabled:cursor-wait disabled:opacity-50"
                onClick={updateUpstream}
              >
                {updating ? 'Updating…' : updateLog ? 'Run update again' : 'Run update'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      <div ref={surfaceRef} className="relative min-h-0 min-w-0 flex-1 bg-surface-0">
        <div className="absolute inset-0 grid place-items-center px-6 text-xs text-faint">
          {inspectOverlayVisible ? (
            <span>DSH coding remains active while the inspection result is open.</span>
          ) : runtimeError ? (
            <div role="alert" className="max-w-[640px] rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-left">
              <strong className="block text-sm text-destructive">DSH runtime unavailable</strong>
              <p className="mb-0 mt-2 break-words text-[11px]/[1.55] text-muted-foreground">{runtimeError}</p>
              <p className="mb-0 mt-2 text-[10px]/[1.5] text-faint">Use Install / update DSH above for the managed runtime, or run <code className="font-mono text-soft">pnpm bootstrap</code> when developing from source.</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="size-[34px] animate-spin rounded-full border border-border-strong border-t-primary" />
              <span>
                {uiPreview
                  ? 'DSH coding is hosted by the desktop runtime.'
                  : state?.loading
                    ? 'Loading DSH coding'
                    : state?.ready
                      ? 'Connecting to DSH coding'
                      : 'Waiting for the runtime'}
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
