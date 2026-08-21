import type {
  Company,
  MemoryEntry,
  OrganizationActivity,
  OrganizationAgent,
  OrganizationDesktopApi,
  OrganizationGoal,
  OrganizationMutation,
  OrganizationPolicy,
  OrganizationRole,
  OrganizationRun,
  OrganizationRunReceipt,
  OrganizationSkill,
  OrganizationSnapshot,
  OrganizationTask,
  Project,
  Team,
  WorkflowStep,
} from '../../../shared/organization'

const STORAGE_KEY = 'nd-dsh:organization'

const BUILTIN_SKILLS: OrganizationSkill[] = [
  { id: 'builtin:strategy', scope: 'builtin', name: 'Company strategy', description: 'Turn a mission into objectives, priorities, tradeoffs, and measurable outcomes.', instructions: 'Turn a mission into objectives, priorities, tradeoffs, and measurable outcomes.' },
  { id: 'builtin:project-plan', scope: 'builtin', name: 'Project planning', description: 'Turn an objective into a roadmap, milestones, dependencies, risks, and acceptance criteria.', instructions: 'Turn an objective into a roadmap, milestones, dependencies, risks, and acceptance criteria.' },
  { id: 'builtin:task-breakdown', scope: 'builtin', name: 'Task breakdown', description: 'Decompose goals into dependency-aware work that can be independently verified.', instructions: 'Decompose goals into dependency-aware work that can be independently verified.' },
  { id: 'builtin:implementation', scope: 'builtin', name: 'Software implementation', description: 'Inspect a codebase, implement changes, run checks, and leave the workspace in a reviewable state.', instructions: 'Inspect a codebase, implement changes, run checks, and leave the workspace in a reviewable state.' },
  { id: 'builtin:review', scope: 'builtin', name: 'Independent review', description: 'Review completed work against requirements, tests, security, regressions, and maintainability.', instructions: 'Review completed work against requirements, tests, security, regressions, and maintainability.' },
  { id: 'builtin:qa', scope: 'builtin', name: 'Testing and QA', description: 'Design and execute meaningful verification across code, browser behavior, and edge cases.', instructions: 'Design and execute meaningful verification across code, browser behavior, and edge cases.' },
  { id: 'builtin:research', scope: 'builtin', name: 'Web research', description: 'Research current information, compare sources, and produce decision-ready findings.', instructions: 'Research current information, compare sources, and produce decision-ready findings.' },
  { id: 'builtin:browser', scope: 'builtin', name: 'Live browser', description: 'Operate the shared visible browser through semantic snapshots and browser tools.', instructions: 'Operate the shared visible browser through semantic snapshots and browser tools.' },
  { id: 'builtin:release', scope: 'builtin', name: 'Release management', description: 'Prepare release notes, rollout checks, risk controls, and post-release verification.', instructions: 'Prepare release notes, rollout checks, risk controls, and post-release verification.' },
  { id: 'builtin:memory', scope: 'builtin', name: 'Organizational memory', description: 'Capture durable decisions and lessons for future agents without leaking company context.', instructions: 'Capture durable decisions and lessons for future agents without leaking company context.' },
]

