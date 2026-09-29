import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type {
  OrganizationApprovalVerdictKind,
  OrganizationMember,
  OrganizationSnapshot,
  OrganizationTask,
} from '../../../shared/organization'
import { cn } from '../lib/utils'
import { Card as UiCard } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface Props {
  companyId: string
  projectId?: string
  onAskAgent?(prompt: string): void
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

export function OrganizationCollaborationCenter({ companyId, projectId, onAskAgent, onError }: Props) {
  const [state, setState] = useState<OrganizationSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [activeMemberId, setActiveMemberId] = useState('')
  const [memberDraft, setMemberDraft] = useState({ displayName: '', title: '' })
  const [messageDraft, setMessageDraft] = useState({ body: '', taskId: '' })
  const [decisionDraft, setDecisionDraft] = useState({ title: '', summary: '', rationale: '', taskId: '' })
  const [approvalTaskId, setApprovalTaskId] = useState('')

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state()
      .then((next) => {
        if (!mounted) return
        setState(next)
        const first = (next.members ?? []).find((item) => item.companyId === companyId && item.status === 'active')
        if (first) setActiveMemberId((current) => current || first.id)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const off = window.ndDshOrganization.onChanged((next) => {
      if (!mounted) return
      setState(next)
      const activeStillExists = (next.members ?? []).some((item) => item.id === activeMemberId && item.status === 'active')
      if (!activeStillExists) setActiveMemberId((next.members ?? []).find((item) => item.companyId === companyId && item.status === 'active')?.id ?? '')
    })
    return () => { mounted = false; off() }
  }, [activeMemberId, companyId, onError])

  const project = state?.projects.find((item) => item.id === projectId && item.companyId === companyId)
  const members = useMemo(() => (state?.members ?? []).filter((item) => item.companyId === companyId), [state, companyId])
  const agents = useMemo(() => state?.agents.filter((item) => item.companyId === companyId) ?? [], [state, companyId])
  const tasks = useMemo(() => state?.tasks.filter((item) => item.projectId === projectId) ?? [], [state, projectId])
  const messages = useMemo(() => (state?.messages ?? []).filter((item) => item.projectId === projectId).slice().sort((a, b) => a.createdAt - b.createdAt), [state, projectId])
  const decisions = useMemo(() => (state?.decisions ?? []).filter((item) => item.projectId === projectId).slice().sort((a, b) => b.createdAt - a.createdAt), [state, projectId])
  const approvals = useMemo(() => (state?.approvalRequests ?? []).filter((item) => item.projectId === projectId).slice().sort((a, b) => b.createdAt - a.createdAt), [state, projectId])
  const activeMember = members.find((item) => item.id === activeMemberId && item.status === 'active')
  const mentioned = messages.filter((item) => activeMemberId && item.mentionActorIds.includes(activeMemberId))
  const needsYou = approvals.filter((item) => item.status === 'pending').length + mentioned.length

  async function act(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (cause) { onError(errorMessage(cause)) } finally { setBusy(null) }
  }

  async function addMember(event: FormEvent): Promise<void> {
    event.preventDefault()
    await act('member-add', async () => {
      const next = await window.ndDshOrganization.mutate({
        type: 'member.create', companyId, displayName: memberDraft.displayName,
        ...(memberDraft.title.trim() ? { title: memberDraft.title } : {}),
      })
      const created = next.members.find((item) => item.companyId === companyId && item.displayName === memberDraft.displayName.trim())
      if (created) setActiveMemberId(created.id)
      setMemberDraft({ displayName: '', title: '' })
    })
  }

  async function postMessage(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!project || !activeMember) return
    const mentionActorIds = resolveMentions(messageDraft.body, members, agents)
    await act('message-add', async () => {
      await window.ndDshOrganization.mutate({
        type: 'collaboration.message.add',
        companyId,
        projectId: project.id,
        authorMemberId: activeMember.id,
        body: messageDraft.body,
        ...(messageDraft.taskId ? { taskId: messageDraft.taskId, kind: 'task' as const } : {}),
        ...(mentionActorIds.length ? { mentionActorIds } : {}),
      })
      setMessageDraft({ body: '', taskId: messageDraft.taskId })
    })
  }

  async function addDecision(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!project || !activeMember) return
    await act('decision-add', async () => {
      await window.ndDshOrganization.mutate({
        type: 'decision.create',
        companyId,
        projectId: project.id,
        authorMemberId: activeMember.id,
        title: decisionDraft.title,
        summary: decisionDraft.summary,
        rationale: decisionDraft.rationale,
        ...(decisionDraft.taskId ? { taskId: decisionDraft.taskId } : {}),
      })
      setDecisionDraft({ title: '', summary: '', rationale: '', taskId: '' })
    })
  }

  async function requestApproval(): Promise<void> {
    if (!project || !activeMember || !approvalTaskId) return
    const task = tasks.find((item) => item.id === approvalTaskId)
    if (!task) return
    await act('approval-request', () => window.ndDshOrganization.mutate({
      type: 'approval.request',
      companyId,
      projectId: project.id,
      requesterMemberId: activeMember.id,
      taskId: task.id,
      targetKind: 'integration',
      targetId: task.id,
    }))
  }

  async function resolveApproval(id: string, verdict: OrganizationApprovalVerdictKind): Promise<void> {
    if (!activeMember) return
    await act(`approval-${id}-${verdict}`, () => window.ndDshOrganization.mutate({
      type: 'approval.resolve',
      id,
      actorMemberId: activeMember.id,
      verdict,
    }))
  }

  if (!projectId || !project) {
    return <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">Select a project to open team chat, decisions and approvals.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 pb-8 min-[1180px]:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)]">
      <div className="grid min-w-0 gap-2.5">
        <CollabCard title="Project Chat" badge={`${messages.length} messages`}>
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border-soft bg-surface-0 p-2">
            <span className="text-xs text-faint">Acting locally as</span>
            <Select value={activeMemberId} onValueChange={setActiveMemberId}>
              <SelectTrigger className="h-8 w-[190px] border-border-strong bg-background"><SelectValue placeholder="Choose member" /></SelectTrigger>
              <SelectContent>{members.filter((item) => item.status === 'active').map((member) => <SelectItem key={member.id} value={member.id}>{member.displayName}</SelectItem>)}</SelectContent>
            </Select>
            <span className="text-[10px] text-faint">Local profile = attribution, not authentication.</span>
          </div>

          <div className="max-h-[330px] overflow-auto rounded-md border border-border-soft bg-surface-0 p-2">
            {messages.length ? messages.map((message) => {
              const author = actorName(message.author.id, members, agents)
              const task = message.taskId ? tasks.find((item) => item.id === message.taskId) : undefined
              return (
                <div key={message.id} className="border-b border-border-soft py-2 last:border-b-0">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <strong className="text-foreground">{author}</strong>
                    {task ? <span className="rounded border border-border-soft bg-secondary px-1.5 py-0.5 text-faint">{task.title}</span> : <span className="text-faint">project</span>}
                    <span className="ml-auto text-faint">{new Date(message.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="m-0 mt-1 whitespace-pre-wrap text-sm/[1.45] text-muted-foreground">{message.body}</p>
                </div>
              )
            }) : <Empty text="Start the project conversation. Team chat is durable project context, not an agent execution transcript." />}
          </div>

          <form className="mt-2 grid gap-2" onSubmit={(event) => void postMessage(event)}>
            <div className="grid grid-cols-[180px_1fr] gap-2">
              <select className={input} value={messageDraft.taskId} onChange={(event) => setMessageDraft((current) => ({ ...current, taskId: event.target.value }))}>
                <option value="">Project chat</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>Task · {task.title}</option>)}
              </select>
              <input className={input} placeholder="Use @Member or @Agent names to mention…" value={messageDraft.body} onChange={(event) => setMessageDraft((current) => ({ ...current, body: event.target.value }))} required />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-faint">Chat, reactions and “looks good” never grant approval.</span>
              <button className={primaryButton} disabled={busy !== null || !activeMember}>Post</button>
            </div>
          </form>
        </CollabCard>

        <CollabCard title="Decisions" badge={`${decisions.filter((item) => item.status === 'active').length} active`}>
          <form className="grid gap-2" onSubmit={(event) => void addDecision(event)}>
            <div className="grid grid-cols-[1fr_180px] gap-2">
              <input className={input} placeholder="Decision title" value={decisionDraft.title} onChange={(event) => setDecisionDraft((current) => ({ ...current, title: event.target.value }))} required />
              <select className={input} value={decisionDraft.taskId} onChange={(event) => setDecisionDraft((current) => ({ ...current, taskId: event.target.value }))}>
                <option value="">Project-wide</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
              </select>
            </div>
            <input className={input} placeholder="Decision summary" value={decisionDraft.summary} onChange={(event) => setDecisionDraft((current) => ({ ...current, summary: event.target.value }))} required />
            <textarea className={cn(input, 'min-h-[64px] resize-y')} placeholder="Rationale / constraints" value={decisionDraft.rationale} onChange={(event) => setDecisionDraft((current) => ({ ...current, rationale: event.target.value }))} required />
            <button className={primaryButton} disabled={busy !== null || !activeMember}>Record durable decision</button>
          </form>
          <div className="mt-2 grid gap-2">
            {decisions.slice(0, 8).map((item) => <div key={item.id} className="rounded-md border border-border-soft bg-surface-0 p-2"><div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.title}</strong><span className="text-[10px] uppercase text-faint">{item.status}</span></div><p className="m-0 mt-1 text-xs text-muted-foreground">{item.summary}</p><small className="mt-1 block text-faint">{item.rationale}</small></div>)}
            {!decisions.length ? <Empty text="Important product and architecture choices belong here instead of disappearing inside chat." /> : null}
          </div>
        </CollabCard>
      </div>

      <div className="grid content-start gap-2.5">
        <CollabCard title="Needs You" badge={String(needsYou)}>
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Pending approvals" value={approvals.filter((item) => item.status === 'pending').length} />
            <Metric label="Mentions" value={mentioned.length} />
          </div>
          <p className="m-0 mt-2 text-[11px] text-faint">This first local projection is profile-scoped. It will later join Control Center gates, blockers and scheduled-agent questions.</p>
        </CollabCard>

        <CollabCard title="Explicit Approval">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select className={input} value={approvalTaskId} onChange={(event) => setApprovalTaskId(event.target.value)}>
              <option value="">Choose checkpointed task…</option>
              {tasks.filter((task) => latestCheckpoint(task, state)).map((task) => <option key={task.id} value={task.id}>{task.title} · {latestCheckpoint(task, state)}</option>)}
            </select>
            <button className={primaryButton} disabled={busy !== null || !approvalTaskId || !activeMember} onClick={() => void requestApproval()}>Request</button>
          </div>
          <p className="m-0 mt-1 text-[10px] text-faint">Requests bind to the task's exact current checkpoint. A changed checkpoint makes the approval stale.</p>

          <div className="mt-2 grid gap-2">
            {approvals.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-md border border-border-soft bg-surface-0 p-2">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs">{taskName(item.taskId, tasks)} · {item.targetKind}</strong>
                  <span className={cn('text-[10px] font-bold uppercase', item.status === 'approved' ? 'text-primary' : item.status === 'pending' ? 'text-warning' : 'text-destructive')}>{item.status.replace('_', ' ')}</span>
                </div>
                {item.targetRevision ? <p className="m-0 mt-1 font-mono text-[10px] text-faint">checkpoint {item.targetRevision}</p> : null}
                {item.status === 'pending' ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button className={primaryButton} disabled={busy !== null || !activeMember} onClick={() => void resolveApproval(item.id, 'approve')}>Approve</button>
                    <button className={button} disabled={busy !== null || !activeMember} onClick={() => void resolveApproval(item.id, 'request_changes')}>Request changes</button>
                    <button className={cn(button, 'border-destructive/30 text-destructive')} disabled={busy !== null || !activeMember} onClick={() => void resolveApproval(item.id, 'reject')}>Reject</button>
                  </div>
                ) : null}
              </div>
            ))}
            {!approvals.length ? <Empty text="Checkpoint-bound human approvals appear here. Friendly chat never creates one." /> : null}
          </div>
        </CollabCard>

        <CollabCard title="Local Human Members" badge={String(members.filter((item) => item.status === 'active').length)}>
          <form className="grid gap-2" onSubmit={(event) => void addMember(event)}>
            <input className={input} placeholder="Display name" value={memberDraft.displayName} onChange={(event) => setMemberDraft((current) => ({ ...current, displayName: event.target.value }))} required />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className={input} placeholder="Role / title (optional)" value={memberDraft.title} onChange={(event) => setMemberDraft((current) => ({ ...current, title: event.target.value }))} />
              <button className={primaryButton} disabled={busy !== null}>Add member</button>
            </div>
          </form>
          <div className="mt-2 grid gap-1.5">
            {members.map((member) => <MemberLine key={member.id} member={member} active={member.id === activeMemberId} onSelect={() => setActiveMemberId(member.id)} />)}
          </div>
        </CollabCard>

        <CollabCard title="Agent Handoff">
          <p className="m-0 text-xs/[1.45] text-muted-foreground">Collaboration chat stays durable and human-readable. Agent sessions remain execution transcripts with tools, subagents, files and browser actions.</p>
          {onAskAgent ? <button className={cn(primaryButton, 'mt-2')} onClick={() => onAskAgent(`Continue work for ${project.name}. Read the active project tasks, durable decisions and approval requirements before acting.`)}>Open Agent with project context</button> : null}
        </CollabCard>
      </div>
    </div>
  )
}

