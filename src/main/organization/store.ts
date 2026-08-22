import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AgentStatus,
  Company,
  MemoryEntry,
  OrganizationActivity,
  OrganizationAgent,
  OrganizationMutation,
  OrganizationPolicy,
  OrganizationRole,
  OrganizationRun,
  OrganizationRunKind,
  OrganizationSkill,
  OrganizationSnapshot,
  OrganizationTask,
  OrganizationWorkflow,
  Project,
  ProjectPlanInput,
  Team,
  TaskStatus,
} from '../../shared/organization.js'
import { BUILTIN_SKILLS, defaultPolicies, defaultWorkflow } from './defaults.js'

const EMPTY: OrganizationSnapshot = {
  version: 1,
  companies: [], projects: [], roles: [], teams: [], agents: [], skills: BUILTIN_SKILLS,
  workflows: [], goals: [], milestones: [], tasks: [], memory: [], policies: [], activity: [], runs: [],
}

const SNAPSHOT_ARRAY_KEYS = [
  'companies', 'projects', 'roles', 'teams', 'agents', 'skills', 'workflows',
  'goals', 'milestones', 'tasks', 'memory', 'policies', 'activity', 'runs',
] as const

export class OrganizationStore {
  private loaded = false
  private loadPromise: Promise<void> | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private value: OrganizationSnapshot = clone(EMPTY)
  private onChanged: ((state: OrganizationSnapshot) => void) | undefined

  constructor(private readonly filePath: string) {}

  setOnChanged(listener: ((state: OrganizationSnapshot) => void) | undefined): void {
    this.onChanged = listener
  }

  async state(): Promise<OrganizationSnapshot> {
    await this.load()
    return clone(this.value)
  }

  async mutate(mutation: OrganizationMutation): Promise<OrganizationSnapshot> {
    await this.load()
    switch (mutation.type) {
      case 'company.create': this.createCompany(mutation.name, mutation.mission); break
      case 'company.update': this.updateCompany(mutation.id, mutation.patch); break
      case 'company.activate': this.activateCompany(mutation.id); break
      case 'project.create': this.createProject(mutation); break
      case 'project.update': this.updateProject(mutation.id, mutation.patch); break
      case 'project.activate': this.activateProject(mutation.id); break
      case 'team.create': this.createTeam(mutation); break
      case 'role.create': this.createRole(mutation); break
      case 'agent.create': this.createAgent(mutation); break
      case 'skill.create': this.createSkill(mutation); break
      case 'workflow.create': this.createWorkflow(mutation); break
      case 'goal.create': this.createGoal(mutation); break
      case 'task.create': this.createTask(mutation); break
      case 'task.update': this.updateTask(mutation.id, mutation.patch); break
      case 'memory.add': this.addMemory({ ...mutation, source: 'human' }); break
      case 'policy.set': this.setPolicy(mutation); break
    }
    await this.save()
    return clone(this.value)
  }

  async applyPlan(projectId: string, plan: ProjectPlanInput): Promise<void> {
    await this.load()
    const project = this.project(projectId)
    const companyId = project.companyId
    const goalId = randomUUID()
    this.value.goals.push({ id: goalId, companyId, projectId, title: clean(plan.goal.title), description: clean(plan.goal.description), status: 'active', progress: 0, createdAt: Date.now() })
    const taskIdsByTitle = new Map<string, string>()
    for (const milestoneInput of plan.milestones) {
      const milestoneId = randomUUID()
      const order = this.value.milestones.filter((item) => item.projectId === projectId).length
      this.value.milestones.push({ id: milestoneId, companyId, projectId, goalId, title: clean(milestoneInput.title), description: clean(milestoneInput.description), status: 'pending', order })
      for (const input of milestoneInput.tasks) {
        const id = randomUUID()
        taskIdsByTitle.set(input.title.trim().toLowerCase(), id)
        const agent = this.pickAgent(companyId, input.role)
        if (agent?.teamId && !project.teamIds.includes(agent.teamId)) project.teamIds.push(agent.teamId)
        this.value.tasks.push({
          id, companyId, projectId, goalId, milestoneId,
          title: clean(input.title), description: clean(input.description),
          acceptanceCriteria: input.acceptanceCriteria?.map(clean).filter(Boolean) ?? ['Requested outcome is implemented and verified.'],
          priority: input.priority ?? 'medium', status: 'backlog', dependsOn: input.dependsOn ?? [],
          ...(agent ? { assignedAgentId: agent.id } : {}), createdAt: Date.now(), updatedAt: Date.now(),
        })
      }
    }
    for (const task of this.value.tasks.filter((item) => item.goalId === goalId)) {
      task.dependsOn = task.dependsOn.map((value) => taskIdsByTitle.get(value.trim().toLowerCase()) ?? value)
    }
    for (const item of plan.memory ?? []) this.addMemory({ companyId, projectId, title: item.title, content: item.content, ...(item.tags ? { tags: item.tags } : {}), source: 'pm' })
    this.refreshProject(projectId)
    this.activity(companyId, projectId, 'pm.plan', `AI PM created “${plan.goal.title}” with ${plan.milestones.length} milestone(s).`)
    await this.save()
  }

