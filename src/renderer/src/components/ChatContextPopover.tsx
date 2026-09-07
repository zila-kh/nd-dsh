import { useEffect, useState } from 'react'
import type { SessionSummary } from '../../../shared/contracts'
import { formatContextTokens, readChatContextUsage } from '../../../shared/chat-context'
import { ContextIcon, FileIcon } from './Icons'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface Props {
  sessionId: string | null
  projections: Record<string, unknown> | undefined
  busy: boolean
  open: boolean
  onOpenChange(open: boolean): void
  onOpenFile: ((path: string) => void) | undefined
  activity: {
    readFiles: string[]
    editedFiles: string[]
    tools: Array<{ name: string; count: number }>
    userMessages: number
    assistantMessages: number
  }
}

export function ChatContextPopover({ sessionId, projections, busy, open, onOpenChange, onOpenFile, activity }: Props) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; values: Record<string, unknown> } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  // Read the runtime's complete-log projections, never estimate usage from
  // our paged transcript. Poll only while active or being inspected.
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      try {
        const result = await window.ndDsh.dsh.rpc('session.list', {})
        if (!result.ok) throw new Error('Context unavailable')
        const items = (result.value as { items?: SessionSummary[] } | undefined)?.items
        const values = items?.find((item) => item.sessionId === sessionId)?.projections?.values
        if (!cancelled) {
          setSnapshot({ sessionId, values: values ?? {} })
          setUnavailable(false)
        }
      } catch {
        if (!cancelled) setUnavailable(true)
      } finally {
        if (!cancelled && (busy || open)) timer = setTimeout(() => { void refresh() }, 4000)
      }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [sessionId, busy, open])

  const usage = readChatContextUsage(snapshot?.sessionId === sessionId ? snapshot?.values : projections)
  const percent = usage.percent
  const occupied = Math.min(100, percent ?? 0)
  const reading = usage.used === undefined ? 'Not reported'
    : `${usage.estimated ? '~' : ''}${formatContextTokens(usage.used)}${usage.capacity === undefined ? ' tokens' : ` / ${formatContextTokens(usage.capacity)}`}`
  const toolCalls = activity.tools.reduce((sum, tool) => sum + tool.count, 0)
  const fileCount = activity.readFiles.length + activity.editedFiles.length

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Chat context: ${percent === undefined ? reading : `${percent.toFixed(1)}% used`}`}
          title="Inspect chat context and token usage"
          className="flex h-6 items-center gap-[5px] rounded-full border border-border-strong px-2 font-mono text-[10px] text-soft transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary [&_svg]:size-3">
          <ContextIcon />
          <span>{percent === undefined ? usage.used === undefined ? 'Context' : formatContextTokens(usage.used) : `${percent.toFixed(1)}%`}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} collisionPadding={12} aria-label="Chat context details"
        className="z-[130] max-h-[min(560px,var(--radix-popover-content-available-height))] w-[360px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-2xl border-border-strong bg-surface-1 p-4 text-[12px] text-soft shadow-[0_12px_40px_rgba(0,0,0,0.4)]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="m-0 text-[14px] font-semibold text-foreground">Context window</h2>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{reading}{percent === undefined ? '' : ` (${percent.toFixed(1)}%)`}</span>
        </div>
        <div className="mb-4 mt-3 flex h-2 overflow-hidden rounded-full bg-foreground/10"
          role={percent === undefined ? undefined : 'progressbar'} aria-label="Context window used"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === undefined ? undefined : occupied}
          aria-valuetext={percent === undefined ? 'Usage not reported' : `${percent.toFixed(1)}% used`}>
          {percent !== undefined && (usage.parts.length > 0 ? usage.parts.map((part) => (
            <span key={part.label} style={{ width: `${occupied * part.percent / 100}%`, backgroundColor: part.color }} />
          )) : <span className="bg-[#429bfa]" style={{ width: `${occupied}%` }} />)}
        </div>
        {usage.parts.length > 0 ? (
          <>
            <div className="space-y-3">
              {usage.parts.map((part) => (
                <div key={part.label} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: part.color }} />{part.label}</span>
                  <span className="font-mono tabular-nums text-foreground" title={`Approximately ${formatContextTokens(part.tokens)} tokens`}>{part.percent.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <p className="mb-0 mt-3 text-[10px] leading-relaxed text-muted-foreground">Estimated composition of the next request. Tool definitions include available tools; system prompt includes instructions and supplied context.</p>
          </>
        ) : <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">{usage.used === undefined ? 'Token usage will appear when the engine reports it.' : 'This engine has not reported a context breakdown.'}</p>}
        {percent !== undefined && percent >= 90 ? <p className="mb-0 mt-3 text-[11px] text-amber-500">{percent >= 100 ? 'Context capacity reached.' : 'Context is nearly full.'}</p> : null}
        <div className="my-4 space-y-3 border-y border-border-soft py-3">
          <Metric label="Cache hit rate" value={usage.cacheHitRate === undefined ? 'Not reported' : `${usage.cacheHitRate.toFixed(1)}%`} />
          <div className="flex items-baseline justify-between gap-3">
            <span>Session tokens</span>
            <span className="font-mono text-[11px] tabular-nums text-foreground">{usage.input === undefined ? '—' : formatContextTokens(usage.input)} in · {usage.output === undefined ? '—' : formatContextTokens(usage.output)} out</span>
          </div>
          <p className="m-0 text-[10px] leading-relaxed text-muted-foreground">Cache rate and token totals cover the full session.{usage.estimated ? ' Window usage estimates the next request.' : ''}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[12px] font-semibold text-foreground">Thread activity</h3>
          <span className="text-[11px] text-muted-foreground">{fileCount} files · {toolCalls} tool calls</span>
        </div>
        <p className="mb-0 mt-1 text-[11px] text-muted-foreground">{activity.userMessages} prompts · {activity.assistantMessages} replies in loaded history</p>
        {fileCount > 0 || toolCalls > 0 ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Files and tools</summary>
            <div className="mt-2 max-h-40 space-y-2 overflow-auto">
              {[{ label: 'Edited', files: activity.editedFiles }, { label: 'Read', files: activity.readFiles }].map((group) => group.files.length > 0 ? (
                <div key={group.label}>
                  <p className="my-1 text-[10px] font-medium text-muted-foreground">{group.label}</p>
                  {group.files.map((file) => <button key={file} type="button" title={file} disabled={!onOpenFile} onClick={() => onOpenFile?.(file)}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[11px] hover:bg-accent disabled:cursor-default [&_svg]:size-3 [&_svg]:shrink-0"><FileIcon /><span className="truncate">{file}</span></button>)}
                </div>
              ) : null)}
              {activity.tools.map((tool) => <Metric key={tool.name} label={tool.name} value={`×${tool.count}`} />)}
            </div>
          </details>
        ) : null}
        {unavailable && sessionId ? <p role="status" className="mb-0 mt-3 text-[10px] text-muted-foreground">Couldn’t refresh usage. Showing the last available report.</p> : null}
      </PopoverContent>
    </Popover>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate">{label}</span><span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">{value}</span></div>
}
