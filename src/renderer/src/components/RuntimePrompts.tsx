import { useEffect, useState } from 'react'
import type { DshEventFrame } from '../../../shared/contracts'
import type { AskQuestion } from '../lib/types'

interface Props { onError(message: string): void }
type PendingApproval = { kind: 'approval'; id: string; sessionId: string; rpcId: string; approvalId: string; toolName: string; reason?: string }
type PendingQuestion = { kind: 'question'; id: string; sessionId: string; rpcId: string; questions: AskQuestion[] }
type Pending = PendingApproval | PendingQuestion

export function RuntimePrompts({ onError }: Props) {
  const [pending, setPending] = useState<Pending[]>([])

  useEffect(() => window.ndDsh.dsh.onEvent((frame) => handleFrame(frame)), [])

  function handleFrame(frame: DshEventFrame): void {
    if (frame.kind === 'approval-requested' && frame.sessionId && frame.rpcId) {
      const item: PendingApproval = {
        kind: 'approval', id: `approval:${frame.rpcId}`, sessionId: frame.sessionId, rpcId: frame.rpcId,
        approvalId: frame.approvalId ?? frame.rpcId, toolName: frame.toolName ?? 'tool', ...(frame.reason ? { reason: frame.reason } : {}),
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
      setPending((current) => current.filter((entry) => entry.kind !== 'approval' || (frame.approvalId && entry.approvalId !== frame.approvalId)))
      return
    }
    if (frame.kind === 'question-resolved' && frame.rpcId) {
      setPending((current) => current.filter((entry) => entry.kind !== 'question' || entry.rpcId !== frame.rpcId))
    }
  }

  async function answerApproval(item: PendingApproval, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    try {
      await window.ndDsh.dsh.respond(item.rpcId, { sessionId: item.sessionId, approvalId: item.approvalId, outcome })
      setPending((current) => current.filter((entry) => entry.id !== item.id))
    } catch (cause) { onError(errorMessage(cause)) }
  }

  if (pending.length === 0) return null
  return <aside className="runtime-prompts" aria-label="Runtime requests">
    <header><strong>Agent needs you</strong><span>{pending.length}</span></header>
    <div className="runtime-prompts-scroll">
      {pending.map((item) => item.kind === 'approval'
        ? <article className="runtime-prompt-card" key={item.id}>
            <small>APPROVAL</small><strong>{item.toolName}</strong>{item.reason ? <p>{item.reason}</p> : null}
            <footer><button onClick={() => void answerApproval(item, 'rejected')}>Reject</button><button className="primary" onClick={() => void answerApproval(item, 'allowed-once')}>Allow once</button></footer>
          </article>
        : <QuestionPrompt key={item.id} item={item} onDone={() => setPending((current) => current.filter((entry) => entry.id !== item.id))} onError={onError} />)}
    </div>
  </aside>
}

function QuestionPrompt({ item, onDone, onError }: { item: PendingQuestion; onDone(): void; onError(message: string): void }) {
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  async function submit(): Promise<void> {
    try {
      const answers = item.questions.map((question) => ({ id: question.id, selected: selections[question.id] ?? [], ...(custom[question.id]?.trim() ? { custom: custom[question.id]!.trim() } : {}) }))
      await window.ndDsh.dsh.respond(item.rpcId, { sessionId: item.sessionId, answer: { answers } })
      onDone()
    } catch (cause) { onError(errorMessage(cause)) }
  }
  return <article className="runtime-prompt-card question">
    <small>QUESTION</small>
    {item.questions.length === 0 ? <p>The agent requested input. Add a response below.</p> : item.questions.map((question) => <section key={question.id}>
      <strong>{question.question}</strong>{question.detail ? <p>{question.detail}</p> : null}
      <div>{(question.options ?? []).map((option) => { const selected = (selections[question.id] ?? []).includes(option.label); return <button key={option.label} className={selected ? 'selected' : ''} onClick={() => setSelections((current) => { const existing = current[question.id] ?? []; const next = question.multiSelect ? selected ? existing.filter((value) => value !== option.label) : [...existing, option.label] : [option.label]; return { ...current, [question.id]: next } })}>{option.label}</button> })}</div>
      <input value={custom[question.id] ?? ''} onChange={(event) => setCustom((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Other answer…" />
    </section>)}
    <footer><button className="primary" onClick={() => void submit()}>Submit answer</button></footer>
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