  async taskContext(taskId: string): Promise<{ task: OrganizationTask; project: Project; company: Company; agent?: OrganizationAgent; role?: OrganizationRole; skills: OrganizationSkill[]; memory: MemoryEntry[]; policies: OrganizationPolicy[] }> {
    await this.load()
    const task = this.task(taskId)
    const project = this.project(task.projectId)
    const company = this.company(task.companyId)
    const agent = task.assignedAgentId ? this.value.agents.find((item) => item.id === task.assignedAgentId) : undefined
    const role = agent ? this.value.roles.find((item) => item.id === agent.roleId) : undefined
    const teamSkills = this.value.teams.find((item) => item.id === agent?.teamId)?.skillIds ?? []
    const ids = new Set([...(agent?.skillIds ?? []), ...(role?.skillIds ?? []), ...teamSkills])
    const skills = this.value.skills.filter((skill) => skill.scope === 'builtin' || ids.has(skill.id) || skill.companyId === company.id || skill.projectId === project.id)
    const memory = this.value.memory.filter((entry) => entry.companyId === company.id && (!entry.projectId || entry.projectId === project.id)).slice(-30)
    const policies = this.value.policies.filter((item) => item.companyId === company.id)
    return { task: clone(task), project: clone(project), company: clone(company), ...(agent ? { agent: clone(agent) } : {}), ...(role ? { role: clone(role) } : {}), skills: clone(skills), memory: clone(memory), policies: clone(policies) }
  }

  async projectContext(projectId: string): Promise<{ project: Project; company: Company; roles: OrganizationRole[]; teams: Team[]; memory: MemoryEntry[]; policies: OrganizationPolicy[] }> {
    await this.load()
    const project = this.project(projectId)
    const company = this.company(project.companyId)
    return {
      project: clone(project), company: clone(company),
      roles: clone(this.value.roles.filter((item) => item.companyId === company.id)),
      teams: clone(this.value.teams.filter((item) => item.companyId === company.id)),
      memory: clone(this.value.memory.filter((entry) => entry.companyId === company.id && (!entry.projectId || entry.projectId === project.id)).slice(-30)),
      policies: clone(this.value.policies.filter((item) => item.companyId === company.id)),
    }
  }

  async policy(companyId: string, action: string): Promise<OrganizationPolicy['effect']> {
    await this.load()
    return this.value.policies.find((item) => item.companyId === companyId && item.action === action)?.effect ?? 'ask'
  }

  async workflowForProject(projectId: string): Promise<OrganizationWorkflow | undefined> {
    await this.load()
    const project = this.project(projectId)
    const projectWorkflow = this.value.workflows.filter((item) => item.companyId === project.companyId && item.projectId === projectId).at(-1)
    const companyWorkflow = this.value.workflows.filter((item) => item.companyId === project.companyId && !item.projectId).at(-1)
    const workflow = projectWorkflow ?? companyWorkflow
    return workflow ? clone(workflow) : undefined
  }

  async activeRun(projectId: string): Promise<OrganizationRun | undefined> {
    await this.load()
    const found = this.value.runs.find((item) => item.projectId === projectId && item.status === 'running')
    return found ? clone(found) : undefined
  }

  async runBySession(sessionId: string): Promise<OrganizationRun | undefined> {
    await this.load()
    const found = this.value.runs.find((item) => item.sessionId === sessionId && item.status === 'running')
    return found ? clone(found) : undefined
  }