function createInitialSnapshot(): OrganizationSnapshot {
  const companyId = 'company-demo'
  const projectId = 'project-core'
  const now = Date.now()

  const company: Company = {
    id: companyId,
    name: 'ND AI Labs',
    mission: 'Build an autonomous AI company operating system powered by DeepSeek Harness.',
    autonomyLevel: 2,
    status: 'active',
    createdAt: now - 86400000,
    updatedAt: now,
  }

  const roles: OrganizationRole[] = [
    { id: 'role-pm', companyId, name: 'Product Manager', responsibility: 'Own outcomes, roadmaps, prioritization, delegation, risks, and acceptance.', systemPrompt: 'Act as the company project manager.', skillIds: ['builtin:strategy', 'builtin:project-plan', 'builtin:task-breakdown', 'builtin:memory'] },
    { id: 'role-eng', companyId, name: 'Software Engineer', responsibility: 'Implement assigned project work safely and verify it.', systemPrompt: 'Inspect the workspace, implement the assigned outcome, and run verification.', skillIds: ['builtin:implementation', 'builtin:qa', 'builtin:browser'] },
    { id: 'role-rev', companyId, name: 'Reviewer', responsibility: 'Independently verify completed work.', systemPrompt: 'Review work independently against requirements, tests, and security.', skillIds: ['builtin:review', 'builtin:qa'] },
    { id: 'role-res', companyId, name: 'Researcher', responsibility: 'Research product, technical, and operational questions.', systemPrompt: 'Research current evidence and produce decision-ready findings.', skillIds: ['builtin:research', 'builtin:browser'] },
  ]

  const teams: Team[] = [
    { id: 'team-product', companyId, name: 'Product', purpose: 'Plans company and project outcomes.', roleIds: ['role-pm'], skillIds: ['builtin:strategy', 'builtin:project-plan'] },
    { id: 'team-eng', companyId, name: 'Engineering', purpose: 'Builds and validates product work.', roleIds: ['role-eng'], skillIds: ['builtin:implementation', 'builtin:qa'] },
    { id: 'team-quality', companyId, name: 'Quality & Research', purpose: 'Reviews work and resolves unknowns.', roleIds: ['role-rev', 'role-res'], skillIds: ['builtin:review', 'builtin:research'] },
  ]

  const agents: OrganizationAgent[] = [
    { id: 'agent-pm', companyId, name: 'AI PM', roleId: 'role-pm', teamId: 'team-product', status: 'idle', skillIds: [] },
    { id: 'agent-builder', companyId, name: 'Builder', roleId: 'role-eng', teamId: 'team-eng', status: 'idle', skillIds: [] },
    { id: 'agent-reviewer', companyId, name: 'Reviewer', roleId: 'role-rev', teamId: 'team-quality', status: 'idle', skillIds: [] },
    { id: 'agent-researcher', companyId, name: 'Researcher', roleId: 'role-res', teamId: 'team-quality', status: 'idle', skillIds: [] },
  ]

  const project: Project = {
    id: projectId,
    companyId,
    name: 'ND-DSH Shell',
    objective: 'Create a cursor-style IDE desktop and web workbench with AI Company OS orchestration.',
    status: 'active',
    repoUrls: ['https://github.com/deepseek-ai/deepseek-harness'],
    teamIds: ['team-product', 'team-eng', 'team-quality'],
    progress: 50,
    createdAt: now - 43200000,
    updatedAt: now,
  }

  const goals: OrganizationGoal[] = [
    { id: 'goal-1', companyId, projectId, title: 'AI Company Operating System', description: 'Enable multi-agent planning, autonomous delegation, and review loop.', status: 'active', progress: 50, createdAt: now - 36000000 },
  ]

  const tasks: OrganizationTask[] = [
    { id: 'task-1', companyId, projectId, goalId: 'goal-1', title: 'Design Organization State Schema', description: 'Define TypeScript contracts for companies, projects, teams, agents, and tasks.', acceptanceCriteria: ['Contracts exported and shared across main, preload, and renderer.'], priority: 'high', status: 'completed', dependsOn: [], assignedAgentId: 'agent-builder', createdAt: now - 30000000, updatedAt: now - 20000000 },
    { id: 'task-2', companyId, projectId, goalId: 'goal-1', title: 'Build Organization Dashboard UI', description: 'Interactive tabs for Overview, Work Board, Workforce, and Knowledge/Policies.', acceptanceCriteria: ['All 4 views render correctly with live updates.'], priority: 'high', status: 'ready', dependsOn: ['task-1'], assignedAgentId: 'agent-builder', createdAt: now - 20000000, updatedAt: now - 10000000 },
    { id: 'task-3', companyId, projectId, goalId: 'goal-1', title: 'Connect Autonomous Review Loop', description: 'Automated verification and independent reviewer agent signoff before completion.', acceptanceCriteria: ['Completed tasks transition through review phase.'], priority: 'medium', status: 'backlog', dependsOn: ['task-2'], assignedAgentId: 'agent-reviewer', createdAt: now - 10000000, updatedAt: now },
  ]

  const policies: OrganizationPolicy[] = [
    { id: 'pol-1', companyId, action: 'internal.plan', effect: 'allow', description: 'AI managers may create plans, goals, milestones, and internal tasks.' },
    { id: 'pol-2', companyId, action: 'task.execute', effect: 'allow', description: 'AI workers may execute internal project tasks.' },
    { id: 'pol-3', companyId, action: 'task.review', effect: 'allow', description: 'Independent reviewers may inspect and validate completed work.' },
    { id: 'pol-4', companyId, action: 'external.publish', effect: 'ask', description: 'Publishing content or messages outside the company requires human approval.' },
    { id: 'pol-5', companyId, action: 'production.deploy', effect: 'ask', description: 'Production deployment requires human approval.' },
    { id: 'pol-6', companyId, action: 'money.spend', effect: 'ask', description: 'Purchases and paid actions require human approval.' },
    { id: 'pol-7', companyId, action: 'data.destructive', effect: 'deny', description: 'Destructive production data operations are denied by default.' },
  ]

  const memory: MemoryEntry[] = [
    { id: 'mem-1', companyId, projectId, title: 'Pinned Harness Core Architecture', content: 'DeepSeek Harness remains a pinned submodule; nd-dsh extends it via overlay patches and gateway RPCs.', tags: ['architecture', 'harness'], source: 'human', createdAt: now - 24000000, updatedAt: now - 24000000 },
  ]

  const activity: OrganizationActivity[] = [
    { id: 'act-1', companyId, projectId, type: 'company.created', message: 'Initialized ND AI Labs with AI PM, Builder, and Reviewer.', createdAt: now - 86400000 },
  ]

  return {
    version: 1,
    activeCompanyId: companyId,
    activeProjectId: projectId,
    companies: [company],
    projects: [project],
    roles,
    teams,
    agents,
    skills: BUILTIN_SKILLS,
    workflows: [
      {
        id: 'wf-1',
        companyId,
        scope: 'company',
        name: 'Plan → Execute → Review',
        steps: [
          { id: 's1', name: 'AI PM plans work', kind: 'plan', requiredRole: 'Product Manager' },
          { id: 's2', name: 'Assigned worker executes', kind: 'execute', requiredRole: 'Software Engineer' },
          { id: 's3', name: 'Independent reviewer validates', kind: 'review', requiredRole: 'Reviewer' },
        ] as WorkflowStep[],
      },
    ],
    goals,
    milestones: [
      { id: 'ms-1', companyId, projectId, goalId: 'goal-1', title: 'Phase 1: Organization Core', description: 'Foundation for AI Company OS', status: 'active', order: 0 },
    ],
    tasks,
    memory,
    policies,
    activity,
    runs: [],
  }
}

