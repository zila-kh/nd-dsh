import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type {
  CompanyKnowledgeKind,
  OrganizationStrategyProjection,
  OrganizationStrategySnapshot,
  StrategicAnchorPriority,
} from '../../../shared/organization-strategy'
import type { ReviewFeedbackLabel } from '../../../shared/organization-control'
import { cn } from '../lib/utils'
import { Card as UiCard } from './ui/card'

interface Props {
  companyId: string
  projectId?: string
  agents: Array<{ id: string; name: string }>
  onError(message: string): void
}

const button = cn(
  'h-7 shrink-0 rounded-md border border-border-strong bg-secondary px-[9px] text-sm text-soft transition-colors',
  'hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-45',
)
const primaryButton = cn(
  'h-7 shrink-0 rounded-md border border-primary/30 bg-primary/10 px-[9px] text-sm font-medium text-primary transition-colors',
  'hover:bg-primary/[0.16] disabled:pointer-events-none disabled:opacity-45',
)
const input = cn(
  'min-w-0 rounded-md border border-border-strong bg-background px-[9px] py-[7px] text-sm text-foreground outline-none',
  'focus:border-primary/40',
)

export function OrganizationStrategyCenter({ companyId, projectId, agents, onError }: Props) {
  const [state, setState] = useState<OrganizationStrategySnapshot | null>(null)
  const [projection, setProjection] = useState<OrganizationStrategyProjection | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [anchor, setAnchor] = useState({ title: '', outcome: '', criteria: '', priority: 'high' as StrategicAnchorPriority })
  const [knowledge, setKnowledge] = useState({ kind: 'lesson' as CompanyKnowledgeKind, title: '', content: '', tags: '' })
  const [schedule, setSchedule] = useState({ title: 'Continue company workflow', intervalMinutes: '60', maxRuns: '' })
  const [feedback, setFeedback] = useState({ label: 'useful' as ReviewFeedbackLabel, agentId: '', note: '' })

  const refresh = async (): Promise<void> => {
    const [nextState, nextProjection] = await Promise.all([
      window.ndDshStrategy.state(),
      window.ndDshStrategy.projection(projectId),
    ])
    setState(nextState)
    setProjection(nextProjection)
  }

  useEffect(() => {
    let mounted = true
    void Promise.all([window.ndDshStrategy.state(), window.ndDshStrategy.projection(projectId)])
      .then(([nextState, nextProjection]) => {
        if (!mounted) return
        setState(nextState)
        setProjection(nextProjection)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const offStrategy = window.ndDshStrategy.onChanged(() => {
      void refresh().catch((cause) => onError(errorMessage(cause)))
    })
    const offControl = window.ndDshControl.onChanged(() => {
      void window.ndDshStrategy.projection(projectId)
        .then((next) => { if (mounted) setProjection(next) })
        .catch((cause) => onError(errorMessage(cause)))
    })
    return () => { mounted = false; offStrategy(); offControl() }
  }, [onError, projectId])

  const scopedAudit = useMemo(() => projection?.recentAudit ?? [], [projection])

  async function act(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(key)
    try { await fn(); await refresh() } catch (cause) { onError(errorMessage(cause)) } finally { setBusy(null) }
  }

  async function addAnchor(event: FormEvent): Promise<void> {
    event.preventDefault()
    await act('anchor-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'anchor.add', companyId, ...(projectId ? { projectId } : {}), title: anchor.title, outcome: anchor.outcome,
        priority: anchor.priority, successCriteria: lines(anchor.criteria),
      })
      setAnchor({ title: '', outcome: '', criteria: '', priority: 'high' })
    })
  }

  async function addKnowledge(event: FormEvent): Promise<void> {
    event.preventDefault()
    await act('knowledge-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'knowledge.add', companyId, ...(projectId ? { projectId } : {}), kind: knowledge.kind,
        title: knowledge.title, content: knowledge.content, tags: csv(knowledge.tags), confidence: 'authoritative', source: 'human',
      })
      setKnowledge({ kind: 'lesson', title: '', content: '', tags: '' })
    })
  }

  async function addSchedule(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!projectId) return
    await act('schedule-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'schedule.add', companyId, projectId, title: schedule.title,
        intervalMinutes: Number(schedule.intervalMinutes),
        ...(schedule.maxRuns.trim() ? { maxRuns: Number(schedule.maxRuns) } : {}),
      })
      setSchedule({ title: 'Continue company workflow', intervalMinutes: '60', maxRuns: '' })
    })
  }

  async function addFeedback(event: FormEvent): Promise<void> {
    event.preventDefault()
    await act('feedback-add', async () => {
      await window.ndDshControl.mutate({
        type: 'feedback.add', companyId, ...(projectId ? { projectId } : {}), label: feedback.label,
        ...(feedback.agentId ? { agentId: feedback.agentId } : {}), ...(feedback.note.trim() ? { note: feedback.note } : {}),
      })
      setFeedback({ label: 'useful', agentId: '', note: '' })
    })
  }

  const release = projection?.release
  return (
    <div className="grid grid-cols-1 gap-2.5 pb-8 min-[1100px]:grid-cols-2">
      <StrategyCard title="Release Readiness" badge={release?.state.replace('_', ' ') ?? 'company-wide'}>
        {release ? (
          <>
            <div className="grid grid-cols-3 gap-2 pb-2">
              <Metric label="Completed" value={`${release.completedTasks}/${release.totalTasks}`} />
              <Metric label="Verified" value={release.verifiedTasks} />
              <Metric label="Stale" value={release.staleEvidenceTasks} />
            </div>
            {release.blockers.length ? release.blockers.map((item) => <p key={item} className="m-0 border-t border-border-soft py-1.5 text-xs text-muted-foreground">{item}</p>) : (
              <p className="m-0 rounded-md border border-primary/20 bg-primary/[0.06] p-2 text-xs text-primary">All current tasks satisfy the release-readiness projection. External publish/deploy policy still applies.</p>
            )}
          </>
        ) : <Empty text="Select a project to calculate task and evidence readiness." />}
      </StrategyCard>

      <StrategyCard title="Strategic Anchors" badge={String(projection?.metrics.activeAnchors ?? 0)}>
        <form className="grid gap-2" onSubmit={(event) => void addAnchor(event)}>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <input className={input} placeholder="High-value proof path" value={anchor.title} onChange={(event) => setAnchor((current) => ({ ...current, title: event.target.value }))} required />
            <select className={input} value={anchor.priority} onChange={(event) => setAnchor((current) => ({ ...current, priority: event.target.value as StrategicAnchorPriority }))}>
              <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
          <textarea className={cn(input, 'min-h-[58px] resize-y')} placeholder="What outcome proves this matters?" value={anchor.outcome} onChange={(event) => setAnchor((current) => ({ ...current, outcome: event.target.value }))} required />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input className={input} placeholder="Success criteria, one per line" value={anchor.criteria} onChange={(event) => setAnchor((current) => ({ ...current, criteria: event.target.value }))} />
            <button className={primaryButton} disabled={busy !== null}>Add anchor</button>
          </div>
        </form>
        {(projection?.activeAnchors ?? []).slice(0, 6).map((item) => (
          <div key={item.id} className="border-t border-border-soft py-2">
            <div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.title}</strong><span className="text-[10px] uppercase text-primary">{item.priority}</span></div>
            <p className="m-0 mt-0.5 text-xs text-muted-foreground">{item.outcome}</p>
            <button className={cn(button, 'mt-1.5')} disabled={busy !== null} onClick={() => void act(`anchor-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'anchor.update', id: item.id, patch: { status: 'achieved' } }))}>Mark achieved</button>
          </div>
        ))}
      </StrategyCard>

      <StrategyCard title="Company Brain" badge={`${projection?.metrics.activeKnowledge ?? 0} active`} wide>
        <form className="mb-2 grid gap-2 min-[900px]:grid-cols-[140px_1fr_2fr_1fr_auto]" onSubmit={(event) => void addKnowledge(event)}>
          <select className={input} value={knowledge.kind} onChange={(event) => setKnowledge((current) => ({ ...current, kind: event.target.value as CompanyKnowledgeKind }))}>
            {['lesson', 'decision', 'architecture', 'product', 'design', 'incident', 'feedback'].map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <input className={input} placeholder="Knowledge title" value={knowledge.title} onChange={(event) => setKnowledge((current) => ({ ...current, title: event.target.value }))} required />
          <input className={input} placeholder="Durable truth / operating lesson" value={knowledge.content} onChange={(event) => setKnowledge((current) => ({ ...current, content: event.target.value }))} required />
          <input className={input} placeholder="tags, comma-separated" value={knowledge.tags} onChange={(event) => setKnowledge((current) => ({ ...current, tags: event.target.value }))} />
          <button className={primaryButton} disabled={busy !== null}>Remember</button>
        </form>
        <div className="grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
          {(projection?.activeKnowledge ?? []).slice(0, 10).map((item) => (
            <div key={item.id} className="rounded-md border border-border-soft bg-surface-0 p-2.5">
              <div className="flex items-center gap-1.5"><span className="text-[10px] font-bold uppercase text-primary">{item.kind}</span><strong className="text-sm">{item.title}</strong></div>
              <p className="m-0 mt-1 text-xs/[1.45] text-muted-foreground">{item.content}</p>
              <small className="mt-1 block text-faint">{item.confidence} · {item.source}{item.tags.length ? ` · ${item.tags.join(', ')}` : ''}</small>
            </div>
          ))}
        </div>
      </StrategyCard>

      <StrategyCard title="Scheduled Company Work" badge={`${projection?.metrics.activeSchedules ?? 0} active`}>
        {projectId ? (
          <form className="grid gap-2" onSubmit={(event) => void addSchedule(event)}>
            <input className={input} placeholder="Schedule name" value={schedule.title} onChange={(event) => setSchedule((current) => ({ ...current, title: event.target.value }))} required />
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className={input} type="number" min="1" step="1" aria-label="Interval minutes" value={schedule.intervalMinutes} onChange={(event) => setSchedule((current) => ({ ...current, intervalMinutes: event.target.value }))} required />
              <input className={input} type="number" min="1" step="1" placeholder="Max runs (optional)" value={schedule.maxRuns} onChange={(event) => setSchedule((current) => ({ ...current, maxRuns: event.target.value }))} />
              <button className={primaryButton} disabled={busy !== null}>Schedule</button>
            </div>
          </form>
        ) : <Empty text="Select a project before scheduling recurring company work." />}
        {(projection?.schedules ?? []).slice(0, 8).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-t border-border-soft py-2 text-xs">
            <div><strong className="block text-sm">{item.title}</strong><span className="text-faint">every {item.intervalMinutes}m · {item.runCount} runs · next {new Date(item.nextRunAt).toLocaleString()}</span>{item.lastDetail ? <span className="block text-muted-foreground">{item.lastDetail}</span> : null}</div>
            <button className={button} disabled={busy !== null || item.status === 'completed'} onClick={() => void act(`schedule-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'schedule.update', id: item.id, patch: { status: item.status === 'active' ? 'paused' : 'active' } }))}>{item.status === 'active' ? 'Pause' : item.status === 'paused' ? 'Resume' : 'Done'}</button>
          </div>
        ))}
      </StrategyCard>

      <StrategyCard title="Human Review Feed">
        <form className="grid gap-2" onSubmit={(event) => void addFeedback(event)}>
          <div className="grid grid-cols-2 gap-2">
            <select className={input} value={feedback.label} onChange={(event) => setFeedback((current) => ({ ...current, label: event.target.value as ReviewFeedbackLabel }))}>
              {['useful', 'not_useful', 'needs_evidence', 'off_scope', 'too_expensive', 'unsafe'].map((label) => <option key={label} value={label}>{label.replace('_', ' ')}</option>)}
            </select>
            <select className={input} value={feedback.agentId} onChange={(event) => setFeedback((current) => ({ ...current, agentId: event.target.value }))}>
              <option value="">Company-wide</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </div>
          <textarea className={cn(input, 'min-h-[62px] resize-y')} placeholder="What should the company learn from this review?" value={feedback.note} onChange={(event) => setFeedback((current) => ({ ...current, note: event.target.value }))} />
          <button className={primaryButton} disabled={busy !== null}>Record review signal</button>
        </form>
      </StrategyCard>

      <StrategyCard title="Action Audit" badge={String(projection?.metrics.auditReceipts ?? 0)} wide>
        {scopedAudit.length ? scopedAudit.slice(0, 12).map((item) => (
          <div key={item.id} className="grid grid-cols-[110px_1fr_100px] gap-2 border-t border-border-soft py-2 text-xs first:border-t-0">
            <span className={cn('font-bold uppercase', item.decision === 'allow' ? 'text-primary' : item.decision === 'deny' ? 'text-destructive' : 'text-warning')}>{item.decision}</span>
            <div><strong className="text-foreground">{item.action}</strong><span className="ml-2 text-faint">{item.target}</span><p className="m-0 mt-0.5 text-muted-foreground">{item.reason}{item.result ? ` · ${item.result}` : ''}</p></div>
            <span className="text-right text-faint">{item.risk}<br />{item.externality}</span>
          </div>
        )) : <Empty text="Normalized receipts appear when governed scheduled or external actions are evaluated." />}
      </StrategyCard>

      {state ? <span className="sr-only">Strategy state loaded with {state.anchors.length} anchors.</span> : null}
    </div>
  )
}

function StrategyCard({ title, badge, wide, children }: { title: string; badge?: string; wide?: boolean; children: ReactNode }) {
  return <UiCard className={cn('min-w-0 rounded-lg border-border-soft bg-card p-3 shadow-none', wide && 'min-[1100px]:col-span-2')}><div className="mb-2 flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-semibold">{title}</h3>{badge ? <span className="rounded-full border border-border-soft bg-secondary px-2 py-0.5 text-[10px] text-faint">{badge}</span> : null}</div>{children}</UiCard>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md border border-border-soft bg-surface-0 p-2"><strong className="block text-base">{value}</strong><span className="text-[10px] uppercase text-faint">{label}</span></div>
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 rounded-md border border-dashed border-border-strong p-3 text-center text-xs text-faint">{text}</p>
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function csv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