  async executionAttemptCount(taskId: string): Promise<number> {
    await this.load()
    this.task(taskId)
    return this.value.runs.filter((item) => item.taskId === taskId && item.kind === 'task-execution').length
  }

  async beginRun(kind: OrganizationRunKind, companyId: string, projectId: string, sessionId: string, taskId?: string, goalId?: string): Promise<OrganizationRun> {
    await this.load()
    this.company(companyId); this.project(projectId)
    const active = this.value.runs.find((item) => item.status === 'running')
    if (active) throw new Error(`Another organization run is already active in session ${active.sessionId}`)
    const run: OrganizationRun = { id: randomUUID(), companyId, projectId, kind, status: 'running', sessionId, ...(taskId ? { taskId } : {}), ...(goalId ? { goalId } : {}), startedAt: Date.now() }
    this.value.runs.unshift(run)
    this.activity(companyId, projectId, `run.${kind}`, `${kind} started in session ${short(sessionId)}.`)
    await this.save()
    return clone(run)
  }

  async completeRun(runId: string, output?: string, error?: string): Promise<void> {
    await this.load()
    const run = must(this.value.runs.find((item) => item.id === runId), 'Organization run')
    run.status = error ? 'failed' : 'completed'
    if (output) run.output = output.slice(0, 40_000)
    if (error) run.error = error.slice(0, 8_000)
    run.completedAt = Date.now()
    await this.save()
  }

  /**
   * A desktop restart means no in-memory Harness turn can still be running.
   * Convert persisted running receipts into explicit failed/interrupted work so
   * they cannot permanently lock the company. Tasks remain retryable but never
   * auto-resume partially applied workspace changes without the user seeing it.
   */
  async reconcileInterruptedRuns(reason = 'ND-DSH restarted before the run finished.'): Promise<number> {
    await this.load()
    const running = this.value.runs.filter((item) => item.status === 'running')
    if (running.length === 0) return 0

    const now = Date.now()
    const message = reason.trim() || 'ND-DSH restarted before the run finished.'
    const projects = new Set<string>()
    for (const run of running) {
      run.status = 'failed'
      run.error = `Interrupted: ${message}`.slice(0, 8_000)
      run.completedAt = now
      projects.add(run.projectId)

      if (run.taskId) {
        const task = this.value.tasks.find((item) => item.id === run.taskId)
        if (task) {
          if (run.kind === 'task-review') {
            task.status = 'review'
            delete task.reviewSessionId
          } else {
            task.status = 'blocked'
            const interruption = `Execution interrupted: ${message}`
            task.reviewSummary = [task.reviewSummary, interruption].filter(Boolean).join('\n\n').slice(0, 20_000)
          }
          task.updatedAt = now
          for (const agent of this.value.agents.filter((item) => item.currentTaskId === task.id && (item.status === 'working' || item.status === 'reviewing'))) {
            this.setAgent(agent.id, 'idle')
          }
        }
      }

      this.activity(run.companyId, run.projectId, 'run.interrupted', `${run.kind} in session ${short(run.sessionId)} was interrupted by an app restart.`)
    }

    for (const projectId of projects) this.refreshProject(projectId)
    await this.save()
    return running.length
  }

