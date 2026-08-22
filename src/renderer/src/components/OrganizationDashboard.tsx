import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { CodingEngineDescriptor, WorkspaceState } from '../../../shared/contracts'
import { ND_HARNESS_ENGINE_ID } from '../../../shared/coding-engines'
import type { OrganizationPolicyEffect, OrganizationSnapshot, OrganizationTask, TaskPriority } from '../../../shared/organization'

interface Props {
  workspace: WorkspaceState | null
  onOpenDeepSeek(): void
  onError(message: string): void
}

type Section = 'overview' | 'work' | 'workforce' | 'knowledge'

export function OrganizationDashboard({ workspace, onOpenDeepSeek, onError }: Props) {
  const [state, setState] = useState<OrganizationSnapshot | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [busy, setBusy] = useState<string | null>(null)
  const [companyDraft, setCompanyDraft] = useState({ name: '', mission: '' })
  const [projectDraft, setProjectDraft] = useState({ name: '', objective: '', workspacePath: workspace?.root ?? '' })
  const [taskDraft, setTaskDraft] = useState({ title: '', description: '', priority: 'medium' as TaskPriority })
  const [memoryDraft, setMemoryDraft] = useState({ title: '', content: '' })
  const [engines, setEngines] = useState<CodingEngineDescriptor[]>([])
  const [engineAssignments, setEngineAssignments] = useState<Record<string, string>>({})

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state().then((value) => { if (mounted) setState(value) }).catch((cause) => onError(errorMessage(cause)))
    const off = window.ndDshOrganization.onChanged(setState)
    return () => { mounted = false; off() }
  }, [onError])

  useEffect(() => {
    let mounted = true
    void Promise.all([window.ndDsh.engines.list(), window.ndDsh.engines.assignments()])
      .then(([catalog, assignments]) => {
        if (!mounted) return
        setEngines(catalog)
        setEngineAssignments(assignments)
      })
      .catch((cause) => onError(errorMessage(cause)))
    return () => { mounted = false }
  }, [onError])

  const company = useMemo(() => state?.companies.find((item) => item.id === state.activeCompanyId) ?? null, [state])
  const projects = useMemo(() => state?.projects.filter((item) => item.companyId === company?.id) ?? [], [state, company?.id])
  const project = useMemo(() => projects.find((item) => item.id === state?.activeProjectId) ?? projects[0] ?? null, [projects, state?.activeProjectId])
  const tasks = useMemo(() => state?.tasks.filter((item) => item.projectId === project?.id) ?? [], [state, project?.id])
  const goals = useMemo(() => state?.goals.filter((item) => item.projectId === project?.id) ?? [], [state, project?.id])
  const agents = useMemo(() => state?.agents.filter((item) => item.companyId === company?.id) ?? [], [state, company?.id])
  const teams = useMemo(() => state?.teams.filter((item) => item.companyId === company?.id) ?? [], [state, company?.id])
  const roles = useMemo(() => state?.roles.filter((item) => item.companyId === company?.id) ?? [], [state, company?.id])
  const policies = useMemo(() => state?.policies.filter((item) => item.companyId === company?.id) ?? [], [state, company?.id])
  const memory = useMemo(() => state?.memory.filter((item) => item.companyId === company?.id && (!item.projectId || item.projectId === project?.id)) ?? [], [state, company?.id, project?.id])
  const runs = useMemo(() => state?.runs.filter((item) => item.companyId === company?.id && (!project || item.projectId === project.id)).slice(0, 8) ?? [], [state, company?.id, project])

  async function action(key: string, fn: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (cause) { onError(errorMessage(cause)) } finally { setBusy(null) }
  }

  async function mutate(value: Parameters<typeof window.ndDshOrganization.mutate>[0]): Promise<void> {
    setState(await window.ndDshOrganization.mutate(value))
  }

  async function createCompany(event: FormEvent): Promise<void> {
    event.preventDefault()
    await action('company', async () => {
      await mutate({ type: 'company.create', name: companyDraft.name, mission: companyDraft.mission })
      setCompanyDraft({ name: '', mission: '' })
    })
  }

  async function createProject(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!company) return
    await action('project', async () => {
      await mutate({ type: 'project.create', companyId: company.id, name: projectDraft.name, objective: projectDraft.objective, ...(projectDraft.workspacePath.trim() ? { workspacePath: projectDraft.workspacePath.trim() } : {}) })
      setProjectDraft({ name: '', objective: '', workspacePath: workspace?.root ?? '' })
    })
  }

  async function createTask(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!company || !project) return
    await action('task', async () => {
      await mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: taskDraft.title, description: taskDraft.description, priority: taskDraft.priority, acceptanceCriteria: ['Requested outcome is implemented and verified.'] })
      setTaskDraft({ title: '', description: '', priority: 'medium' })
    })
  }

  async function addMemory(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!company) return
    await action('memory', async () => {
      await mutate({ type: 'memory.add', companyId: company.id, ...(project ? { projectId: project.id } : {}), title: memoryDraft.title, content: memoryDraft.content, tags: ['manual'] })
      setMemoryDraft({ title: '', content: '' })
    })
  }

  async function assignEngine(agentId: string, engineId: string): Promise<void> {
    await action(`engine-${agentId}`, async () => {
      setEngineAssignments(await window.ndDsh.engines.assign(agentId, engineId))
    })
  }

  if (!state) return <div className="org-loading"><div className="placeholder-ring" />Loading AI Company OS…</div>

  if (!company) {
    return <div className="org-onboarding">
      <span className="org-logo">ND</span><small>AI COMPANY OPERATING SYSTEM</small>
      <h1>Build the organization, not another prompt chain.</h1>
      <p>Create a company and ND-DSH seeds an AI PM, builder, reviewer, researcher, teams, skills, workflow, memory boundary, and safety policies.</p>
      <form onSubmit={(event) => void createCompany(event)}>
        <input placeholder="Company name" value={companyDraft.name} onChange={(event) => setCompanyDraft((value) => ({ ...value, name: event.target.value }))} required />
        <textarea placeholder="Company mission" value={companyDraft.mission} onChange={(event) => setCompanyDraft((value) => ({ ...value, mission: event.target.value }))} required />
        <button className="org-primary" disabled={busy !== null}>Create AI company</button>
      </form>
    </div>
  }

  const completed = tasks.filter((item) => item.status === 'completed').length
  const activeWorkers = agents.filter((item) => item.status === 'working' || item.status === 'reviewing').length
  const blockers = tasks.filter((item) => item.status === 'blocked').length

  return <div className="org-shell">
    <header className="org-topbar">
      <div className="org-company"><span>{initials(company.name)}</span><div><small>COMPANY</small><select value={company.id} onChange={(event) => void action('company-switch', () => mutate({ type: 'company.activate', id: event.target.value }))}>{state.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
      <div className="org-actions">
        <label>Autonomy <select value={company.autonomyLevel} onChange={(event) => void action('autonomy', () => mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 } }))}><option value={0}>0 Ask</option><option value={1}>1 Plan</option><option value={2}>2 Internal</option><option value={3}>3 Workflow</option><option value={4}>4 Autopilot</option></select></label>
        <button onClick={onOpenDeepSeek}>Agent ↗</button>
        <button className="org-primary" disabled={!project || busy !== null} onClick={() => project && void action('next', () => window.ndDshOrganization.runNext(project.id))}>Run next</button>
      </div>
    </header>

    <div className="org-projectbar"><strong>PROJECTS</strong>{projects.map((item) => <button key={item.id} className={item.id === project?.id ? 'active' : ''} onClick={() => void action(`project-${item.id}`, () => mutate({ type: 'project.activate', id: item.id }))}><span>{item.name}</span><small>{item.progress}% · {item.status}</small></button>)}</div>
    <form className="org-inline" onSubmit={(event) => void createProject(event)}><input placeholder="New project" value={projectDraft.name} onChange={(event) => setProjectDraft((value) => ({ ...value, name: event.target.value }))} required /><input placeholder="Objective" value={projectDraft.objective} onChange={(event) => setProjectDraft((value) => ({ ...value, objective: event.target.value }))} required /><input placeholder="Workspace path" value={projectDraft.workspacePath} onChange={(event) => setProjectDraft((value) => ({ ...value, workspacePath: event.target.value }))} /><button>Add project</button></form>
    <nav className="org-nav">{(['overview', 'work', 'workforce', 'knowledge'] as const).map((item) => <button key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>{sectionLabel(item)}</button>)}</nav>

    <main className="org-content">
      {section === 'overview' ? <>
        <div className="org-stats"><Stat label="Project" value={`${project?.progress ?? 0}%`} detail={project?.objective ?? 'Create a project'} /><Stat label="Workforce" value={`${activeWorkers}/${agents.length}`} detail="active AI workers" /><Stat label="Tasks" value={`${completed}/${tasks.length}`} detail={`${blockers} blocked`} /><Stat label="Policy gates" value={`${policies.filter((item) => item.effect === 'ask').length}`} detail="require a human decision" /></div>
        <div className="org-grid"><Card title="Goals" action={project ? <button disabled={busy !== null} onClick={() => void action('plan', () => window.ndDshOrganization.planProject(project.id))}>AI PM plan</button> : undefined}>{goals.length ? goals.map((goal) => <div className="org-row" key={goal.id}><div><strong>{goal.title}</strong><small>{goal.status}</small></div><span>{goal.progress}%</span></div>) : <Empty text="Create a project and ask the AI PM to plan it." />}</Card><Card title="Live runs">{runs.length ? runs.map((run) => <div className="org-row" key={run.id}><div><strong>{run.kind}</strong><small>{run.status} · {short(run.sessionId)}</small></div></div>) : <Empty text="PM, worker and reviewer runs appear here." />}</Card></div>
      </> : null}

      {section === 'work' ? <Card title={project ? `${project.name} work board` : 'Work board'}>
        {project ? <form className="org-inline" onSubmit={(event) => void createTask(event)}><input placeholder="Task title" value={taskDraft.title} onChange={(event) => setTaskDraft((value) => ({ ...value, title: event.target.value }))} required /><input placeholder="Required outcome" value={taskDraft.description} onChange={(event) => setTaskDraft((value) => ({ ...value, description: event.target.value }))} required /><select value={taskDraft.priority} onChange={(event) => setTaskDraft((value) => ({ ...value, priority: event.target.value as TaskPriority }))}><option>low</option><option>medium</option><option>high</option><option>critical</option></select><button>Add task</button></form> : null}
        <div className="org-board">{(['ready', 'in_progress', 'review', 'blocked', 'completed'] as const).map((status) => <section key={status}><header>{status.replace('_', ' ')} <b>{tasks.filter((item) => item.status === status).length}</b></header>{tasks.filter((item) => item.status === status).map((item) => <TaskCard key={item.id} task={item} state={state} busy={busy} run={action} />)}</section>)}</div>
      </Card> : null}

      {section === 'workforce' ? <div className="org-grid"><Card title="Teams">{teams.map((team) => <div className="org-row" key={team.id}><div><strong>{team.name}</strong><small>{team.purpose}</small></div><span>{agents.filter((agent) => agent.teamId === team.id).length}</span></div>)}</Card><Card title="AI workers">{agents.map((agent) => {
        const engineId = engineAssignments[agent.id] ?? ND_HARNESS_ENGINE_ID
        return <div className="org-row" key={agent.id}><div><strong>{agent.name}</strong><small>{roles.find((role) => role.id === agent.roleId)?.name ?? 'Role'} · {agent.status}</small></div><label title="Coding engine used when this employee executes an assigned task">Engine <select value={engineId} disabled={busy !== null} onChange={(event) => void assignEngine(agent.id, event.target.value)}>{engines.map((engine) => <option key={engine.id} value={engine.id} disabled={!engine.available}>{engine.name}{engine.available ? '' : ' (unavailable)'}</option>)}</select></label></div>
      })}</Card><Card title="Skills" wide>{state.skills.filter((skill) => skill.scope === 'builtin' || skill.companyId === company.id || skill.projectId === project?.id).map((skill) => <div className="org-skill" key={skill.id}><small>{skill.scope}</small><strong>{skill.name}</strong><p>{skill.description}</p></div>)}</Card></div> : null}

      {section === 'knowledge' ? <div className="org-grid"><Card title="Memory"><form className="org-memory" onSubmit={(event) => void addMemory(event)}><input placeholder="Decision or lesson" value={memoryDraft.title} onChange={(event) => setMemoryDraft((value) => ({ ...value, title: event.target.value }))} required /><textarea placeholder="Durable context" value={memoryDraft.content} onChange={(event) => setMemoryDraft((value) => ({ ...value, content: event.target.value }))} required /><button>Add</button></form>{memory.slice().reverse().map((item) => <div className="org-memory-item" key={item.id}><strong>{item.title}</strong><small>{item.source}</small><p>{item.content}</p></div>)}</Card><Card title="Policies">{policies.map((policy) => <div className="org-policy" key={policy.id}><div><strong>{policy.action}</strong><small>{policy.description}</small></div><select value={policy.effect} onChange={(event) => void action(`policy-${policy.id}`, () => mutate({ type: 'policy.set', companyId: company.id, action: policy.action, effect: event.target.value as OrganizationPolicyEffect, description: policy.description }))}><option value="allow">ALLOW</option><option value="ask">ASK</option><option value="deny">DENY</option></select></div>)}</Card></div> : null}
    </main>
  </div>
}