function uid(): string {
  return `mock-${Math.random().toString(36).slice(2, 11)}`
}

export class MockOrganizationService implements OrganizationDesktopApi {
  private snapshot: OrganizationSnapshot
  private listeners = new Set<(state: OrganizationSnapshot) => void>()

  constructor() {
    this.snapshot = this.load()
  }

  private load(): OrganizationSnapshot {
    try {
      const item = localStorage.getItem(STORAGE_KEY)
      if (item) {
        const parsed = JSON.parse(item) as OrganizationSnapshot
        if (parsed?.version === 1) {
          return { ...parsed, skills: BUILTIN_SKILLS }
        }
      }
    } catch {
      // Storage unavailable or corrupted
    }
    return createInitialSnapshot()
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot))
    } catch {
      // Storage unavailable
    }
    this.emit()
  }

  private emit(): void {
    const copy = structuredClone(this.snapshot)
    for (const listener of this.listeners) {
      listener(copy)
    }
  }

  async state(): Promise<OrganizationSnapshot> {
    return structuredClone(this.snapshot)
  }

  async mutate(mutation: OrganizationMutation): Promise<OrganizationSnapshot> {
    const now = Date.now()
    switch (mutation.type) {
      case 'company.create': {
        const id = uid()
        const company: Company = {
          id,
          name: mutation.name.trim() || 'New Company',
          mission: mutation.mission.trim() || '',
          autonomyLevel: 2,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        }
        this.snapshot.companies.push(company)
        this.snapshot.activeCompanyId = id
        break
      }
      case 'company.update': {
        const company = this.snapshot.companies.find((c) => c.id === mutation.id)
        if (company) {
          Object.assign(company, mutation.patch, { updatedAt: now })
        }
        break
      }
      case 'company.activate': {
        this.snapshot.activeCompanyId = mutation.id
        const firstProject = this.snapshot.projects.find((p) => p.companyId === mutation.id)
        if (firstProject) {
          this.snapshot.activeProjectId = firstProject.id
        } else {
          delete this.snapshot.activeProjectId
        }
        break
      }
      case 'project.create': {
        const id = uid()
        const project: Project = {
          id,
          companyId: mutation.companyId,
          name: mutation.name.trim() || 'New Project',
          objective: mutation.objective.trim() || '',
          status: 'planning',
          repoUrls: mutation.repoUrls ?? [],
          teamIds: [],
          progress: 0,
          ...(mutation.workspacePath?.trim() ? { workspacePath: mutation.workspacePath.trim() } : {}),
          createdAt: now,
          updatedAt: now,
        }
        this.snapshot.projects.push(project)
        this.snapshot.activeProjectId = id
        break
      }
      case 'project.update': {
        const project = this.snapshot.projects.find((p) => p.id === mutation.id)
        if (project) {
          Object.assign(project, mutation.patch, { updatedAt: now })
        }
        break
      }
      case 'project.activate': {
        this.snapshot.activeProjectId = mutation.id
        const project = this.snapshot.projects.find((p) => p.id === mutation.id)
        if (project) this.snapshot.activeCompanyId = project.companyId
        break
      }
      case 'task.create': {
        const id = uid()
        const defaultAgent = this.snapshot.agents.find((a) => a.companyId === mutation.companyId)?.id
        const assignedAgentId = mutation.assignedAgentId ?? defaultAgent
        const task: OrganizationTask = {
          id,
          companyId: mutation.companyId,
          projectId: mutation.projectId,
          title: mutation.title.trim() || 'Untitled Task',
          description: mutation.description.trim() || '',
          priority: mutation.priority ?? 'medium',
          status: 'ready',
          acceptanceCriteria: mutation.acceptanceCriteria ?? ['Completed and verified.'],
          dependsOn: mutation.dependsOn ?? [],
          ...(mutation.goalId ? { goalId: mutation.goalId } : {}),
          ...(mutation.milestoneId ? { milestoneId: mutation.milestoneId } : {}),
          ...(assignedAgentId ? { assignedAgentId } : {}),
          createdAt: now,
          updatedAt: now,
        }
        this.snapshot.tasks.push(task)
        break
      }
      case 'task.update': {
        const task = this.snapshot.tasks.find((t) => t.id === mutation.id)
        if (task) {
          Object.assign(task, mutation.patch, { updatedAt: now })
        }
        break
      }
      case 'memory.add': {
        const id = uid()
        const memoryEntry: MemoryEntry = {
          id,
          companyId: mutation.companyId,
          title: mutation.title.trim() || 'Untitled Memory',
          content: mutation.content.trim() || '',
          tags: mutation.tags ?? [],
          source: 'human',
          ...(mutation.projectId ? { projectId: mutation.projectId } : {}),
          createdAt: now,
          updatedAt: now,
        }
        this.snapshot.memory.push(memoryEntry)
        break
      }
      case 'policy.set': {
        const policy = this.snapshot.policies.find((p) => p.companyId === mutation.companyId && p.action === mutation.action)
        if (policy) {
          policy.effect = mutation.effect
          if (mutation.description) policy.description = mutation.description
        } else {
          this.snapshot.policies.push({
            id: uid(),
            companyId: mutation.companyId,
            action: mutation.action,
            effect: mutation.effect,
            description: mutation.description ?? mutation.action,
          })
        }
        break
      }
      default:
        break
    }
    this.save()
    return structuredClone(this.snapshot)
  }

  async planProject(projectId: string): Promise<OrganizationRunReceipt> {
    const project = this.snapshot.projects.find((p) => p.id === projectId)
    if (!project) throw new Error('Project not found')
    const runId = uid()
    const now = Date.now()

    const goalId = uid()
    this.snapshot.goals.push({
      id: goalId,
      companyId: project.companyId,
      projectId: project.id,
      title: `Plan: ${project.name}`,
      description: project.objective,
      status: 'active',
      progress: 0,
      createdAt: now,
    })

    const defaultAgent = this.snapshot.agents.find((a) => a.companyId === project.companyId)?.id
    const sampleTasks: OrganizationTask[] = [
      {
        id: uid(),
        companyId: project.companyId,
        projectId: project.id,
        goalId,
        title: 'Analyze project scope & prerequisites',
        description: 'Explore workspace requirements and establish implementation architecture.',
        priority: 'high',
        status: 'ready',
        acceptanceCriteria: ['Architecture documented and verified.'],
        dependsOn: [],
        ...(defaultAgent ? { assignedAgentId: defaultAgent } : {}),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uid(),
        companyId: project.companyId,
        projectId: project.id,
        goalId,
        title: 'Core feature development',
        description: 'Implement core functionality based on the agreed plan.',
        priority: 'medium',
        status: 'backlog',
        acceptanceCriteria: ['Code implemented and tests passing.'],
        dependsOn: [],
        ...(defaultAgent ? { assignedAgentId: defaultAgent } : {}),
        createdAt: now,
        updatedAt: now,
      },
    ]
    this.snapshot.tasks.push(...sampleTasks)

    const run: OrganizationRun = {
      id: runId,
      companyId: project.companyId,
      projectId: project.id,
      kind: 'pm-plan',
      status: 'completed',
      sessionId: `mock-sess-${runId}`,
      startedAt: now,
      completedAt: now + 500,
    }
    this.snapshot.runs.unshift(run)
    this.save()

    return {
      runId,
      sessionId: run.sessionId,
      projectId: project.id,
      kind: 'pm-plan',
    }
  }

  async runTask(taskId: string): Promise<OrganizationRunReceipt> {
    const task = this.snapshot.tasks.find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    const runId = uid()
    const now = Date.now()

    task.status = 'in_progress'
    task.executionSessionId = `mock-exec-${runId}`
    task.updatedAt = now

    const run: OrganizationRun = {
      id: runId,
      companyId: task.companyId,
      projectId: task.projectId,
      taskId: task.id,
      kind: 'task-execution',
      status: 'running',
      sessionId: task.executionSessionId,
      startedAt: now,
    }
    this.snapshot.runs.unshift(run)
    this.save()

    // Simulate completion to review
    setTimeout(() => {
      task.status = 'review'
      task.resultSummary = `Task “${task.title}” executed successfully in preview mode.`
      task.updatedAt = Date.now()
      run.status = 'completed'
      run.completedAt = Date.now()
      this.save()
    }, 1500)

    return {
      runId,
      sessionId: run.sessionId,
      projectId: task.projectId,
      taskId: task.id,
      kind: 'task-execution',
    }
  }

  async reviewTask(taskId: string): Promise<OrganizationRunReceipt> {
    const task = this.snapshot.tasks.find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    const runId = uid()
    const now = Date.now()

    task.reviewSessionId = `mock-rev-${runId}`
    task.updatedAt = now

    const run: OrganizationRun = {
      id: runId,
      companyId: task.companyId,
      projectId: task.projectId,
      taskId: task.id,
      kind: 'task-review',
      status: 'running',
      sessionId: task.reviewSessionId,
      startedAt: now,
    }
    this.snapshot.runs.unshift(run)
    this.save()

    // Simulate review signoff
    setTimeout(() => {
      task.status = 'completed'
      task.reviewSummary = `Reviewer approved task “${task.title}”. All criteria met.`
      task.updatedAt = Date.now()
      run.status = 'completed'
      run.completedAt = Date.now()
      this.save()
    }, 1200)

    return {
      runId,
      sessionId: run.sessionId,
      projectId: task.projectId,
      taskId: task.id,
      kind: 'task-review',
    }
  }

  async runNext(projectId?: string): Promise<OrganizationRunReceipt | null> {
    const targetProject = projectId
      ? this.snapshot.projects.find((p) => p.id === projectId)
      : this.snapshot.projects[0]
    if (!targetProject) return null

    const readyTask = this.snapshot.tasks.find((t) => t.projectId === targetProject.id && (t.status === 'ready' || t.status === 'backlog'))
    if (!readyTask) return null

    return this.runTask(readyTask.id)
  }

  onChanged(listener: (state: OrganizationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