  async markExecution(taskId: string, sessionId: string): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    task.status = 'in_progress'; task.executionSessionId = sessionId; delete task.reviewSessionId; task.updatedAt = Date.now()
    this.setAgent(task.assignedAgentId, 'working', task.id, sessionId)
    this.activity(task.companyId, task.projectId, 'task.execute', `Started “${task.title}”.`)
    await this.save()
  }

  async markForReview(taskId: string, summary: string): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    task.status = 'review'; task.resultSummary = summary.slice(0, 20_000); task.updatedAt = Date.now()
    this.setAgent(task.assignedAgentId, 'idle')
    this.activity(task.companyId, task.projectId, 'task.review-ready', `“${task.title}” is ready for independent review.`)
    this.refreshProject(task.projectId)
    await this.save()
  }

  async markReviewStarted(taskId: string, sessionId: string): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    task.reviewSessionId = sessionId; task.updatedAt = Date.now()
    const reviewer = this.pickAgent(task.companyId, 'review')
    this.setAgent(reviewer?.id, 'reviewing', task.id, sessionId)
    await this.save()
  }

  async completeReview(taskId: string, passed: boolean, summary: string, memories: Array<{ title: string; content: string; tags?: string[] }> = []): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    task.status = passed ? 'completed' : 'blocked'; task.reviewSummary = summary.slice(0, 20_000); task.updatedAt = Date.now()
    const reviewer = this.value.agents.find((agent) => agent.status === 'reviewing' && agent.currentTaskId === task.id)
    this.setAgent(reviewer?.id, 'idle')
    this.addMemory({
      companyId: task.companyId,
      projectId: task.projectId,
      title: `Review: ${task.title}`,
      content: summary,
      tags: ['review', passed ? 'passed' : 'failed'],
      source: 'reviewer',
    })
    for (const item of memories) this.addMemory({ companyId: task.companyId, projectId: task.projectId, title: item.title, content: item.content, ...(item.tags ? { tags: item.tags } : {}), source: 'reviewer' })
    this.activity(task.companyId, task.projectId, passed ? 'task.completed' : 'task.blocked', `${passed ? 'Passed' : 'Failed'} review: “${task.title}”.`)
    this.refreshProject(task.projectId)
    await this.save()
  }

  async queueRework(taskId: string, reason: string): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    if (task.status !== 'blocked') throw new Error('Only a blocked task can be queued for rework')
    task.status = 'ready'
    task.updatedAt = Date.now()
    this.activity(task.companyId, task.projectId, 'task.rework', `Queued rework for “${task.title}”: ${reason.slice(0, 500)}`)
    this.refreshProject(task.projectId)
    await this.save()
  }

  async completeWithoutReview(taskId: string, summary: string): Promise<void> {
    await this.load()
    const task = this.task(taskId)
    task.status = 'completed'
    task.resultSummary = summary.slice(0, 20_000)
    task.reviewSummary = 'Completed by workflow without an independent review step.'
    task.updatedAt = Date.now()
    this.setAgent(task.assignedAgentId, 'idle')
    this.addMemory({
      companyId: task.companyId,
      projectId: task.projectId,
      title: `Task result: ${task.title}`,
      content: summary,
      tags: ['task', 'completed', 'no-review'],
      source: 'worker',
    })
    this.activity(task.companyId, task.projectId, 'task.completed', `Completed “${task.title}” without a review step.`)
    this.refreshProject(task.projectId)
    await this.save()
  }

  async nextReadyTask(projectId: string): Promise<OrganizationTask | undefined> {
    await this.load(); this.refreshProject(projectId)
    const task = this.value.tasks.filter((item) => item.projectId === projectId && item.status === 'ready').sort((a, b) => priority(b.priority) - priority(a.priority) || a.createdAt - b.createdAt)[0]
    return task ? clone(task) : undefined
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    const pending = this.loadFromDisk()
    this.loadPromise = pending
    try {
      await pending
    } finally {
      this.loadPromise = undefined
    }
  }

  private async loadFromDisk(): Promise<void> {
    let primaryError: unknown
    try {
      this.value = await this.readSnapshot(this.filePath)
      this.loaded = true
      return
    } catch (error) {
      primaryError = error
    }

    const backupPath = this.backupPath()
    try {
      this.value = await this.readSnapshot(backupPath)
      this.loaded = true
      console.warn(`Recovered organization state from backup after primary load failed: ${errorMessage(primaryError)}`)
      await this.save()
      return
    } catch (backupError) {
      if (isMissing(primaryError) && isMissing(backupError)) {
        this.loaded = true
        return
      }
      throw new Error(`Organization state could not be loaded. Primary: ${errorMessage(primaryError)}. Backup: ${errorMessage(backupError)}.`)
    }
  }

  private async readSnapshot(path: string): Promise<OrganizationSnapshot> {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as unknown
    return normalizeSnapshot(parsed)
  }

  private async save(): Promise<void> {
    const snapshot = clone(this.value)
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    const write = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      await writeAtomic(this.filePath, serialized)
      try {
        await writeAtomic(this.backupPath(), serialized)
      } catch (error) {
        console.warn('Failed to persist organization backup:', error)
      }
      this.onChanged?.(clone(snapshot))
    })
    this.saveChain = write
    return write
  }

  private backupPath(): string {
    return `${this.filePath}.bak`
  }

  private createCompany(name: string, mission: string): void {
    const now = Date.now(); const id = randomUUID()
    const company: Company = { id, name: clean(name), mission: clean(mission), autonomyLevel: 2, status: 'active', createdAt: now, updatedAt: now }
    this.value.companies.push(company); this.value.activeCompanyId = id; delete this.value.activeProjectId
    const productRole = this.seedRole(id, 'Product Manager', 'Own outcomes, roadmaps, prioritization, delegation, risks, and acceptance.', 'Act as the company project manager. Convert goals into executable work and keep the organization aligned.', ['builtin:strategy', 'builtin:project-plan', 'builtin:task-breakdown', 'builtin:memory'])
    const engineerRole = this.seedRole(id, 'Software Engineer', 'Implement assigned project work safely and verify it.', 'Inspect the workspace, implement the assigned outcome, run relevant validation, and report concrete results.', ['builtin:implementation', 'builtin:qa', 'builtin:browser'])
    const reviewerRole = this.seedRole(id, 'Reviewer', 'Independently verify completed work.', 'Review work independently against requirements, tests, regressions, and maintainability. Never rubber-stamp.', ['builtin:review', 'builtin:qa'])
    const researcherRole = this.seedRole(id, 'Researcher', 'Research product, technical, market, and operational questions.', 'Research current evidence and produce concise decision-ready findings.', ['builtin:research', 'builtin:browser'])
    const productTeam = this.seedTeam(id, 'Product', 'Plans company and project outcomes.', [productRole.id], ['builtin:strategy', 'builtin:project-plan'])
    const engineeringTeam = this.seedTeam(id, 'Engineering', 'Builds and validates product work.', [engineerRole.id], ['builtin:implementation', 'builtin:qa'])
    const qualityTeam = this.seedTeam(id, 'Quality & Research', 'Reviews work and resolves unknowns.', [reviewerRole.id, researcherRole.id], ['builtin:review', 'builtin:research'])
    this.seedAgent(id, 'AI PM', productRole.id, productTeam.id)
    this.seedAgent(id, 'Builder', engineerRole.id, engineeringTeam.id)
    this.seedAgent(id, 'Reviewer', reviewerRole.id, qualityTeam.id)
    this.seedAgent(id, 'Researcher', researcherRole.id, qualityTeam.id)
    this.value.workflows.push(defaultWorkflow(id)); this.value.policies.push(...defaultPolicies(id))
    this.activity(id, undefined, 'company.created', `Created ${company.name} with a default AI workforce and safety policy.`)
  }

  private updateCompany(id: string, patch: Partial<Pick<Company, 'name' | 'mission' | 'autonomyLevel' | 'status'>>): void {
    const company = this.company(id); Object.assign(company, patch); company.name = clean(company.name); company.mission = clean(company.mission); company.updatedAt = Date.now()
  }
  private activateCompany(id: string): void { this.company(id); this.value.activeCompanyId = id; const project = this.value.projects.find((item) => item.companyId === id); if (project) this.value.activeProjectId = project.id; else delete this.value.activeProjectId }
  private createProject(input: Extract<OrganizationMutation, { type: 'project.create' }>): void {
    this.company(input.companyId); const now = Date.now(); const project: Project = { id: randomUUID(), companyId: input.companyId, name: clean(input.name), objective: clean(input.objective), status: 'planning', repoUrls: input.repoUrls?.map(clean).filter(Boolean) ?? [], teamIds: [], progress: 0, ...(input.workspacePath?.trim() ? { workspacePath: input.workspacePath.trim() } : {}), createdAt: now, updatedAt: now }
    this.value.projects.push(project); this.value.activeCompanyId = input.companyId; this.value.activeProjectId = project.id; this.activity(input.companyId, project.id, 'project.created', `Created project “${project.name}”.`)
  }
  private updateProject(id: string, patch: Extract<OrganizationMutation, { type: 'project.update' }>['patch']): void { const project = this.project(id); Object.assign(project, patch); project.name = clean(project.name); project.objective = clean(project.objective); project.updatedAt = Date.now() }
  private activateProject(id: string): void { const project = this.project(id); this.value.activeProjectId = id; this.value.activeCompanyId = project.companyId }
  private createTeam(input: Extract<OrganizationMutation, { type: 'team.create' }>): void { this.company(input.companyId); for (const roleId of input.roleIds ?? []) this.assertRoleCompany(roleId, input.companyId); this.value.teams.push({ id: randomUUID(), companyId: input.companyId, name: clean(input.name), purpose: clean(input.purpose), roleIds: input.roleIds ?? [], skillIds: input.skillIds ?? [] }) }
  private createRole(input: Extract<OrganizationMutation, { type: 'role.create' }>): void { this.company(input.companyId); this.value.roles.push({ id: randomUUID(), companyId: input.companyId, name: clean(input.name), responsibility: clean(input.responsibility), systemPrompt: clean(input.systemPrompt), skillIds: input.skillIds ?? [] }) }
  private createAgent(input: Extract<OrganizationMutation, { type: 'agent.create' }>): void { this.company(input.companyId); this.assertRoleCompany(input.roleId, input.companyId); if (input.teamId) this.assertTeamCompany(input.teamId, input.companyId); this.value.agents.push({ id: randomUUID(), companyId: input.companyId, name: clean(input.name), roleId: input.roleId, status: 'idle', skillIds: input.skillIds ?? [], ...(input.teamId ? { teamId: input.teamId } : {}) }) }
  private createSkill(input: Extract<OrganizationMutation, { type: 'skill.create' }>): void { const companyId = input.companyId; if (!companyId) throw new Error('Scoped skills require companyId'); this.company(companyId); if (input.projectId && this.project(input.projectId).companyId !== companyId) throw new Error('Project skill crosses company boundary'); if (input.teamId) this.assertTeamCompany(input.teamId, companyId); if (input.roleId) this.assertRoleCompany(input.roleId, companyId); if (input.agentId && !this.value.agents.some((item) => item.id === input.agentId && item.companyId === companyId)) throw new Error('Agent skill crosses company boundary'); this.value.skills.push({ id: randomUUID(), scope: input.scope, name: clean(input.name), description: clean(input.description), instructions: clean(input.instructions), companyId, ...(input.projectId ? { projectId: input.projectId } : {}), ...(input.teamId ? { teamId: input.teamId } : {}), ...(input.roleId ? { roleId: input.roleId } : {}), ...(input.agentId ? { agentId: input.agentId } : {}) }) }
  private createWorkflow(input: Extract<OrganizationMutation, { type: 'workflow.create' }>): void { this.company(input.companyId); if (input.projectId && this.project(input.projectId).companyId !== input.companyId) throw new Error('Workflow crosses company boundary'); if (!input.steps.length) throw new Error('Workflow must contain at least one step'); this.value.workflows.push({ id: randomUUID(), companyId: input.companyId, name: clean(input.name), scope: input.projectId ? 'project' : 'company', ...(input.projectId ? { projectId: input.projectId } : {}), steps: input.steps }) }
  private createGoal(input: Extract<OrganizationMutation, { type: 'goal.create' }>): void { if (this.project(input.projectId).companyId !== input.companyId) throw new Error('Goal crosses company boundary'); this.value.goals.push({ id: randomUUID(), companyId: input.companyId, projectId: input.projectId, title: clean(input.title), description: clean(input.description), status: 'active', progress: 0, createdAt: Date.now() }); this.refreshProject(input.projectId) }
  private createTask(input: Extract<OrganizationMutation, { type: 'task.create' }>): void {
    const project = this.project(input.projectId)
    if (project.companyId !== input.companyId) throw new Error('Project does not belong to company')
    if (input.assignedAgentId && !this.value.agents.some((item) => item.id === input.assignedAgentId && item.companyId === input.companyId)) throw new Error('Assigned agent crosses company boundary')
    for (const dependency of input.dependsOn ?? []) if (!this.value.tasks.some((item) => item.id === dependency && item.projectId === input.projectId)) throw new Error('Task dependency crosses project boundary')
    const agent = input.assignedAgentId ? this.value.agents.find((item) => item.id === input.assignedAgentId) : this.pickAgent(input.companyId)
    if (agent?.teamId && !project.teamIds.includes(agent.teamId)) project.teamIds.push(agent.teamId)
    const now = Date.now()
    this.value.tasks.push({ id: randomUUID(), companyId: input.companyId, projectId: input.projectId, title: clean(input.title), description: clean(input.description), acceptanceCriteria: input.acceptanceCriteria?.map(clean).filter(Boolean) ?? ['Requested outcome is implemented and verified.'], priority: input.priority ?? 'medium', status: 'backlog', dependsOn: input.dependsOn ?? [], ...(input.goalId ? { goalId: input.goalId } : {}), ...(input.milestoneId ? { milestoneId: input.milestoneId } : {}), ...(agent ? { assignedAgentId: agent.id } : {}), createdAt: now, updatedAt: now })
    this.refreshProject(input.projectId)
  }
  private updateTask(id: string, patch: Extract<OrganizationMutation, { type: 'task.update' }>['patch']): void { const task = this.task(id); if (patch.assignedAgentId && !this.value.agents.some((item) => item.id === patch.assignedAgentId && item.companyId === task.companyId)) throw new Error('Assigned agent crosses company boundary'); for (const dependency of patch.dependsOn ?? []) if (!this.value.tasks.some((item) => item.id === dependency && item.projectId === task.projectId)) throw new Error('Task dependency crosses project boundary'); Object.assign(task, patch); task.updatedAt = Date.now(); this.refreshProject(task.projectId) }
  private addMemory(input: { companyId: string; projectId?: string; title: string; content: string; tags?: string[]; source: MemoryEntry['source']; type?: string }): void { this.company(input.companyId); const now = Date.now(); this.value.memory.push({ id: randomUUID(), companyId: input.companyId, ...(input.projectId ? { projectId: input.projectId } : {}), title: clean(input.title), content: clean(input.content), tags: input.tags?.map(clean).filter(Boolean) ?? [], source: input.source, createdAt: now, updatedAt: now }) }
  private setPolicy(input: Extract<OrganizationMutation, { type: 'policy.set' }>): void { this.company(input.companyId); const existing = this.value.policies.find((item) => item.companyId === input.companyId && item.action === input.action); if (existing) { existing.effect = input.effect; if (input.description) existing.description = clean(input.description) } else this.value.policies.push({ id: randomUUID(), companyId: input.companyId, action: clean(input.action), effect: input.effect, description: clean(input.description ?? input.action) }) }

  private refreshProject(projectId: string): void {
    const project = this.project(projectId)
    const tasks = this.value.tasks.filter((item) => item.projectId === projectId)
    for (const task of tasks) {
      if (task.status === 'backlog' && task.dependsOn.every((id) => this.value.tasks.find((item) => item.id === id)?.status === 'completed')) task.status = 'ready'
    }

    project.progress = tasks.length ? Math.round(tasks.filter((item) => item.status === 'completed').length / tasks.length * 100) : 0
    const allCompleted = tasks.length > 0 && tasks.every((item) => item.status === 'completed')
    const hasRunnable = tasks.some((item) => item.status === 'in_progress' || item.status === 'review' || item.status === 'ready')
    const hasBlocked = tasks.some((item) => item.status === 'blocked')
    if (allCompleted) project.status = 'completed'
    else if (hasRunnable) project.status = 'active'
    else if (hasBlocked) project.status = 'blocked'
    else if (tasks.length > 0) project.status = 'planning'
    project.updatedAt = Date.now()

    for (const milestone of this.value.milestones.filter((item) => item.projectId === projectId)) {
      const milestoneTasks = tasks.filter((task) => task.milestoneId === milestone.id)
      if (!milestoneTasks.length) milestone.status = 'pending'
      else if (milestoneTasks.every((task) => task.status === 'completed')) milestone.status = 'completed'
      else if (milestoneTasks.some((task) => task.status === 'ready' || task.status === 'in_progress' || task.status === 'review')) milestone.status = 'active'
      else if (milestoneTasks.some((task) => task.status === 'blocked')) milestone.status = 'blocked'
      else milestone.status = 'pending'
    }

    for (const goal of this.value.goals.filter((item) => item.projectId === projectId)) {
      const goalTasks = tasks.filter((task) => task.goalId === goal.id)
      goal.progress = goalTasks.length ? Math.round(goalTasks.filter((task) => task.status === 'completed').length / goalTasks.length * 100) : 0
      if (goal.progress === 100) goal.status = 'completed'
      else if (goalTasks.some((task) => task.status === 'ready' || task.status === 'in_progress' || task.status === 'review')) goal.status = 'active'
      else if (goalTasks.some((task) => task.status === 'blocked')) goal.status = 'blocked'
      else goal.status = 'active'
    }
  }
  private seedRole(companyId: string, name: string, responsibility: string, systemPrompt: string, skillIds: string[]): OrganizationRole { const role = { id: randomUUID(), companyId, name, responsibility, systemPrompt, skillIds }; this.value.roles.push(role); return role }
  private seedTeam(companyId: string, name: string, purpose: string, roleIds: string[], skillIds: string[]): Team { const team = { id: randomUUID(), companyId, name, purpose, roleIds, skillIds }; this.value.teams.push(team); return team }
  private seedAgent(companyId: string, name: string, roleId: string, teamId: string): OrganizationAgent { const agent: OrganizationAgent = { id: randomUUID(), companyId, name, roleId, teamId, status: 'idle', skillIds: [] }; this.value.agents.push(agent); return agent }
  private pickAgent(companyId: string, roleHint?: string): OrganizationAgent | undefined {
    const hint = roleHint?.trim().toLowerCase() ?? ''
    const roles = this.value.roles.filter((role) => role.companyId === companyId)
    const hintedRole = hint ? roles.find((item) => item.name.toLowerCase().includes(hint) || hint.includes(item.name.toLowerCase())) : undefined
    const role = hintedRole ?? roles.find((item) => /engineer/i.test(item.name)) ?? roles[0]
    if (!role) return undefined
    const agents = this.value.agents.filter((agent) => agent.companyId === companyId && agent.roleId === role.id)
    return agents.find((agent) => agent.status === 'idle') ?? agents[0]
  }
  private setAgent(agentId: string | undefined, status: AgentStatus, taskId?: string, sessionId?: string): void { if (!agentId) return; const agent = this.value.agents.find((item) => item.id === agentId); if (!agent) return; agent.status = status; if (taskId) agent.currentTaskId = taskId; else delete agent.currentTaskId; if (sessionId) agent.lastSessionId = sessionId }
  private assertRoleCompany(roleId: string, companyId: string): void { if (!this.value.roles.some((item) => item.id === roleId && item.companyId === companyId)) throw new Error('Role crosses company boundary') }
  private assertTeamCompany(teamId: string, companyId: string): void { if (!this.value.teams.some((item) => item.id === teamId && item.companyId === companyId)) throw new Error('Team crosses company boundary') }
  private company(id: string): Company { return must(this.value.companies.find((item) => item.id === id), 'Company') }
  private project(id: string): Project { return must(this.value.projects.find((item) => item.id === id), 'Project') }
  private task(id: string): OrganizationTask { return must(this.value.tasks.find((item) => item.id === id), 'Task') }
  private activity(companyId: string, projectId: string | undefined, type: string, message: string): void { const row: OrganizationActivity = { id: randomUUID(), companyId, type, message, createdAt: Date.now(), ...(projectId ? { projectId } : {}) }; this.value.activity.unshift(row); this.value.activity = this.value.activity.slice(0, 500) }
}