function TaskCard({ task, state, busy, run }: { task: OrganizationTask; state: OrganizationSnapshot; busy: string | null; run(key: string, fn: () => Promise<unknown>): Promise<void> }) {
  const agent = state.agents.find((item) => item.id === task.assignedAgentId)
  return <article className="org-task"><small>{task.priority}</small><strong>{task.title}</strong><p>{task.description}</p><footer><span>{agent?.name ?? 'AI worker'}</span><TaskAction task={task} busy={busy} run={run} /></footer></article>
}

function TaskAction({ task, busy, run }: { task: OrganizationTask; busy: string | null; run(key: string, fn: () => Promise<unknown>): Promise<void> }) {
  if (task.status === 'ready' || task.status === 'blocked') return <button disabled={busy !== null} onClick={() => void run(`task-${task.id}`, () => window.ndDshOrganization.runTask(task.id))}>{task.status === 'blocked' ? 'Retry' : 'Run'}</button>
  if (task.status === 'review') return <button disabled={busy !== null || Boolean(task.reviewSessionId)} onClick={() => void run(`review-${task.id}`, () => window.ndDshOrganization.reviewTask(task.id))}>{task.reviewSessionId ? 'Reviewing…' : 'Review'}</button>
  return <small>{task.status}</small>
}

function Card({ title, action, wide = false, children }: { title: string; action?: ReactNode; wide?: boolean; children: ReactNode }) { return <section className={`org-card ${wide ? 'wide' : ''}`}><header><h2>{title}</h2>{action}</header><div>{children}</div></section> }
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="org-stat"><small>{label}</small><strong>{value}</strong><span>{detail}</span></div> }
function Empty({ text }: { text: string }) { return <p className="org-empty">{text}</p> }
function sectionLabel(value: Section): string { return value === 'workforce' ? 'Teams & Skills' : value === 'knowledge' ? 'Memory & Policies' : `${value[0]?.toUpperCase()}${value.slice(1)}` }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ND' }
function short(value: string): string { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value }
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
