import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import type { CodingEngineDescriptor, ModelProvider, WorkspaceState } from '../../../shared/contracts'
import type { CapabilityAssignmentSnapshot, CapabilityDescriptor, CapabilityKind, CapabilityProviderStatus } from '../../../shared/capabilities'
import { DEFAULT_CAPABILITY_PROVIDER } from '../../../shared/capabilities'
import { ND_HARNESS_ENGINE_ID } from '../../../shared/coding-engines'
import type { OrganizationPolicyEffect, OrganizationRun, OrganizationSnapshot, OrganizationTask, ProjectRuntimeStatus, TaskPriority } from '../../../shared/organization'
import { DEFAULT_PROJECT_PORT } from '../../../shared/organization'
import { Card as UiCard } from './ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { cn } from '../lib/utils'

interface Props {
  workspace: WorkspaceState | null
  onOpenDeepSeek(): void
  onError(message: string): void
}

type Section = 'overview' | 'work' | 'workforce' | 'knowledge'

const orgButton = cn(
  'h-7 shrink-0 rounded-md border border-border-strong bg-secondary px-[9px] text-sm text-soft transition-colors',
  'hover:bg-accent hover:text-foreground',
  'disabled:pointer-events-none disabled:opacity-45',
)
const orgPrimaryButton = cn(
  'h-7 shrink-0 rounded-md border border-primary/30 bg-primary/10 px-[9px] text-sm font-medium text-primary transition-colors',
  'hover:bg-primary/[0.16]',
  'disabled:pointer-events-none disabled:opacity-45',
)
const orgInput = cn(
  'min-w-0 rounded-md border border-border-strong bg-background px-[9px] py-[7px] text-sm text-foreground outline-none',
  'focus:border-primary/40',
)
const CAPABILITY_SELECTS: Array<{ kind: CapabilityKind; label: string; title: string }> = [
  { kind: 'memory', label: 'Memory', title: 'Durable recall source used when this employee runs' },
  { kind: 'context', label: 'Context', title: 'How workspace understanding is gathered before this employee runs' },
]

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
  const [capabilityProviders, setCapabilityProviders] = useState<CapabilityDescriptor[]>([])
  const [capabilityAssignments, setCapabilityAssignments] = useState<CapabilityAssignmentSnapshot>({ version: 1, agents: {}, roles: {}, teams: {} })
  const [capabilityStatuses, setCapabilityStatuses] = useState<Record<string, CapabilityProviderStatus>>({})
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [runtime, setRuntime] = useState<ProjectRuntimeStatus | null>(null)
  const [runtimeDraft, setRuntimeDraft] = useState({ startCommand: '', testCommand: '', targetUrl: '', targetPort: '', healthCheckPath: '' })

  useEffect(() => {
    let mounted = true
    const refreshProviders = (): void => {
      void window.ndDsh.providers.list()
        .then((loaded) => { if (mounted) setProviders(loaded) })
        .catch((cause) => onError(errorMessage(cause)))
    }
    refreshProviders()
    return () => { mounted = false }
  }, [onError, section])

  useEffect(() => {
    let mounted = true
    void window.ndDshOrganization.state().then((value) => { if (mounted) setState(value) }).catch((cause) => onError(errorMessage(cause)))
    const off = window.ndDshOrganization.onChanged(setState)
    return () => { mounted = false; off() }
  }, [onError])

  useEffect(() => {
    let mounted = true
    void Promise.all([window.ndDsh.engines.list(), window.ndDsh.engines.assignments(), window.ndDsh.capabilities.providers(), window.ndDsh.capabilities.assignments(), window.ndDsh.capabilities.statuses()])
      .then(([catalog, engineRouting, providers, assignments, statuses]) => {
        if (!mounted) return
        setEngines(catalog)
        setEngineAssignments(engineRouting)
        setCapabilityProviders(providers)
        setCapabilityAssignments(assignments)
        setCapabilityStatuses(statuses)
      })
      .catch((cause) => onError(errorMessage(cause)))
    const offAssignments = window.ndDsh.capabilities.onChanged((value) => { if (mounted) setCapabilityAssignments(value) })
    const offStatuses = window.ndDsh.capabilities.onStatusChanged((value) => { if (mounted) setCapabilityStatuses(value) })
    return () => { mounted = false; offAssignments(); offStatuses() }
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
  const activity = useMemo(() => state?.activity.filter((item) => item.companyId === company?.id && (!project || !item.projectId || item.projectId === project.id)).slice(0, 12) ?? [], [state, company?.id, project])

  // Dev-server lifecycle state for the active project, kept live by the
  // main-process runtime service.
  useEffect(() => {
    return window.ndDshOrganization.onRuntimeChanged(setRuntime)
  }, [])

  useEffect(() => {
    if (!project) return
    setRuntimeDraft({
      startCommand: project.startCommand ?? '',
      testCommand: project.testCommand ?? '',
      targetUrl: project.targetUrl ?? '',
      targetPort: project.targetPort !== undefined ? String(project.targetPort) : '',
      healthCheckPath: project.healthCheckPath ?? '',
    })
    let mounted = true
    void window.ndDshOrganization.projectRuntime(project.id)
      .then((status) => { if (mounted) setRuntime(status) })
      .catch(() => undefined)
    return () => { mounted = false }
    // Reseed only when switching projects; snapshot refreshes must not clobber typing.
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeRuntime = runtime && (!project || runtime.projectId === project.id) ? runtime : null

  async function saveRuntimeSettings(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!project) return
    await action('runtime-save', () => mutate({
      type: 'project.update',
      id: project.id,
      patch: {
        startCommand: runtimeDraft.startCommand,
        testCommand: runtimeDraft.testCommand,
        targetUrl: runtimeDraft.targetUrl,
        healthCheckPath: runtimeDraft.healthCheckPath,
        // Port 0 is not a valid port; the store clears the field instead of storing it.
        targetPort: runtimeDraft.targetPort.trim() ? Number(runtimeDraft.targetPort) : 0,
      },
    }))
  }

  async function openProjectTarget(): Promise<void> {
    if (!project || !activeRuntime?.targetUrl) return
    await action('runtime-open', () => window.ndDsh.browser.navigate(activeRuntime.targetUrl!))
  }

  async function controlRuntime(step: 'start' | 'stop' | 'restart'): Promise<void> {
    if (!project) return
    await action(`runtime-${step}`, async () => {
      if (step === 'stop') setRuntime(await window.ndDshOrganization.stopProjectRuntime(project.id))
      else {
        if (step === 'restart') await window.ndDshOrganization.stopProjectRuntime(project.id)
        setRuntime(await window.ndDshOrganization.startProjectRuntime(project.id))
      }
    })
  }

  async function selectProjectWorkspace(): Promise<void> {
    await action('workspace-select', async () => {
      await window.ndDsh.workspace.pick()
    })
  }

  function retryRun(run: OrganizationRun): Promise<unknown> {
    if (run.kind === 'pm-plan') return window.ndDshOrganization.planProject(run.projectId)
    if (run.kind === 'task-review' && run.taskId) return window.ndDshOrganization.reviewTask(run.taskId)
    if (run.taskId) return window.ndDshOrganization.runTask(run.taskId)
    return window.ndDshOrganization.runNext(run.projectId)
  }

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

  const availableModels = useMemo(() => {
    return providers.filter((p) => p.enabled).flatMap((p) =>
      p.models.map((m) => ({
        value: `${p.id}:${m.id}`,
        label: `${p.name} · ${m.id}`,
        providerId: p.id,
        modelId: m.id,
      }))
    )
  }, [providers])

  async function assignAgentModel(agentId: string, value: string): Promise<void> {
    await action(`model-${agentId}`, async () => {
      if (value === 'default') {
        const agent = agents.find((a) => a.id === agentId)
        if (!agent) return
        const { providerId: _p, modelId: _m, ...rest } = agent
        setState(await window.ndDshOrganization.mutate({ type: 'agent.update', id: agentId, patch: { name: rest.name, roleId: rest.roleId, status: rest.status } }))
        return
      }
      const selected = availableModels.find((m) => m.value === value)
      if (selected) {
        await mutate({ type: 'agent.update', id: agentId, patch: { providerId: selected.providerId, modelId: selected.modelId } })
      }
    })
  }

  async function assignEngine(agentId: string, engineId: string): Promise<void> {
    await action(`engine-${agentId}`, async () => {
      setEngineAssignments(await window.ndDsh.engines.assign(agentId, engineId))
    })
  }

  async function assignCapability(agentId: string, kind: CapabilityKind, providerId: string): Promise<void> {
    await action(`capability-${kind}-${agentId}`, async () => {
      setCapabilityAssignments(await window.ndDsh.capabilities.assign('agent', agentId, kind, providerId))
    })
  }

  /** Options for one capability kind; unusable entries stay visible but disabled with their reason. */
  function capabilityOptions(kind: CapabilityKind): Array<{ id: string; name: string; usable: boolean; suffix: string; reason?: string }> {
    return capabilityProviders
      .filter((provider) => provider.kind === kind)
      .map((provider) => {
        const enabled = capabilityStatuses[provider.id]?.enabled ?? provider.integration === 'builtin'
        const usable = provider.available && enabled
        const reason = !provider.available
          ? provider.unavailableReason ?? `${provider.name} is not installed.`
          : usable
            ? undefined
            : `${provider.name} is disabled. Enable it in Settings → Capabilities after a passing verification.`
        const suffix = !provider.available ? ' (unavailable)' : enabled ? '' : ' (disabled)'
        return { id: provider.id, name: provider.name, usable, suffix, ...(reason !== undefined ? { reason } : {}) }
      })
  }

  if (!state) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center gap-3 bg-surface-0 text-muted-foreground">
        <div className="size-[34px] animate-spin rounded-full border border-border-strong border-t-primary" />
        Loading AI Company OS…
      </div>
    )
  }

  if (!company) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-surface-0 p-[34px] text-center text-foreground">
        <span className="grid size-[60px] place-items-center rounded-[15px] border border-primary/30 bg-primary/10 text-[21px] font-extrabold text-primary">ND</span>
        <small className="mt-[13px] text-[12px] tracking-[0.14em] text-primary">AI COMPANY OPERATING SYSTEM</small>
        <h1 className="mx-auto mb-2 mt-3 max-w-[650px] text-[32px] font-bold">Build the organization, not another prompt chain.</h1>
        <p className="max-w-[660px] text-[15px]/[1.6] text-muted-foreground">Create a company and ND-DSH seeds an AI PM, builder, reviewer, researcher, teams, skills, workflow, memory boundary, and safety policies.</p>
        <form onSubmit={(event) => void createCompany(event)} className="mt-5 grid w-[min(540px,100%)] gap-[9px] rounded-[10px] border border-border-soft bg-sidebar p-[15px]">
          <input placeholder="Company name" value={companyDraft.name} onChange={(event) => setCompanyDraft((value) => ({ ...value, name: event.target.value }))} required className={orgInput} />
          <textarea placeholder="Company mission" value={companyDraft.mission} onChange={(event) => setCompanyDraft((value) => ({ ...value, mission: event.target.value }))} required className={cn(orgInput, 'min-h-[70px] resize-y')} />
          <button className={cn(orgPrimaryButton, 'h-9')} disabled={busy !== null}>Create AI company</button>
        </form>
      </div>
    )
  }

  const completed = tasks.filter((item) => item.status === 'completed').length
  const activeWorkers = agents.filter((item) => item.status === 'working' || item.status === 'reviewing').length
  const blockers = tasks.filter((item) => item.status === 'blocked').length
  const timeline = [
    { label: 'Planned', done: goals.length > 0 },
    { label: 'Ready', done: tasks.some((item) => item.status !== 'backlog') },
    { label: 'Building', done: tasks.some((item) => ['in_progress', 'review', 'completed'].includes(item.status)) },
    { label: 'Review', done: tasks.some((item) => ['review', 'completed'].includes(item.status)) },
    { label: 'Complete', done: tasks.length > 0 && tasks.every((item) => item.status === 'completed') },
  ]

  return <div className="grid h-full min-h-0 grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] overflow-hidden bg-surface-0 text-foreground">
    <header className="flex items-center justify-between gap-[18px] border-b border-border-soft bg-sidebar px-4 py-3">
      <div className="flex items-center gap-[9px]">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-[15px] font-extrabold text-primary">{initials(company.name)}</span>
        <div className="flex min-w-0 flex-col">
          <small className="text-[11px] tracking-[0.12em] text-faint">COMPANY</small>
          <Select value={company.id} onValueChange={(value) => void action('company-switch', () => mutate({ type: 'company.activate', id: value }))}>
            <SelectTrigger aria-label="Switch company" className="max-w-[260px] gap-2 border-0 bg-transparent p-0 text-[18px] font-semibold text-foreground shadow-none [&>svg]:size-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.companies.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-[9px]">
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground" title="Autonomy level">
          Autonomy
          <Select value={String(company.autonomyLevel)} onValueChange={(value) => void action('autonomy', () => mutate({ type: 'company.update', id: company.id, patch: { autonomyLevel: Number(value) as 0 | 1 | 2 | 3 | 4 } }))}>
            <SelectTrigger className="h-7 w-[130px] rounded-md border-border-strong bg-secondary px-2 text-sm text-soft">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">0 Ask</SelectItem>
              <SelectItem value="1">1 Plan</SelectItem>
              <SelectItem value="2">2 Internal</SelectItem>
              <SelectItem value="3">3 Workflow</SelectItem>
              <SelectItem value="4">4 Autopilot</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <button className={orgButton} onClick={onOpenDeepSeek}>Agent console</button>
        <button className={orgPrimaryButton} disabled={!project || busy !== null} onClick={() => project && void action('next', () => window.ndDshOrganization.runNext(project.id))}>Run next</button>
      </div>
    </header>

    <div className="flex min-h-[46px] items-stretch overflow-x-auto border-b border-border-soft bg-surface-1">
      <strong className="flex items-center px-3 text-xs tracking-[0.1em] text-faint">PROJECTS</strong>
      {projects.map((item) => (
        <button
          key={item.id}
          className={cn(
            'flex min-w-[140px] flex-col justify-center gap-0.5 border-l border-border-soft px-3 text-left text-muted-foreground transition-colors hover:bg-accent',
            item.id === project?.id ? 'bg-selected text-foreground hover:bg-selected' : '',
          )}
          onClick={() => void action(`project-${item.id}`, () => mutate({ type: 'project.activate', id: item.id }))}
        >
          <span className="truncate text-[15px] font-semibold">{item.name}</span>
          <small className="text-xs text-faint">{item.progress}% · {item.status}</small>
        </button>
      ))}
    </div>
    <form className="grid grid-cols-[1fr_2fr_1.5fr_auto_auto] gap-[7px] border-b border-border-soft bg-secondary px-4 py-2" onSubmit={(event) => void createProject(event)}>
      <input placeholder="New project" value={projectDraft.name} onChange={(event) => setProjectDraft((value) => ({ ...value, name: event.target.value }))} required className={orgInput} />
      <input placeholder="Objective" value={projectDraft.objective} onChange={(event) => setProjectDraft((value) => ({ ...value, objective: event.target.value }))} required className={orgInput} />
      <input placeholder="Workspace path" value={projectDraft.workspacePath} onChange={(event) => setProjectDraft((value) => ({ ...value, workspacePath: event.target.value }))} className={orgInput} />
      <button type="button" className={orgButton} disabled={!workspace?.root || busy !== null} onClick={() => setProjectDraft((value) => ({ ...value, workspacePath: workspace?.root ?? '' }))}>Use open workspace</button>
      <button className={orgButton}>Add project</button>
    </form>
    <nav className="flex gap-1 border-b border-border-soft bg-secondary px-4 py-1.5">
      {(['overview', 'work', 'workforce', 'knowledge'] as const).map((item) => (
        <button
          key={item}
          className={cn(
            'h-7 rounded-md border border-transparent bg-transparent px-[9px] text-sm transition-colors',
            section === item ? 'border-primary/30 bg-primary/10 text-primary' : 'text-soft hover:bg-accent hover:text-foreground',
          )}
          onClick={() => setSection(item)}
        >
          {sectionLabel(item)}
        </button>
      ))}
    </nav>

    <main className="min-h-0 overflow-auto px-4 pt-3.5 pb-7">
      {section === 'overview' ? <>
        <div className="mb-2.5 grid grid-cols-2 gap-[9px] min-[1100px]:grid-cols-4">
          <Stat label="Project" value={`${project?.progress ?? 0}%`} detail={project?.objective ?? 'Create a project'} />
          <Stat label="Workforce" value={`${activeWorkers}/${agents.length}`} detail="active AI workers" />
          <Stat label="Tasks" value={`${completed}/${tasks.length}`} detail={`${blockers} blocked`} />
          <Stat label="Policy gates" value={`${policies.filter((item) => item.effect === 'ask').length}`} detail="require a human decision" />
        </div>
        <div className="mb-2.5 flex flex-wrap items-center gap-x-[7px] gap-y-1.5 rounded-[9px] border border-border-soft bg-sidebar px-[11px] py-2">
          <small className="mr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">Timeline</small>
          {timeline.map((step, index) => (
            <span key={step.label} className="flex items-center gap-[7px]">
              {index > 0 ? <span className="text-fainter">→</span> : null}
              <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', step.done ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border-strong bg-secondary text-faint')}>{step.label}</span>
            </span>
          ))}
        </div>
        <div className="mb-2.5 grid grid-cols-1 gap-2.5 min-[1100px]:grid-cols-2">
          <Card title="Goals" action={project ? <button className={orgButton} disabled={busy !== null} onClick={() => void action('plan', () => window.ndDshOrganization.planProject(project.id))}>AI PM plan</button> : undefined}>
            {goals.length ? goals.map((goal) => (
              <Row key={goal.id} left={<><strong className="truncate text-sm">{goal.title}</strong><small className="text-xs text-faint">{goal.status}</small></>} right={<span className="shrink-0 text-xs text-muted-foreground">{goal.progress}%</span>} />
            )) : <Empty text="Create a project and ask the AI PM to plan it." />}
          </Card>
          <Card title="Live runs">
            {runs.length ? runs.map((run) => (
              <div key={run.id} className="border-b border-border-soft py-2 last:border-b-0">
                <Row
                  left={<>
                    <strong className="truncate text-sm">{runKindLabel(run.kind)}</strong>
                    <small className="truncate text-xs text-faint">{run.status} · {short(run.sessionId)} · {clock(run.startedAt)}</small>
                  </>}
                  right={run.status === 'failed'
                    ? <button className={cn(orgButton, 'h-[22px] shrink-0 px-1.5 text-[11px]')} disabled={busy !== null} onClick={() => void action(`retry-${run.id}`, () => retryRun(run))}>Retry</button>
                    : run.status === 'running'
                      ? <span className="shrink-0 text-xs font-semibold text-primary">running…</span>
                      : undefined}
                />
                {run.error ? (
                  <p className="m-0 mt-1.5 max-h-[88px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-destructive/25 bg-destructive/[0.06] p-[7px] text-xs/[1.45] text-destructive" title={run.error}>
                    {run.error.length > 500 ? `${run.error.slice(0, 500)}…` : run.error}
                  </p>
                ) : null}
              </div>
            )) : <Empty text="PM, worker and reviewer runs appear here." />}
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-2.5 min-[1100px]:grid-cols-2">
          <Card title={`Project runtime${project ? ` · ${project.name}` : ''}`}>
            {project ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]', runtimeChipClass(activeRuntime?.state))}>
                    {activeRuntime?.state ?? 'stopped'}
                  </span>
                  {activeRuntime?.targetUrl ? <code className="min-w-0 truncate font-mono text-xs text-soft" title={activeRuntime.targetUrl}>{activeRuntime.targetUrl}</code> : null}
                  <div className="ml-auto flex shrink-0 gap-[7px]">
                    <button className={orgButton} disabled={busy !== null} onClick={() => void openProjectTarget()}>Open in Browser</button>
                    {activeRuntime?.state === 'starting' || activeRuntime?.state === 'ready' ? (
                      <>
                        <button className={orgButton} disabled={busy !== null} onClick={() => void controlRuntime('restart')}>Restart</button>
                        <button className={orgButton} disabled={busy !== null} onClick={() => void controlRuntime('stop')}>Stop</button>
                      </>
                    ) : (
                      <button className={orgPrimaryButton} disabled={busy !== null} onClick={() => void controlRuntime('start')}>Start</button>
                    )}
                  </div>
                </div>
                {workspace?.binding === 'missing' || !project.workspacePath ? (
                  <div className="flex items-center justify-between gap-2 rounded-[7px] border border-warning/30 bg-warning/[0.06] px-[7px] py-1.5 text-xs text-warning">
                    <span>Link the project folder before running the app or checks.</span>
                    <button type="button" className={orgButton} disabled={busy !== null} onClick={() => void selectProjectWorkspace()}>Select workspace</button>
                  </div>
                ) : null}
                {activeRuntime?.lastError ? (
                  <p className="m-0 max-h-[110px] overflow-auto whitespace-pre-wrap break-words rounded-[7px] border border-destructive/25 bg-destructive/[0.06] p-[7px] text-xs/[1.45] text-destructive">
                    {activeRuntime.lastError.length > 600 ? `${activeRuntime.lastError.slice(0, 600)}…` : activeRuntime.lastError}
                  </p>
                ) : null}
                {activeRuntime?.validation?.length ? (
                  <ul className="m-0 list-none p-0 text-[11px]/[1.5] text-muted-foreground">
                    {activeRuntime.validation.map((line) => <li key={line}>· {line}</li>)}
                  </ul>
                ) : null}
                <form className="grid grid-cols-1 gap-[7px] min-[900px]:grid-cols-2" onSubmit={(event) => void saveRuntimeSettings(event)}>
                  <input placeholder="Start command (e.g. npm run dev)" value={runtimeDraft.startCommand} onChange={(event) => setRuntimeDraft((value) => ({ ...value, startCommand: event.target.value }))} className={orgInput} />
                  <input placeholder="Test command (informational)" value={runtimeDraft.testCommand} onChange={(event) => setRuntimeDraft((value) => ({ ...value, testCommand: event.target.value }))} className={orgInput} />
                  <input placeholder="Target URL — overrides port (e.g. http://localhost:3000)" value={runtimeDraft.targetUrl} onChange={(event) => setRuntimeDraft((value) => ({ ...value, targetUrl: event.target.value }))} className={orgInput} />
                  <input placeholder={`Target port (default ${DEFAULT_PROJECT_PORT})`} inputMode="numeric" value={runtimeDraft.targetPort} onChange={(event) => setRuntimeDraft((value) => ({ ...value, targetPort: event.target.value }))} className={orgInput} />
                  <input placeholder="Health-check path (/)" value={runtimeDraft.healthCheckPath} onChange={(event) => setRuntimeDraft((value) => ({ ...value, healthCheckPath: event.target.value }))} className={orgInput} />
                  <button className={orgButton}>Save runtime</button>
                </form>
              </div>
            ) : <Empty text="Create a project to configure its dev server and browser target." />}
          </Card>
          <Card title="Activity">
            {activity.length ? activity.map((item) => (
              <Row
                key={item.id}
                left={<><strong className="truncate font-mono text-xs">{item.type}</strong><small className="text-xs/[1.45] text-muted-foreground">{item.message}</small></>}
                right={<small className="shrink-0 text-[10px] text-faint">{clock(item.createdAt)}</small>}
              />
            )) : <Empty text="Workforce activity lands here as it happens." />}
          </Card>
        </div>
      </> : null}

      {section === 'work' ? <Card title={project ? `${project.name} work board` : 'Work board'}>
        {project ? (
          <form className="mb-2 grid grid-cols-[1fr_2fr_1.5fr_auto] gap-[7px]" onSubmit={(event) => void createTask(event)}>
            <input placeholder="Task title" value={taskDraft.title} onChange={(event) => setTaskDraft((value) => ({ ...value, title: event.target.value }))} required className={orgInput} />
            <input placeholder="Required outcome" value={taskDraft.description} onChange={(event) => setTaskDraft((value) => ({ ...value, description: event.target.value }))} required className={orgInput} />
            <Select value={taskDraft.priority} onValueChange={(value) => setTaskDraft((current) => ({ ...current, priority: value as TaskPriority }))}>
              <SelectTrigger className="h-auto min-h-9 w-full rounded-md border-border-strong bg-background px-[9px] py-[7px] text-sm text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
                <SelectItem value="critical">critical</SelectItem>
              </SelectContent>
            </Select>
            <button className={orgButton}>Add task</button>
          </form>
        ) : null}
        <div className="grid grid-cols-[repeat(5,minmax(160px,1fr))] gap-2 overflow-x-auto max-[1100px]:grid-cols-[repeat(5,220px)]">
          {(['ready', 'in_progress', 'review', 'blocked', 'completed'] as const).map((status) => (
            <section key={status} className="min-h-[300px] rounded-[7px] border border-border-soft bg-surface-0 p-2">
              <header className="mb-[7px] flex justify-between text-xs font-bold uppercase text-muted-foreground">
                {status.replace('_', ' ')} <b>{tasks.filter((item) => item.status === status).length}</b>
              </header>
              {tasks.filter((item) => item.status === status).map((item) => <TaskCard key={item.id} task={item} state={state} busy={busy} run={action} />)}
            </section>
          ))}
        </div>
      </Card> : null}

      {section === 'workforce' ? <div className="mb-2.5 grid grid-cols-1 gap-2.5 min-[1100px]:grid-cols-2">
        <Card title="Teams">
          {teams.map((team) => (
            <Row key={team.id} left={<><strong className="truncate text-sm">{team.name}</strong><small className="text-xs text-faint">{team.purpose}</small></>} right={<span className="shrink-0 text-xs text-muted-foreground">{agents.filter((agent) => agent.teamId === team.id).length}</span>} />
          ))}
        </Card>
        <Card title="AI workers">
          {agents.map((agent) => {
            const engineId = engineAssignments[agent.id] ?? ND_HARNESS_ENGINE_ID
            const agentRole = roles.find((role) => role.id === agent.roleId)
            const rawModelValue = agent.providerId && agent.modelId
              ? `${agent.providerId}:${agent.modelId}`
              : agentRole?.providerId && agentRole?.modelId
                ? `${agentRole.providerId}:${agentRole.modelId}`
                : 'default'
            const activeModelValue = rawModelValue === 'default' || availableModels.some((m) => m.value === rawModelValue)
              ? rawModelValue
              : 'default'
            return (
              <Row
                key={agent.id}
                left={<><strong className="truncate text-sm">{agent.name}</strong><small className="text-xs text-faint">{agentRole?.name ?? 'Role'} · {agent.status}</small></>}
                right={
                  <div className="flex shrink-0 items-center gap-2">
                    <label title="LLM model assigned to this agent" className="flex items-center gap-1.5 text-[11px] text-faint">
                      Model
                      <Select value={activeModelValue} disabled={busy !== null} onValueChange={(value) => void assignAgentModel(agent.id, value)}>
                        <SelectTrigger className="h-7 w-[150px] rounded-md border-border-strong bg-secondary px-2 text-[11px] text-soft">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default route</SelectItem>
                          {availableModels.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                    <label title="Coding engine used when this employee executes an assigned task" className="flex items-center gap-1.5 text-[11px] text-faint">
                      Engine
                      <Select value={engineId} disabled={busy !== null} onValueChange={(value) => void assignEngine(agent.id, value)}>
                        <SelectTrigger className="h-7 w-[130px] rounded-md border-border-strong bg-secondary px-2 text-[11px] text-soft">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {engines.map((engine) => <SelectItem key={engine.id} value={engine.id} disabled={!engine.available}>{engine.name}{engine.available ? '' : ' (unavailable)'}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </label>
                    {CAPABILITY_SELECTS.map(({ kind, label, title }) => {
                      const value = capabilityAssignments.agents[agent.id]?.[kind] ?? DEFAULT_CAPABILITY_PROVIDER[kind]
                      return (
                        <label key={kind} title={title} className="flex items-center gap-1.5 text-[11px] text-faint">
                          {label}
                          <Select value={value} disabled={busy !== null} onValueChange={(next) => void assignCapability(agent.id, kind, next)}>
                            <SelectTrigger className="h-7 w-[130px] rounded-md border-border-strong bg-secondary px-2 text-[11px] text-soft">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {capabilityOptions(kind).map((option) => (
                                <SelectItem key={option.id} value={option.id} disabled={!option.usable} title={option.reason}>
                                  {`${option.name}${option.suffix}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      )
                    })}
                  </div>
                }
              />
            )
          })}
        </Card>
        <Card title="Skills" wide>
          {state.skills.filter((skill) => skill.scope === 'builtin' || skill.companyId === company.id || skill.projectId === project?.id).map((skill) => (
            <div key={skill.id} className="mr-[7px] mb-[7px] inline-flex min-h-[78px] w-[calc(33.333%-7px)] flex-col gap-1 rounded-[7px] border border-border-soft bg-surface-0 p-2 align-top max-[1100px]:w-[calc(50%-7px)]">
              <small className="text-[11px] uppercase text-primary">{skill.scope}</small>
              <strong className="text-sm">{skill.name}</strong>
              <p className="m-0 text-xs/[1.45] text-muted-foreground">{skill.description}</p>
            </div>
          ))}
        </Card>
      </div> : null}

      {section === 'knowledge' ? <div className="mb-2.5 grid grid-cols-1 gap-2.5 min-[1100px]:grid-cols-2">
        <Card title="Memory">
          <form className="mb-2.5 grid grid-cols-[1fr_2fr_auto] gap-[7px]" onSubmit={(event) => void addMemory(event)}>
            <input placeholder="Decision or lesson" value={memoryDraft.title} onChange={(event) => setMemoryDraft((value) => ({ ...value, title: event.target.value }))} required className={orgInput} />
            <textarea placeholder="Durable context" value={memoryDraft.content} onChange={(event) => setMemoryDraft((value) => ({ ...value, content: event.target.value }))} required className={cn(orgInput, 'min-h-[34px] resize-y')} />
            <button className={orgButton}>Add</button>
          </form>
          {memory.slice().reverse().map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_auto] gap-1 border-b border-border-soft py-[9px] last:border-b-0">
              <strong className="truncate text-sm">{item.title}</strong>
              <small className="text-[11px] text-faint">{item.source}</small>
              <p className="col-span-full m-0 text-xs/[1.45] text-muted-foreground">{item.content}</p>
            </div>
          ))}
        </Card>
        <Card title="Policies">
          {policies.map((policy) => (
            <div key={policy.id} className="flex items-center justify-between gap-2.5 border-b border-border-soft py-2 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className="truncate font-mono text-xs">{policy.action}</strong>
                <small className="truncate text-[11px] text-muted-foreground">{policy.description}</small>
              </div>
              <Select value={policy.effect} onValueChange={(value) => void action(`policy-${policy.id}`, () => mutate({ type: 'policy.set', companyId: company.id, action: policy.action, effect: value as OrganizationPolicyEffect, description: policy.description }))}>
                <SelectTrigger className="h-7 w-[74px] shrink-0 rounded-md border-border-strong bg-secondary px-2 text-[11px] text-soft">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">ALLOW</SelectItem>
                  <SelectItem value="ask">ASK</SelectItem>
                  <SelectItem value="deny">DENY</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </Card>
      </div> : null}
    </main>
  </div>
}

function TaskCard({ task, state, busy, run }: { task: OrganizationTask; state: OrganizationSnapshot; busy: string | null; run(key: string, fn: () => Promise<unknown>): Promise<void> }) {
  const agent = state.agents.find((item) => item.id === task.assignedAgentId)
  return (
    <article className="mb-[7px] flex flex-col gap-1.5 rounded-[7px] border border-border-soft bg-sidebar p-[9px]">
      <small className="text-[11px] uppercase text-faint">{task.priority}</small>
      <strong className="text-sm">{task.title}</strong>
      <p className="m-0 text-xs/[1.45] text-muted-foreground">{task.description}</p>
      <footer className="flex items-center justify-between gap-1.5 text-[11px] text-faint">
        <span className="truncate">{agent?.name ?? 'AI worker'}</span>
        <TaskAction task={task} busy={busy} run={run} />
      </footer>
    </article>
  )
}

function TaskAction({ task, busy, run }: { task: OrganizationTask; busy: string | null; run(key: string, fn: () => Promise<unknown>): Promise<void> }) {
  if (task.status === 'ready' || task.status === 'blocked') {
    return <button className={cn(orgButton, 'h-[22px] px-1.5 text-[11px]')} disabled={busy !== null} onClick={() => void run(`task-${task.id}`, () => window.ndDshOrganization.runTask(task.id))}>{task.status === 'blocked' ? 'Retry' : 'Run'}</button>
  }
  if (task.status === 'review') {
    return <button className={cn(orgButton, 'h-[22px] px-1.5 text-[11px]')} disabled={busy !== null || Boolean(task.reviewSessionId)} onClick={() => void run(`review-${task.id}`, () => window.ndDshOrganization.reviewTask(task.id))}>{task.reviewSessionId ? 'Reviewing…' : 'Review'}</button>
  }
  return <small className="shrink-0">{task.status}</small>
}

/** List row with a two-line label block on the left and optional trailing control. */
function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[9px] border-b border-border-soft py-2 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">{left}</div>
      {right}
    </div>
  )
}

/**
 * Dashboard section card. Built on the shared shadcn Card shell; the className
 * overrides map it back onto ND tokens (sidebar surface, soft border, 9px
 * radius, no shadow/gap) so every call site keeps its exact look while picking
 * up data-slot="card" and the primitive's layout contract.
 */
function Card({ title, action, wide = false, children }: { title: string; action?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <UiCard
      className={cn(
        'gap-0 overflow-hidden rounded-[9px] border-border-soft bg-sidebar py-0 shadow-none',
        wide && 'col-span-full',
      )}
    >
      <header className="flex min-h-10 items-center justify-between border-b border-border-soft px-[11px]">
        <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
        {action}
      </header>
      <div className="px-[11px] py-[9px]">{children}</div>
    </UiCard>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex min-h-[78px] flex-col rounded-[9px] border border-border-soft bg-sidebar p-[11px]">
      <small className="text-[11px] uppercase tracking-[0.08em] text-faint">{label}</small>
      <strong className="mb-0.5 mt-[5px] truncate text-[28px] font-semibold">{value}</strong>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-1 py-5 text-center text-sm text-faint">{text}</p>
}

function sectionLabel(value: Section): string { return value === 'workforce' ? 'Teams & Skills' : value === 'knowledge' ? 'Memory & Policies' : `${value[0]?.toUpperCase()}${value.slice(1)}` }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ND' }
function short(value: string): string { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value }
function clock(value: number): string { return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function runKindLabel(kind: OrganizationRun['kind']): string {
  if (kind === 'pm-plan') return 'AI PM plan'
  return kind === 'task-review' ? 'Independent review' : 'Builder execution'
}
function runtimeChipClass(state: ProjectRuntimeStatus['state'] | undefined): string {
  if (state === 'ready') return 'border-primary/30 bg-primary/10 text-primary'
  if (state === 'starting') return 'border-info/30 bg-info/10 text-info'
  if (state === 'unreachable') return 'border-destructive/30 bg-destructive/[0.08] text-destructive'
  return 'border-border-strong bg-secondary text-muted-foreground'
}
function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause) }