function normalizeSnapshot(value: unknown): OrganizationSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Organization snapshot must be a JSON object')
  const record = value as Record<string, unknown>
  if (record.version !== 1) throw new Error(`Unsupported organization snapshot version: ${String(record.version)}`)
  for (const key of SNAPSHOT_ARRAY_KEYS) {
    if (!Array.isArray(record[key])) throw new Error(`Organization snapshot field ${key} must be an array`)
  }
  const parsed = record as unknown as OrganizationSnapshot
  return { ...clone(EMPTY), ...parsed, skills: mergeBuiltins(parsed.skills) }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, path)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
}

function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function clean(value: string): string { const text = value.trim(); if (!text) throw new Error('Organization text fields cannot be empty'); return text }
function must<T>(value: T | undefined, label: string): T { if (!value) throw new Error(`${label} not found`); return value }
function clone<T>(value: T): T { return structuredClone(value) }
function mergeBuiltins(skills: OrganizationSkill[]): OrganizationSkill[] { const custom = skills.filter((item) => item.scope !== 'builtin'); return [...clone(BUILTIN_SKILLS), ...custom] }
function priority(value: OrganizationTask['priority']): number { return value === 'critical' ? 4 : value === 'high' ? 3 : value === 'medium' ? 2 : 1 }
function short(value: string): string { return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value }