function CollabCard({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return <UiCard className="min-w-0 rounded-lg border-border-soft bg-card p-3 shadow-none"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-semibold">{title}</h3>{badge ? <span className="rounded-full border border-border-soft bg-secondary px-2 py-0.5 text-[10px] text-faint">{badge}</span> : null}</div>{children}</UiCard>
}

function MemberLine({ member, active, onSelect }: { member: OrganizationMember; active: boolean; onSelect(): void }) {
  return <button type="button" onClick={onSelect} className={cn('flex items-center justify-between rounded-md border px-2 py-1.5 text-left', active ? 'border-primary/30 bg-primary/[0.06]' : 'border-border-soft bg-surface-0')}><span><strong className="block text-xs">{member.displayName}</strong><span className="text-[10px] text-faint">{member.title ?? 'Team member'}</span></span><span className="text-[10px] uppercase text-faint">{member.status}</span></button>
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-border-soft bg-surface-0 p-2"><strong className="block text-base">{value}</strong><span className="text-[10px] uppercase text-faint">{label}</span></div>
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 rounded-md border border-dashed border-border-strong p-3 text-center text-xs text-faint">{text}</p>
}

function actorName(id: string, members: OrganizationMember[], agents: Array<{ id: string; name: string }>): string {
  return members.find((item) => item.id === id)?.displayName ?? agents.find((item) => item.id === id)?.name ?? 'System'
}

function taskName(id: string | undefined, tasks: OrganizationTask[]): string {
  return tasks.find((item) => item.id === id)?.title ?? 'Workspace action'
}

function latestCheckpoint(task: OrganizationTask, state: OrganizationSnapshot | null): string | undefined {
  return state?.runs.find((item) => item.taskId === task.id && item.checkpointCommit)?.checkpointCommit
}

function resolveMentions(body: string, members: OrganizationMember[], agents: Array<{ id: string; name: string }>): string[] {
  const normalized = body.toLowerCase()
  const candidates = [
    ...members.filter((item) => item.status === 'active').map((item) => ({ id: item.id, name: item.displayName })),
    ...agents,
  ]
  return candidates.filter((item) => normalized.includes(`@${item.name.toLowerCase()}`)).map((item) => item.id)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
