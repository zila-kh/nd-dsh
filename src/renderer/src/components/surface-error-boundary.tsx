import React from 'react'
import { Button } from './ui/button'

/**
 * Human-readable one-line description of a renderer failure. Kept separate
 * from the class so tests and diagnostics share exactly one formatter.
 */
export function describeSurfaceError(error: unknown): string {
  if (error instanceof Error) return error.message.trim() || error.name || 'Unnamed renderer error'
  const text = String(error).trim()
  return text || 'Unknown renderer error'
}

export interface SurfaceErrorBoundaryProps {
  /** Surface name used in the fallback and the crash notification, e.g. "Chat". */
  label: string
  /**
   * Recovery token. When it changes while this surface is crashed, the surface
   * mounts again from scratch, so leaving and re-entering a view recovers
   * without restarting the app. Pass the state that makes the surface
   * meaningful (active view, workspace root, selected project).
   */
  resetKey?: string | number | undefined
  onError?: ((message: string) => void) | undefined
  children: React.ReactNode
}

interface SurfaceErrorBoundaryState {
  message: string | undefined
}

/**
 * Isolates one renderer surface so a crash inside it shows a local recovery
 * pane instead of blanking the whole desktop window. The global boundary in
 * `main.tsx` stays as the last resort; this one keeps sessions, terminals, and
 * organization state reachable while a single pane is broken.
 */
export class SurfaceErrorBoundary extends React.Component<SurfaceErrorBoundaryProps, SurfaceErrorBoundaryState> {
  state: SurfaceErrorBoundaryState = { message: undefined }

  static getDerivedStateFromError(error: unknown): SurfaceErrorBoundaryState {
    return { message: describeSurfaceError(error) }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(`ND ${this.props.label} surface failed:`, error, info?.componentStack)
    try {
      this.props.onError?.(`${this.props.label} pane crashed: ${describeSurfaceError(error)}`)
    } catch (notifyError) {
      // A crash must never escalate into a second crash while reporting itself.
      console.error('Surface crash notification failed:', notifyError)
    }
  }

  componentDidUpdate(previous: SurfaceErrorBoundaryProps): void {
    if (this.state.message !== undefined && previous.resetKey !== this.props.resetKey) this.setState({ message: undefined })
  }

  private retry = (): void => {
    this.setState({ message: undefined })
  }

  render(): React.ReactNode {
    if (this.state.message === undefined) return this.props.children
    return (
      <div role="alert" className="grid h-full w-full place-items-center overflow-auto bg-surface-0 p-6">
        <section className="w-full max-w-[560px] rounded-[10px] border border-destructive/30 bg-destructive/5 p-4">
          <small className="text-[11px] tracking-[0.12em] text-destructive">ND-DSH · {this.props.label.toUpperCase()} PANE FAILED</small>
          <h2 className="mb-1 mt-2 text-base font-semibold text-strong">This pane stopped; the rest of ND is still running</h2>
          <p className="my-2 text-sm/[1.6] text-muted-foreground">
            Sessions, files, terminals, and organization state are unaffected. Reload this pane to continue; if it keeps failing,
            include the message below in the report.
          </p>
          <pre className="mt-2 max-h-[160px] overflow-auto rounded-md border border-destructive/25 bg-surface-1 p-2 text-xs text-destructive">{this.state.message}</pre>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={this.retry}>Reload this pane</Button>
          </div>
        </section>
      </div>
    )
  }
}
