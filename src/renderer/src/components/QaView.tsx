import { useEffect, useRef, type ReactNode } from 'react'
import type { QaSuiteState } from '../../../shared/contracts'
import { Button } from './ui/button'
import { SparkIcon } from './Icons'
import { cn } from '../lib/utils'
import { errorMessage, formatDuration, outputTail, statusLabel, statusTextClass, useQaStreams } from '../lib/qa'

interface QaViewProps {
  active: boolean
  /** Workspace root of the user's project; checks come from its package.json. */
  workspaceRoot?: string
  onError(message: string): void
  /** Hands a plain-language fix request to the agent chat. */
  onAskAgent(prompt: string): void
}

/** Console text kept per failed row so the agent gets real evidence. */
const PROMPT_TAIL_CHARS = 6_000

export function QaView({ active, workspaceRoot, onError, onAskAgent }: QaViewProps) {
  const { qaState, outputs } = useQaStreams(onError)

  const projectSuites = (qaState?.suites ?? []).filter((suite) => suite.kind === 'project')
  const busy = Boolean(qaState?.activeRun)
  const runnable = projectSuites.filter((suite) => suite.status !== 'unavailable')
  const failed = projectSuites.filter((suite) => suite.status === 'failed')
  const passedCount = projectSuites.filter((suite) => suite.status === 'passed').length

  const runSuite = (suite: QaSuiteState): void => {
    void window.ndDsh.qa.run(suite.id).catch((cause) => onError(errorMessage(cause)))
  }

  // One QA process runs at a time (service-side guard), so "run all" is a
  // sequential queue; it stops early if the user stops the run or errors out.
  const runAll = async (): Promise<void> => {
    for (const suite of projectSuites) {
      if (suite.status === 'unavailable') continue
      try {
        await window.ndDsh.qa.run(suite.id)
      } catch (cause) {
        onError(errorMessage(cause))
        return
      }
    }
  }

  const stopRun = (): void => {
    void window.ndDsh.qa.stop().catch((cause) => onError(errorMessage(cause)))
  }

  const askAgentToFix = (suite: QaSuiteState): void => {
    onAskAgent([
      `The "${suite.label}" check (\`${suite.command}\`) is failing in this project.`,
      'Here is the tail of its output:',
      '',
      outputTail(outputs.get(suite.id) ?? '', PROMPT_TAIL_CHARS),
      '',
      'Find the root cause and fix it so this check passes.',
    ].join('\n'))
  }

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-[22px] py-[18px]" aria-hidden={!active}>
      <div>
        <h1 className="m-0 text-base font-bold">Project checks</h1>
        <p className="mb-0 mt-1 max-w-[640px] text-[10px]/[1.5] text-faint">
          Run this project's own quality checks — tests, lint, type check, build — and see in plain words what passes.
          When something fails, send it to the agent with one click and let it fix the problem.
        </p>
      </div>

      {!workspaceRoot ? (
        <EmptyCard
          title="No project open"
          body="Open a project folder first — its checks will show up here automatically."
        />
      ) : !qaState ? (
        <div className="flex min-w-0 items-center rounded-lg border border-border-soft bg-surface-1 px-[13px] py-[11px]">
          <strong className="text-xs font-semibold text-foreground">Looking for checks…</strong>
        </div>
      ) : projectSuites.length === 0 ? (
        <EmptyCard
          title="No checks found yet"
          body="ND looks for test, lint, typecheck, or build scripts in your project's package.json. Ask the agent to set them up, then they will appear here."
          action={
            <Button
              type="button"
              variant="secondary"
              className="rounded-md px-2.5 py-1 text-[11px]"
              onClick={() => onAskAgent('Set up quality checks for this project: add test, lint, and build scripts to package.json, install whatever they need, and make them all pass.')}
            >
              <SparkIcon /> Ask the agent to set up checks
            </Button>
          }
        />
      ) : (
        <>
          {busy && runnable.length > 0 ? (
            <VerdictBanner tone="info" text="Checking your project… You can keep working while it runs." />
          ) : failed.length > 0 ? (
            <VerdictBanner tone="bad" text={`${failed.length} of ${projectSuites.length} check${projectSuites.length === 1 ? '' : 's'} failed.`}>
              Send a failed check to the agent to get it fixed.
            </VerdictBanner>
          ) : passedCount > 0 && passedCount === projectSuites.length ? (
            <VerdictBanner tone="good" text="All clear — every check passed." />
          ) : null}

          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <h2 className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Checks</h2>
              {runnable.length > 1 && !busy ? (
                <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" onClick={() => void runAll()}>
                  Run all
                </Button>
              ) : null}
              {busy ? (
                <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" onClick={stopRun}>
                  Stop
                </Button>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {projectSuites.map((suite) => (
                <CheckRow
                  key={suite.id}
                  suite={suite}
                  disabledByOtherRun={busy && qaState.activeRun !== suite.id}
                  consoleText={outputs.get(suite.id) ?? ''}
                  onRun={() => runSuite(suite)}
                  onAskAgent={() => askAgentToFix(suite)}
                />
              ))}
            </div>
          </section>

          <p className="mb-0 mt-auto pt-2 text-[9px]/[1.5] text-fainter">
            Checks come from your project's package.json scripts and run in the project folder. ND-DSH's own internal
            test suites live in Settings → Developer diagnostics.
          </p>
        </>
      )}
    </div>
  )
}

function CheckRow({ suite, disabledByOtherRun, consoleText, onRun, onAskAgent }: {
  suite: QaSuiteState
  disabledByOtherRun: boolean
  consoleText: string
  onRun(): void
  onAskAgent(): void
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
              {`Last run ${new Date(suite.lastFinishedAt).toLocaleTimeString()} · ${formatDuration(suite.lastDurationMs)}${suite.lastExitCode === undefined ? '' : ` · exit code ${suite.lastExitCode}`}`}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cn('text-[10px]/[1] font-semibold', statusTextClass(suite.status))}>{statusLabel(suite.status)}</span>
          {running ? (
            <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" onClick={onRun}>Stop</Button>
          ) : suite.status !== 'unavailable' ? (
            <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" disabled={disabledByOtherRun} onClick={onRun}>Run</Button>
          ) : null}
          {suite.status === 'failed' ? (
            <Button type="button" variant="secondary" className="rounded-md px-2.5 py-1 text-[11px]" onClick={onAskAgent}>
              <SparkIcon /> Ask agent to fix
            </Button>
          ) : null}
        </div>
      </div>
      {consoleText && (running || suite.status === 'failed') ? (
        <details open={running || suite.status === 'failed'}>
          <summary className="cursor-pointer select-none text-[10px] font-semibold text-faint hover:text-soft">Console</summary>
          <pre ref={consoleRef} className="mb-0 mt-1.5 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-border-soft bg-composer p-2.5 font-mono text-[10px]/[1.5] text-soft">{consoleText}</pre>
        </details>
      ) : null}
    </div>
  )
}

function EmptyCard({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border-strong bg-surface-1/60 px-[15px] py-[18px]">
      <strong className="text-xs font-semibold text-foreground">{title}</strong>
      <p className="m-0 max-w-[520px] text-[10px]/[1.55] text-faint">{body}</p>
      {action}
    </div>
  )
}

function VerdictBanner({ tone, text, children }: { tone: 'good' | 'bad' | 'info'; text: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 rounded-lg border px-[13px] py-[10px] text-xs font-semibold',
        tone === 'good' && 'border-primary/25 bg-primary/[0.07] text-primary',
        tone === 'bad' && 'border-destructive/30 bg-destructive/[0.08] text-destructive',
        tone === 'info' && 'border-info/30 bg-info/[0.08] text-info',
      )}
    >
      {text}
      {children ? <span className="text-[10px] font-normal text-soft">{children}</span> : null}
    </div>
  )
}
