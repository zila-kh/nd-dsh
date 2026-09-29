import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type {
  CompanyKnowledgeKind,
  CompanyScheduleMode,
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
  const [schedule, setSchedule] = useState({
    title: 'Continue company workflow',
    mode: 'interval' as CompanyScheduleMode,
    intervalMinutes: '60',
    cron: '0 8 * * *',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    runAt: '',
    maxRuns: '',
    agentId: '',
    prompt: '',
    skillIds: '',
  })
  const [heartbeat, setHeartbeat] = useState({ title: 'Project heartbeat', intervalMinutes: '30' })
  const [trigger, setTrigger] = useState({ title: 'Follow up blocked work', eventType: 'task.blocked', action: 'task' as 'task' | 'signal', prompt: 'Investigate the source event and propose the safest next action.', agentId: '', maxRuns: '' })
  const [skillCandidate, setSkillCandidate] = useState({ name: '', description: '', instructions: '', evidence: '', sourceAgentId: '' })
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof window.ndDshLocalRuntime.state>> | null>(null)
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
    void Promise.all([window.ndDshStrategy.state(), window.ndDshStrategy.projection(projectId), window.ndDshLocalRuntime.state()])
      .then(([nextState, nextProjection, runtimeState]) => {
        if (!mounted) return
        setState(nextState)
        setProjection(nextProjection)
        setRuntime(runtimeState)
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
    const offRuntime = window.ndDshLocalRuntime.onChanged((next) => { if (mounted) setRuntime(next) })
    return () => { mounted = false; offStrategy(); offControl(); offRuntime() }
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
      const mode = schedule.mode
      await window.ndDshStrategy.mutate({
        type: 'schedule.add',
        companyId,
        projectId,
        title: schedule.title,
        mode,
        ...(mode === 'interval' || mode === 'routine' ? { intervalMinutes: Number(schedule.intervalMinutes) } : {}),
        ...(mode === 'cron' ? { cron: schedule.cron, timezone: schedule.timezone } : {}),
        ...(mode === 'once' ? { runAt: new Date(schedule.runAt).getTime() } : {}),
        ...(mode === 'routine' && schedule.agentId ? { agentId: schedule.agentId, prompt: schedule.prompt, skillIds: csv(schedule.skillIds) } : {}),
        ...(schedule.maxRuns.trim() ? { maxRuns: Number(schedule.maxRuns) } : {}),
      })
      setSchedule({
        title: 'Continue company workflow',
        mode: 'interval',
        intervalMinutes: '60',
        cron: '0 8 * * *',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        runAt: '',
        maxRuns: '',
        agentId: '',
        prompt: '',
        skillIds: '',
      })
    })
  }

  async function addHeartbeat(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!projectId) return
    await act('heartbeat-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'heartbeat.add', companyId, projectId, title: heartbeat.title,
        intervalMinutes: Number(heartbeat.intervalMinutes),
      })
      setHeartbeat({ title: 'Project heartbeat', intervalMinutes: '30' })
    })
  }

  async function addTrigger(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!projectId) return
    await act('trigger-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'trigger.add', companyId, projectId, title: trigger.title,
        eventType: trigger.eventType, action: trigger.action, prompt: trigger.prompt,
        ...(trigger.agentId ? { agentId: trigger.agentId } : {}),
        ...(trigger.maxRuns.trim() ? { maxRuns: Number(trigger.maxRuns) } : {}),
      })
      setTrigger({ title: 'Follow up blocked work', eventType: 'task.blocked', action: 'task', prompt: 'Investigate the source event and propose the safest next action.', agentId: '', maxRuns: '' })
    })
  }

  async function addSkillCandidate(event: FormEvent): Promise<void> {
    event.preventDefault()
    await act('skill-candidate-add', async () => {
      await window.ndDshStrategy.mutate({
        type: 'skill-candidate.add', companyId, ...(projectId ? { projectId } : {}),
        name: skillCandidate.name, description: skillCandidate.description, instructions: skillCandidate.instructions,
        evidence: lines(skillCandidate.evidence),
        ...(skillCandidate.sourceAgentId ? { sourceAgentId: skillCandidate.sourceAgentId } : {}),
      })
      setSkillCandidate({ name: '', description: '', instructions: '', evidence: '', sourceAgentId: '' })
    })
  }

  async function updateRuntime(patch: { alwaysOn?: boolean; startAtLogin?: boolean }): Promise<void> {
    await act('runtime-update', async () => { setRuntime(await window.ndDshLocalRuntime.update(patch)) })
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

      <StrategyCard title="Always-On Local Runtime" badge={runtime?.settings.alwaysOn ? '24/7 enabled' : 'foreground only'}>
        <p className="m-0 text-xs/[1.45] text-muted-foreground">
          Keep the local scheduler, agents and control plane alive when the ND window is closed. This is local-only; it does not require ND Cloud.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={runtime?.settings.alwaysOn ? primaryButton : button} disabled={busy !== null} onClick={() => void updateRuntime({ alwaysOn: !runtime?.settings.alwaysOn })}>
            {runtime?.settings.alwaysOn ? 'Always-On enabled' : 'Enable Always-On'}
          </button>
          <button
            className={runtime?.settings.startAtLogin ? primaryButton : button}
            disabled={busy !== null || !runtime?.settings.alwaysOn || !runtime?.startAtLoginSupported}
            title={runtime?.startAtLoginSupported ? 'Start ND in the background when you sign in to this computer.' : 'Start-at-login is currently exposed for packaged Windows/macOS builds.'}
            onClick={() => void updateRuntime({ startAtLogin: !runtime?.settings.startAtLogin })}
          >
            {runtime?.settings.startAtLogin ? 'Starts at login' : 'Start at login'}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Metric label="Scheduler" value={runtime?.lastSchedulerTickAt ? ago(runtime.lastSchedulerTickAt) : '—'} />
          <Metric label="Heartbeat" value={runtime?.lastHeartbeatTickAt ? ago(runtime.lastHeartbeatTickAt) : '—'} />
          <Metric label="Events" value={runtime?.lastEventTickAt ? ago(runtime.lastEventTickAt) : '—'} />
        </div>
        <p className="m-0 mt-2 text-[10px] text-faint">
          Closing the window backgrounds ND when Always-On is enabled. Use the global launcher shortcut or launch ND again to bring the same local runtime forward.
        </p>
      </StrategyCard>

      <StrategyCard title="Automation & Agent Routines" badge={`${projection?.metrics.activeSchedules ?? 0} active`}>
        {projectId ? (
          <form className="grid gap-2" onSubmit={(event) => void addSchedule(event)}>
            <div className="grid grid-cols-[1fr_130px] gap-2">
              <input className={input} placeholder="Automation name" value={schedule.title} onChange={(event) => setSchedule((current) => ({ ...current, title: event.target.value }))} required />
              <select className={input} value={schedule.mode} onChange={(event) => setSchedule((current) => ({ ...current, mode: event.target.value as CompanyScheduleMode }))}>
                <option value="interval">Interval</option>
                <option value="once">One time</option>
                <option value="cron">Cron</option>
                <option value="routine">Agent routine</option>
              </select>
            </div>
            {schedule.mode === 'interval' || schedule.mode === 'routine' ? (
              <input className={input} type="number" min="1" step="1" placeholder="Interval minutes" value={schedule.intervalMinutes} onChange={(event) => setSchedule((current) => ({ ...current, intervalMinutes: event.target.value }))} required />
            ) : null}
            {schedule.mode === 'once' ? (
              <input className={input} type="datetime-local" value={schedule.runAt} onChange={(event) => setSchedule((current) => ({ ...current, runAt: event.target.value }))} required />
            ) : null}
            {schedule.mode === 'cron' ? (
              <div className="grid grid-cols-[1fr_180px] gap-2">
                <input className={input} placeholder="0 8 * * *" value={schedule.cron} onChange={(event) => setSchedule((current) => ({ ...current, cron: event.target.value }))} required />
                <input className={input} placeholder="Asia/Phnom_Penh" value={schedule.timezone} onChange={(event) => setSchedule((current) => ({ ...current, timezone: event.target.value }))} required />
              </div>
            ) : null}
            {schedule.mode === 'routine' ? (
              <>
                <select className={input} value={schedule.agentId} onChange={(event) => setSchedule((current) => ({ ...current, agentId: event.target.value }))} required>
                  <option value="">Choose agent…</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
                <textarea className={cn(input, 'min-h-[58px] resize-y')} placeholder="Routine objective / prompt" value={schedule.prompt} onChange={(event) => setSchedule((current) => ({ ...current, prompt: event.target.value }))} required />
                <input className={input} placeholder="Preferred skill ids, comma-separated (optional)" value={schedule.skillIds} onChange={(event) => setSchedule((current) => ({ ...current, skillIds: event.target.value }))} />
              </>
            ) : null}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={input} type="number" min="1" step="1" placeholder="Max runs (optional)" value={schedule.maxRuns} onChange={(event) => setSchedule((current) => ({ ...current, maxRuns: event.target.value }))} />
              <button className={primaryButton} disabled={busy !== null}>Create automation</button>
            </div>
          </form>
        ) : <Empty text="Select a project before creating local automation." />}
        {(projection?.schedules ?? []).slice(0, 8).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-t border-border-soft py-2 text-xs">
            <div>
              <strong className="block text-sm">{item.title}</strong>
              <span className="text-faint">{scheduleLabel(item)} · {item.runCount} runs · next {item.status === 'completed' ? 'done' : new Date(item.nextRunAt).toLocaleString()}</span>
              {item.agentId ? <span className="block text-primary">routine agent · {agents.find((agent) => agent.id === item.agentId)?.name ?? item.agentId}</span> : null}
              {item.lastDetail ? <span className="block text-muted-foreground">{item.lastDetail}</span> : null}
            </div>
            <button className={button} disabled={busy !== null || item.status === 'completed'} onClick={() => void act(`schedule-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'schedule.update', id: item.id, patch: { status: item.status === 'active' ? 'paused' : 'active' } }))}>{item.status === 'active' ? 'Pause' : item.status === 'paused' ? 'Resume' : 'Done'}</button>
          </div>
        ))}
      </StrategyCard>

      <StrategyCard title="Heartbeat / Ambient Awareness" badge={`${projection?.metrics.activeHeartbeats ?? 0} active`}>
        {projectId ? (
          <form className="grid grid-cols-[1fr_120px_auto] gap-2" onSubmit={(event) => void addHeartbeat(event)}>
            <input className={input} placeholder="Project heartbeat" value={heartbeat.title} onChange={(event) => setHeartbeat((current) => ({ ...current, title: event.target.value }))} required />
            <input className={input} type="number" min="1" step="1" aria-label="Heartbeat minutes" value={heartbeat.intervalMinutes} onChange={(event) => setHeartbeat((current) => ({ ...current, intervalMinutes: event.target.value }))} required />
            <button className={primaryButton} disabled={busy !== null}>Add</button>
          </form>
        ) : <Empty text="Select a project before adding a heartbeat." />}
        <p className="m-0 mt-1 text-[10px] text-faint">Heartbeat is cheap deterministic awareness: blocked tasks, failed runs, pending approvals and human actions. It does not blindly run a full model every tick.</p>
        {(projection?.heartbeats ?? []).slice(0, 6).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-t border-border-soft py-2 text-xs">
            <div><strong className="block text-sm">{item.title}</strong><span className="text-faint">every {item.intervalMinutes}m · next {new Date(item.nextRunAt).toLocaleString()}</span>{item.lastDetail ? <span className="block text-muted-foreground">{item.lastDetail}</span> : null}</div>
            <button className={button} disabled={busy !== null} onClick={() => void act(`heartbeat-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'heartbeat.update', id: item.id, patch: { status: item.status === 'active' ? 'paused' : 'active' } }))}>{item.status === 'active' ? 'Pause' : 'Resume'}</button>
          </div>
        ))}
      </StrategyCard>

      <StrategyCard title="Event Triggers" badge={`${projection?.metrics.activeTriggers ?? 0} active`}>
        {projectId ? (
          <form className="grid gap-2" onSubmit={(event) => void addTrigger(event)}>
            <div className="grid grid-cols-[1fr_160px] gap-2">
              <input className={input} placeholder="Trigger name" value={trigger.title} onChange={(event) => setTrigger((current) => ({ ...current, title: event.target.value }))} required />
              <select className={input} value={trigger.action} onChange={(event) => setTrigger((current) => ({ ...current, action: event.target.value as 'task' | 'signal' }))}><option value="task">Create task</option><option value="signal">Create signal</option></select>
            </div>
            <input className={input} list="nd-event-types" placeholder="task.blocked" value={trigger.eventType} onChange={(event) => setTrigger((current) => ({ ...current, eventType: event.target.value }))} required />
            <datalist id="nd-event-types">
              {['task.blocked', 'task.review-ready', 'task.completed', 'task.integrated', 'run.interrupted', 'approval.requested', 'approval.changes_requested', 'collaboration.message'].map((value) => <option key={value} value={value} />)}
            </datalist>
            <textarea className={cn(input, 'min-h-[58px] resize-y')} placeholder="What should ND do when this event happens?" value={trigger.prompt} onChange={(event) => setTrigger((current) => ({ ...current, prompt: event.target.value }))} required />
            <div className="grid grid-cols-[1fr_110px_auto] gap-2">
              <select className={input} value={trigger.agentId} onChange={(event) => setTrigger((current) => ({ ...current, agentId: event.target.value }))}><option value="">Auto-assign</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
              <input className={input} type="number" min="1" step="1" placeholder="Max runs" value={trigger.maxRuns} onChange={(event) => setTrigger((current) => ({ ...current, maxRuns: event.target.value }))} />
              <button className={primaryButton} disabled={busy !== null}>Add trigger</button>
            </div>
          </form>
        ) : <Empty text="Select a project before adding event-driven automation." />}
        {(projection?.triggers ?? []).slice(0, 6).map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 border-t border-border-soft py-2 text-xs">
            <div><strong className="block text-sm">{item.title}</strong><span className="text-faint">{item.eventType} → {item.action} · {item.runCount} fires</span></div>
            <button className={button} disabled={busy !== null || item.status === 'completed'} onClick={() => void act(`trigger-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'trigger.update', id: item.id, patch: { status: item.status === 'active' ? 'paused' : 'active' } }))}>{item.status === 'active' ? 'Pause' : item.status === 'paused' ? 'Resume' : 'Done'}</button>
          </div>
        ))}
      </StrategyCard>

      <StrategyCard title="Skill Learning Candidates" badge={`${projection?.metrics.proposedSkills ?? 0} proposed`} wide>
        <form className="grid gap-2 min-[1000px]:grid-cols-[180px_1fr_1.5fr]" onSubmit={(event) => void addSkillCandidate(event)}>
          <div className="grid gap-2">
            <input className={input} placeholder="Skill name" value={skillCandidate.name} onChange={(event) => setSkillCandidate((current) => ({ ...current, name: event.target.value }))} required />
            <select className={input} value={skillCandidate.sourceAgentId} onChange={(event) => setSkillCandidate((current) => ({ ...current, sourceAgentId: event.target.value }))}><option value="">Human proposed</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          </div>
          <textarea className={cn(input, 'min-h-[82px] resize-y')} placeholder="What reusable capability was learned?" value={skillCandidate.description} onChange={(event) => setSkillCandidate((current) => ({ ...current, description: event.target.value }))} required />
          <div className="grid gap-2">
            <textarea className={cn(input, 'min-h-[52px] resize-y')} placeholder="Reusable instructions" value={skillCandidate.instructions} onChange={(event) => setSkillCandidate((current) => ({ ...current, instructions: event.target.value }))} required />
            <div className="grid grid-cols-[1fr_auto] gap-2"><input className={input} placeholder="Evidence, one item per line" value={skillCandidate.evidence} onChange={(event) => setSkillCandidate((current) => ({ ...current, evidence: event.target.value }))} /><button className={primaryButton} disabled={busy !== null}>Propose</button></div>
          </div>
        </form>
        <p className="m-0 mt-2 text-[10px] text-faint">Agents can propose learned reusable behavior, but promotion is explicit. A candidate cannot grant itself permissions, rewrite policy, or silently replace an active skill.</p>
        <div className="mt-2 grid grid-cols-1 gap-2 min-[900px]:grid-cols-2">
          {(projection?.skillCandidates ?? []).slice(0, 10).map((item) => (
            <div key={item.id} className="rounded-md border border-border-soft bg-surface-0 p-2.5">
              <div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.name}</strong><span className="text-[10px] uppercase text-faint">{item.status}</span></div>
              <p className="m-0 mt-1 text-xs text-muted-foreground">{item.description}</p>
              {item.evidence.length ? <small className="mt-1 block text-faint">{item.evidence.join(' · ')}</small> : null}
              {item.status === 'proposed' ? <div className="mt-2 flex gap-1.5"><button className={primaryButton} disabled={busy !== null} onClick={() => void act(`skill-promote-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'skill-candidate.promote', id: item.id }))}>Promote skill</button><button className={button} disabled={busy !== null} onClick={() => void act(`skill-reject-${item.id}`, () => window.ndDshStrategy.mutate({ type: 'skill-candidate.update', id: item.id, patch: { status: 'rejected' } }))}>Reject</button></div> : null}
            </div>
          ))}
        </div>
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

function scheduleLabel(item: OrganizationStrategyProjection['schedules'][number]): string {
  const mode = item.mode ?? 'interval'
  if (mode === 'once') return `once · ${new Date(item.runAt ?? item.nextRunAt).toLocaleString()}`
  if (mode === 'cron') return `cron ${item.cron ?? ''} · ${item.timezone ?? 'UTC'}`
  if (mode === 'routine') return `agent routine every ${item.intervalMinutes ?? 60}m`
  return `every ${item.intervalMinutes ?? 60}m`
}

function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`
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
