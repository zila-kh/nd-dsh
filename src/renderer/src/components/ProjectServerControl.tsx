import { useEffect, useState } from 'react'
import type { ProjectRuntimeStatus } from '../../../shared/organization'

/** This controls only the child owned by ProjectRuntimeService, never a tool row. */
export function ProjectServerControl({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<ProjectRuntimeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    let disposed = false
    let revision = 0
    const api = window.ndDshOrganization
    const refresh = async () => {
      const request = ++revision
      try {
        const next = await api.projectRuntime(projectId)
        if (!disposed && request === revision) { setStatus(next); setError(null) }
      } catch (cause) {
        if (!disposed && request === revision) { setStatus(null); setError(String(cause)) }
      }
    }
    const unsubscribe = api.onRuntimeChanged((next) => {
      if (next.projectId === projectId) void refresh()
    })
    void refresh()
    // Reconcile ownership even if a health-check event omits its child PID.
    const timer = setInterval(() => void refresh(), 2000)
    return () => { disposed = true; clearInterval(timer); unsubscribe() }
  }, [projectId])

  const stop = async () => {
    setStopping(true)
    try {
      setStatus(await window.ndDshOrganization.stopProjectRuntime(projectId))
      setError(null)
    } catch (cause) { setError(String(cause)) }
    finally { setStopping(false) }
  }

  return (
    <div className="mx-3 mt-1 flex items-center gap-2 text-[10px] text-faint" aria-label="Project server">
      <span role="status" title={error ?? status?.lastError ?? status?.targetUrl}>
        {error ? 'Server status unavailable' : !status ? 'Loading server status…' : status.pid
          ? `Managed server: ${status.state} · PID ${status.pid}`
          : `No ND-managed server · ${status.state === 'ready' ? 'external target reachable' : status.state}`}
      </span>
      {status?.pid ? <button type="button" className="shrink-0 rounded border border-border px-2 py-1 text-soft hover:bg-accent disabled:opacity-50"
        disabled={stopping} onClick={() => void stop()}
        title="Stop only this project's ND-managed server. Responses and arbitrary shell commands are not affected.">
        {stopping ? 'Stopping server…' : 'Stop server'}
      </button> : null}
    </div>
  )
}
