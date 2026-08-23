import { useEffect, useRef } from 'react'
import type { QaSuiteState } from '../../../shared/contracts'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { errorMessage, formatDuration, statusLabel, statusTextClass, useQaStreams } from '../lib/qa'

/**
 * ND-DSH's own unit/e2e developer suites. These live in Settings (not the QA
 * page) because they test ND-DSH itself, not the user's project.
 */
export function InternalSuitesCard({ onError }: { onError(message: string): void }) {
  const { qaState, outputs } = useQaStreams(onError)
  const suites = (qaState?.suites ?? []).filter((suite) => suite.kind === 'internal')
  const busy = Boolean(qaState?.activeRun)

  const runSuite = (suite: QaSuiteState): void => {
    void window.ndDsh.qa.run(suite.id).catch((cause) => onError(errorMessage(cause)))
  }

  const stopRun = (): void => {
    void window.ndDsh.qa.stop().catch((cause) => onError(errorMessage(cause)))
  }

  return (
    <div className="space-y-1.5">
      {suites.map((suite) => (
        <InternalSuiteRow
          key={suite.id}
          suite={suite}
          disabledByOtherRun={busy && qaState?.activeRun !== suite.id}
          consoleText={outputs.get(suite.id) ?? ''}
          onRun={() => runSuite(suite)}
          onStop={stopRun}
        />
      ))}
    </div>
  )
}

function InternalSuiteRow({ suite, disabledByOtherRun, consoleText, onRun, onStop }: {
  suite: QaSuiteState
  disabledByOtherRun: boolean
  consoleText: string
  onRun(): void
  onStop(): void
}) {
  const consoleRef = useRef<HTMLPreElement>(null)
  const running = suite.status === 'running'

  useEffect(() => {
    const pane = consoleRef.current
    if (pane) pane.scrollTop = pane.scrollHeight
  }, [consoleText])

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border-soft bg-surface-1 px-[13px] py-[11px]">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <strong className="text-xs font-semibold text-foreground">{suite.label}</strong>
          <span className="text-[10px]/[1.45] text-faint">{suite.description}</span>
          {suite.notice ? (
            <span className="text-[10px]/[1.45] text-warning">{suite.notice}</span>
          ) : suite.lastFinishedAt !== undefined ? (
            <span className="max-w-[340px] truncate text-[10px]/[1.45] text-faint">
              {`Last finished ${new Date(suite.lastFinishedAt).toLocaleString()} · ${formatDuration(suite.lastDurationMs)}${suite.lastExitCode === undefined ? '' : ` · exit ${suite.lastExitCode}`}`}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('text-[10px]/[1] font-semibold', statusTextClass(suite.status))}>{statusLabel(suite.status)}</span>
          {running ? (
            <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" onClick={onStop}>Stop</Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="rounded-md px-2.5 py-1 text-[11px]"
              disabled={disabledByOtherRun || suite.status === 'unavailable'}
              onClick={onRun}
            >
              Run
            </Button>
          )}
        </div>
      </div>
      {consoleText && (running || suite.status === 'failed') ? (
        <details open={running}>
          <summary className="cursor-pointer select-none text-[10px] font-semibold text-faint hover:text-soft">Console</summary>
          <pre ref={consoleRef} className="mb-0 mt-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-border-soft bg-composer p-2.5 font-mono text-[10px]/[1.5] text-soft">{consoleText}</pre>
        </details>
      ) : null}
    </div>
  )
}
