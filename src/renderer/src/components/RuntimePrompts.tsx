import { useEffect, useRef, useState } from 'react'
import type { DshEventFrame } from '../../../shared/contracts'
import type { OrganizationSnapshot } from '../../../shared/organization'
import type { AskQuestion } from '../lib/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { cn } from '../lib/utils'
import { runtimePromptContext } from '../lib/runtime-prompt-context'
import { runtimePromptAction } from '../lib/runtime-prompt-action'

interface Props { onError(message: string): void; organization: OrganizationSnapshot | null }
type PendingApproval = { kind: 'approval'; id: string; sessionId: string; rpcId: string; approvalId: string; toolName: string; reason?: string; callId?: string; action?: string }
type PendingQuestion = { kind: 'question'; id: string; sessionId: string; rpcId: string; questions: AskQuestion[] }
type Pending = PendingApproval | PendingQuestion

const chipClasses = cn(
  'h-[27px] rounded-md border px-2 text-xs transition-colors',
  'border-border-strong bg-secondary text-soft hover:bg-accent hover:text-foreground',
)
const primaryChipClasses = cn(
  'h-[27px] rounded-md border border-primary/30 bg-primary/10 px-2 text-xs text-primary transition-colors hover:bg-primary/15',
)

export function RuntimePrompts({ onError, organization }: Props) {
  const [pending, setPending] = useState<Pending[]>([])
  const inFlight = useRef(new Set<string>())
  const [responding, setResponding] = useState(new Set<string>())
  const toolActions = useRef(new Map<string, string>())

  useEffect(() => window.ndDsh.dsh.onEvent((frame) => handleFrame(frame)), [])

  function handleFrame(frame: DshEventFrame): void {
    if (frame.kind === 'session-event' && frame.sessionId && frame.event?.type === 'tool/call') {
      const data = frame.event.data
      if (!data || typeof data !== 'object') return
      const call = data as Record<string, unknown>
      const callId = typeof call.callId === 'string' ? call.callId : undefined
      const action = runtimePromptAction(call.arguments)
      if (!callId || !action) return
      toolActions.current.set(`${frame.sessionId}:${callId}`, action)
      while (toolActions.current.size > 128) toolActions.current.delete(toolActions.current.keys().next().value!)
      setPending((current) => current.map((entry) => entry.kind === 'approval' && entry.sessionId === frame.sessionId && entry.callId === callId ? { ...entry, action } : entry))
      return
    }
    if (frame.kind === 'approval-requested' && frame.sessionId && frame.rpcId) {
      const action = frame.callId ? toolActions.current.get(`${frame.sessionId}:${frame.callId}`) : undefined
      const item: PendingApproval = {
        kind: 'approval', id: `approval:${frame.rpcId}`, sessionId: frame.sessionId, rpcId: frame.rpcId,
        approvalId: frame.approvalId ?? frame.rpcId, toolName: frame.toolName ?? 'tool', ...(frame.reason ? { reason: frame.reason } : {}),
        ...(frame.callId ? { callId: frame.callId } : {}), ...(action ? { action } : {}),
      }
      setPending((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item])
      return
    }
    if (frame.kind === 'question-requested' && frame.sessionId && frame.rpcId) {
      const item: PendingQuestion = { kind: 'question', id: `question:${frame.rpcId}`, sessionId: frame.sessionId, rpcId: frame.rpcId, questions: normalizeQuestions(frame.questions) }
      setPending((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item])
      return
    }
    if (frame.kind === 'approval-resolved') {
      const resolvedId = frame.approvalId ?? frame.rpcId
      if (resolvedId) setPending((current) => current.filter((entry) => entry.kind !== 'approval' || entry.approvalId !== resolvedId))
      return
    }
    if (frame.kind === 'question-resolved' && frame.rpcId) {
      setPending((current) => current.filter((entry) => entry.kind !== 'question' || entry.rpcId !== frame.rpcId))
    }
  }

  async function answerApproval(item: PendingApproval, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    if (inFlight.current.has(item.id)) return
    inFlight.current.add(item.id)
    setResponding(new Set(inFlight.current))
    try {
      await window.ndDsh.dsh.respond(item.rpcId, { sessionId: item.sessionId, approvalId: item.approvalId, outcome })
      setPending((current) => current.filter((entry) => entry.id !== item.id))
    } catch (cause) { onError(errorMessage(cause)) }
    finally {
      inFlight.current.delete(item.id)
      setResponding(new Set(inFlight.current))
    }
  }

  if (pending.length === 0) return null
  return <aside className="fixed top-3.5 right-3.5 z-20 flex max-h-[calc(100%-28px)] w-[min(390px,calc(100%-28px))] flex-col overflow-hidden rounded-[9px] border border-warning/25 bg-sidebar shadow-[0_12px_30px_rgba(0,0,0,0.28)]" aria-label="Runtime requests">
    <header className="flex items-center justify-between border-b border-border-soft bg-warning/10 px-2.5 py-[9px]">
      <strong className="text-sm">Agent needs you</strong>
      <span className="grid size-[19px] place-items-center rounded-full bg-warning text-xs font-extrabold text-surface-0">{pending.length}</span>
    </header>
    <div className="max-h-[520px] overflow-auto p-2">
      {pending.map((item) => item.kind === 'approval'
        ? <article className="mb-[7px] rounded-[7px] border border-border-soft bg-surface-0 p-[9px] last:mb-0" key={item.id}>
            <small className="mb-[5px] block text-[11px] tracking-[0.1em] text-warning">APPROVAL</small>
            <RequestContext sessionId={item.sessionId} organization={organization} />
            <strong className="text-sm">{item.toolName}</strong>
            {item.reason ? <p className="my-[5px] text-xs leading-relaxed text-muted-foreground">{item.reason}</p> : null}
            {item.action ? <details className="my-2 text-xs"><summary className="cursor-pointer">Requested tool arguments</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-secondary p-2">{item.action}</pre></details> : null}
            <footer className="mt-2 flex justify-end gap-1.5">
              <Button variant="ghost" className={chipClasses} disabled={responding.has(item.id)} onClick={() => void answerApproval(item, 'rejected')}>Reject</Button>
              <Button variant="ghost" className={primaryChipClasses} disabled={responding.has(item.id)} onClick={() => void answerApproval(item, 'allowed-once')}>Allow once</Button>
            </footer>
          </article>
        : <QuestionPrompt key={item.id} item={item} organization={organization} onDone={() => setPending((current) => current.filter((entry) => entry.id !== item.id))} onError={onError} />)}
    </div>
  </aside>
}

function RequestContext({ sessionId, organization }: { sessionId: string; organization: OrganizationSnapshot | null }) {
  const context = runtimePromptContext(sessionId, organization)
  return <div className="mb-2 text-xs text-muted-foreground">
    {context.company || context.project ? <p>{[context.company, context.project].filter(Boolean).join(' / ')}</p> : null}
    {context.worker || context.task ? <p>{[context.worker, context.task].filter(Boolean).join(' · ')}</p> : null}
    {context.workspace ? <p className="break-all">Workspace: {context.workspace}</p> : null}
    <p className="break-all">Session: {context.sessionId}</p>
  </div>
}

function QuestionPrompt({ item, organization, onDone, onError }: { item: PendingQuestion; organization: OrganizationSnapshot | null; onDone(): void; onError(message: string): void }) {
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const inFlight = useRef(false)
  const [responding, setResponding] = useState(false)
  async function submit(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setResponding(true)
    try {
      const answers = item.questions.map((question) => ({ id: question.id, selected: selections[question.id] ?? [], ...(custom[question.id]?.trim() ? { custom: custom[question.id]!.trim() } : {}) }))
      await window.ndDsh.dsh.respond(item.rpcId, { sessionId: item.sessionId, answer: { answers } })
      onDone()
    } catch (cause) { onError(errorMessage(cause)) }
    finally { inFlight.current = false; setResponding(false) }
  }
  return <article className="mb-0 rounded-[7px] border border-border-soft bg-surface-0 p-[9px]">
    <small className="mb-[5px] block text-[11px] tracking-[0.1em] text-warning">QUESTION</small>
    <RequestContext sessionId={item.sessionId} organization={organization} />
    {item.questions.length === 0 ? <p className="my-[5px] text-xs leading-relaxed text-muted-foreground">The agent requested input. Add a response below.</p> : item.questions.map((question) => <section key={question.id} className="border-b border-border-soft py-2 last:border-b-0">
      <strong className="text-sm">{question.question}</strong>
      {question.detail ? <p className="my-[5px] text-xs leading-relaxed text-muted-foreground">{question.detail}</p> : null}
      <div className="my-1.5 flex flex-wrap gap-[5px]">{(question.options ?? []).map((option) => { const selected = (selections[question.id] ?? []).includes(option.label); return (
        <Button
          key={option.label}
          variant="ghost"
          disabled={responding}
          className={selected ? primaryChipClasses : chipClasses}
          onClick={() => setSelections((current) => { const existing = current[question.id] ?? []; const next = question.multiSelect ? selected ? existing.filter((value) => value !== option.label) : [...existing, option.label] : [option.label]; return { ...current, [question.id]: next } })}
        >{option.label}</Button>
      ) })}</div>
      <Input
        disabled={responding}
        value={custom[question.id] ?? ''}
        onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))}
        placeholder="Other answer…"
        className="h-auto py-[7px] text-xs"
      />
    </section>)}
    <footer className="mt-2 flex justify-end gap-1.5">
      <Button variant="ghost" className={primaryChipClasses} disabled={responding} onClick={() => void submit()}>Submit answer</Button>
    </footer>
  </article>
}

function normalizeQuestions(value: unknown): AskQuestion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const question = typeof record.question === 'string' ? record.question : typeof record.prompt === 'string' ? record.prompt : undefined
    if (!question) return []
    const options = Array.isArray(record.options) ? record.options.flatMap((option) => {
      if (typeof option === 'string') return [{ label: option }]
      if (!option || typeof option !== 'object' || typeof (option as Record<string, unknown>).label !== 'string') return []
      const optionRecord = option as Record<string, unknown>
      return [{ label: String(optionRecord.label), ...(typeof optionRecord.description === 'string' ? { description: optionRecord.description } : {}) }]
    }) : undefined
    return [{ id: typeof record.id === 'string' ? record.id : `q${index + 1}`, question, ...(typeof record.detail === 'string' ? { detail: record.detail } : {}), ...(options?.length ? { options } : {}), ...(typeof record.multiSelect === 'boolean' ? { multiSelect: record.multiSelect } : {}) }]
  })
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
