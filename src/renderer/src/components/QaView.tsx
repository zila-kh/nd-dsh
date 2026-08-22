import { useEffect, useRef, useState } from 'react'
import type { QaRunStatus, QaState, QaSuiteId } from '../../../shared/contracts'

interface QaViewProps {
  active: boolean
  onError(message: string): void
}

/** Output pane keeps the newest lines; older scrollback is dropped. */
const MAX_OUTPUT_CHARS = 200_000

export function QaView({ active, onError }: QaViewProps) {
  const [qaState, setQaState] = useState<QaState | null>(null)
  const [output, setOutput] = useState('')
  const outputRef = useRef<HTMLPreElement>(null)
  const statusHistory = useRef(new Map<QaSuiteId, QaRunStatus>())

  useEffect(() => {
    let mounted = true
    void window.ndDsh.qa.state()
      .then((state) => {
        if (mounted) setQaState(state)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const offState = window.ndDsh.qa.onState((state) => {
      // Mark each run's start in the console so interleaved output stays readable.
      for (const suite of state.suites) {
        if (suite.status === 'running' && statusHistory.current.get(suite.id) !== 'running') {
          const startedAt = new Date().toLocaleTimeString()
          setOutput((current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}── ${suite.label} · ${startedAt} ──\n`)
        }
        statusHistory.current.set(suite.id, suite.status)
      }
      setQaState(state)
    })
    const offOutput = window.ndDsh.qa.onOutput((chunk) => {
      setOutput((current) => {
        const next = current + chunk.text
        return next.length > MAX_OUTPUT_CHARS ? next.slice(next.length - MAX_OUTPUT_CHARS) : next
      })
    })
    return () => {
      mounted = false
      offState()
      offOutput()
    }
  }, [onError])

  useEffect(() => {
    const pane = outputRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [output])

  const runSuite = (suite: QaSuiteId): void => {
    void window.ndDsh.qa.run(suite).then(setQaState).catch((cause) => onError(errorMessage(cause)))
  }

  const stopRun = (): void => {
    void window.ndDsh.qa.stop().then(setQaState).catch((cause) => onError(errorMessage(cause)))
  }

  const busy = Boolean(qaState?.activeRun)

  return (
    <div className="qa-shell" aria-hidden={!active}>
      <div className="qa-head">
        <h1>QA</h1>
        <p>
          Run ND-DSH's own unit and end-to-end suites against the current project checkout. Runners come from the
          checkout's devDependencies, so a packaged install reports them as unavailable instead of faking a result.
        </p>
      </div>

      <section className="settings-section">
        <h2>Suites</h2>
        {!qaState ? <div className="settings-row"><div><strong>Detecting runners…</strong></div></div> : null}
        {(qaState?.suites ?? []).map((suite) => (
          <div className="settings-row" key={suite.id}>
            <div>
              <strong>{suite.label}</strong>
              <span><code>{suite.command}</code> via {suite.runner}</span>
              {suite.status === 'unavailable' ? (
                <span className="settings-path">Runner not installed in this checkout — run pnpm install first.</span>
              ) : null}
              {suite.lastFinishedAt !== undefined ? (
                <span className="settings-path">{`Last finished ${new Date(suite.lastFinishedAt).toLocaleString()} · ${formatDuration(suite.lastDurationMs)}${exitSuffix(suite)}`}</span>
              ) : null}
            </div>
            <div className="qa-suite-actions">
              <span className={`settings-status ${statusClass(suite.status)}`}>{statusLabel(suite.status)}</span>
              {suite.status === 'running' ? (
                <button type="button" className="toggle-button" onClick={stopRun}>Stop</button>
              ) : (
                <button
                  type="button"
                  className="toggle-button"
                  disabled={busy || suite.status === 'unavailable'}
                  onClick={() => runSuite(suite.id)}
                >
                  Run
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section qa-output-section">
        <h2>Live output</h2>
        <pre ref={outputRef} className="qa-output">{output || 'No runs yet.'}</pre>
      </section>
    </div>
  )
}

function statusClass(status: QaRunStatus): string {
  if (status === 'passed') return 'good'
  if (status === 'failed' || status === 'unavailable') return 'bad'
  if (status === 'running') return 'running'
  return ''
}

function statusLabel(status: QaRunStatus): string {
  switch (status) {
    case 'running': return 'Running'
    case 'passed': return 'Passed'
    case 'failed': return 'Failed'
    case 'unavailable': return 'Unavailable'
    default: return 'Not run'
  }
}

function exitSuffix(suite: { lastExitCode?: number }): string {
  return suite.lastExitCode === undefined ? '' : ` · exit ${suite.lastExitCode}`
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'unknown duration'
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(1)} s`
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
