import type { DshEventFrame } from '../../shared/contracts.js'
import type { OrganizationRunReceipt, OrganizationTask, ProjectPlanInput } from '../../shared/organization.js'
import type { HarnessService } from '../harness/harness-service.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import type { OrganizationStore } from './store.js'

interface ReviewVerdict {
  verdict: 'pass' | 'fail'
  summary: string
  issues?: string[]
  memory?: Array<{ title: string; content: string; tags?: string[] }>
}

export class OrganizationOrchestrator {
  private finalText = new Map<string, string>()
  private structuredHandled = new Set<string>()
  private autoAdvance = new Map<string, string>()

  constructor(
    private readonly store: OrganizationStore,
    private readonly harness: HarnessService,
    private readonly workspace: WorkspaceService,
  ) {}

  async planProject(projectId: string): Promise<OrganizationRunReceipt> {
    const context = await this.store.projectContext(projectId)
    this.assertPolicy(await this.store.policy(context.company.id, 'internal.plan'), true, 'internal planning')
    await this.prepareWorkspace(context.project.workspacePath)
    const sessionId = await this.harness.createSession()
    const run = await this.store.beginRun('pm-plan', context.company.id, projectId, sessionId)
    await this.harness.run(pmPrompt(context), { sessionId })
    return { runId: run.id, sessionId, projectId, kind: 'pm-plan' }
  }

  async runTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.execute'), explicit, 'task execution')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic execution')
    if (context.task.status !== 'ready' && context.task.status !== 'blocked') throw new Error(`Task is ${context.task.status}; only ready or blocked tasks can run`)
    await this.prepareWorkspace(context.project.workspacePath)
    const sessionId = await this.harness.createSession()
    const run = await this.store.beginRun('task-execution', context.company.id, context.project.id, sessionId, context.task.id, context.task.goalId)
    await this.store.markExecution(context.task.id, sessionId)
    await this.harness.run(workerPrompt(context), { sessionId })
    return { runId: run.id, sessionId, projectId: context.project.id, taskId: context.task.id, kind: 'task-execution' }
  }

  async reviewTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.review'), explicit, 'task review')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic review')
    if (context.task.status !== 'review') throw new Error('Task must be ready for review')
    await this.prepareWorkspace(context.project.workspacePath)
    const sessionId = await this.harness.createSession()
    const run = await this.store.beginRun('task-review', context.company.id, context.project.id, sessionId, context.task.id, context.task.goalId)
    await this.store.markReviewStarted(taskId, sessionId)
    await this.harness.run(reviewPrompt(context.task, context), { sessionId })
    return { runId: run.id, sessionId, projectId: context.project.id, taskId, kind: 'task-review' }
  }

  async runNext(projectId?: string, explicit = true): Promise<OrganizationRunReceipt | null> {
    const state = await this.store.state()
    const id = projectId ?? state.activeProjectId
    if (!id) throw new Error('No active project')
    const project = state.projects.find((item) => item.id === id)
    if (!project) throw new Error('Project not found')
    const company = state.companies.find((item) => item.id === project.companyId)
    if (!company) throw new Error('Company not found')
    if (!explicit && company.autonomyLevel < 3) return null
    const reviewing = state.tasks.find((task) => task.projectId === id && task.status === 'review' && !task.reviewSessionId)
    if (reviewing) return this.reviewTask(reviewing.id, explicit)
    const ready = await this.store.nextReadyTask(id)
    if (ready) return this.runTask(ready.id, explicit)
    if (state.goals.every((goal) => goal.projectId !== id)) return this.planProject(id)
    return null
  }

  async handleHarnessEvent(frame: DshEventFrame): Promise<void> {
    const sessionId = frame.sessionId
    if (!sessionId) return
    const run = await this.store.runBySession(sessionId)
    if (frame.kind === 'session-event' && frame.event && run) {
      if (frame.event.type === 'assistant/message') {
        const text = messageText((frame.event.data as Record<string, unknown> | undefined)?.message)
        if (text !== undefined) {
          this.finalText.set(sessionId, text)
          if (!this.structuredHandled.has(sessionId)) {
            if (run.kind === 'pm-plan') await this.handlePlan(run.id, run.projectId, sessionId, text)
            if (run.kind === 'task-review' && run.taskId) await this.handleReview(run.id, run.taskId, run.projectId, sessionId, text)
          }
        }
      }
      return
    }
    if (frame.kind === 'agent-error' && run) {
      await this.store.completeRun(run.id, undefined, frame.message ?? 'Agent error')
      if (run.taskId) await this.failTask(run.taskId, frame.message ?? 'Agent error')
      return
    }
    if (frame.kind !== 'session-status' || frame.running !== false) return

    if (run?.kind === 'task-execution' && run.taskId) {
      const output = this.finalText.get(sessionId) ?? 'Worker session finished.'
      await this.store.completeRun(run.id, output)
      await this.store.markForReview(run.taskId, output)
      this.finalText.delete(sessionId)
      await this.continueProject(run.projectId)
      return
    }
    if (run && !this.structuredHandled.has(sessionId)) {
      await this.store.completeRun(run.id, this.finalText.get(sessionId), `Expected structured ${run.kind} result was not produced`)
      if (run.taskId) await this.failTask(run.taskId, 'Structured review result was not produced')
    }
    this.finalText.delete(sessionId)
    const project = this.autoAdvance.get(sessionId)
    this.autoAdvance.delete(sessionId)
    if (project) await this.continueProject(project)
  }

  private async handlePlan(runId: string, projectId: string, sessionId: string, text: string): Promise<void> {
    const plan = extractTaggedJson<ProjectPlanInput>(text, 'nd-dsh-plan')
    if (!plan) return
    validatePlan(plan)
    await this.store.applyPlan(projectId, plan)
    await this.store.completeRun(runId, text)
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async handleReview(runId: string, taskId: string, projectId: string, sessionId: string, text: string): Promise<void> {
    const review = extractTaggedJson<ReviewVerdict>(text, 'nd-dsh-review')
    if (!review) return
    if ((review.verdict !== 'pass' && review.verdict !== 'fail') || typeof review.summary !== 'string') throw new Error('Invalid ND-DSH review result')
    const issueText = review.issues?.length ? `\nIssues: ${review.issues.join('; ')}` : ''
    await this.store.completeReview(taskId, review.verdict === 'pass', `${review.summary}${issueText}`, review.memory ?? [])
    await this.store.completeRun(runId, text)
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async continueProject(projectId: string): Promise<void> {
    try { await this.runNext(projectId, false) } catch (error) { console.warn('Organization autopilot paused:', error instanceof Error ? error.message : String(error)) }
  }

  private async failTask(taskId: string, message: string): Promise<void> {
    const state = await this.store.state(); const task = state.tasks.find((item) => item.id === taskId); if (!task) return
    await this.store.mutate({ type: 'task.update', id: taskId, patch: { status: 'blocked' } })
    console.warn(`Organization task blocked: ${message}`)
  }

  private assertPolicy(effect: 'allow' | 'ask' | 'deny', explicit: boolean, label: string): void {
    if (effect === 'deny') throw new Error(`${label} is denied by company policy`)
    if (effect === 'ask' && !explicit) throw new Error(`${label} requires human approval`)
  }

  private async prepareWorkspace(workspacePath: string | undefined): Promise<void> {
    if (!workspacePath || this.workspace.state().root === workspacePath) return
    await this.harness.close()
    await this.workspace.setRoot(workspacePath)
  }
}

function pmPrompt(context: Awaited<ReturnType<OrganizationStore['projectContext']>>): string {
  return `You are the AI Product Manager for ${context.company.name}.\nMission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\n\nCreate a practical delivery plan. Respect company/project isolation. Use existing teams and roles when assigning work. Return concise reasoning, then exactly one JSON object between <nd-dsh-plan> and </nd-dsh-plan>.\n\nSchema:\n<nd-dsh-plan>{"goal":{"title":"...","description":"..."},"milestones":[{"title":"...","description":"...","tasks":[{"title":"...","description":"...","priority":"medium","acceptanceCriteria":["..."],"dependsOn":["earlier task title"],"role":"Software Engineer"}]}],"memory":[{"title":"...","content":"...","tags":["plan"]}]}</nd-dsh-plan>\n\nKnown memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}`
}

function workerPrompt(context: Awaited<ReturnType<OrganizationStore['taskContext']>>): string {
  return `You are ${context.agent?.name ?? 'an AI worker'} acting as ${context.role?.name ?? 'Software Engineer'} inside company ${context.company.name}.\nCompany mission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\nTask: ${context.task.title}\nDescription: ${context.task.description}\nAcceptance criteria:\n${context.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}\n\nResponsibilities: ${context.role?.responsibility ?? 'Complete the assigned work.'}\nRole instructions: ${context.role?.systemPrompt ?? 'Execute carefully and verify the result.'}\nRelevant skills:\n${context.skills.map((item) => `- ${item.name}: ${item.instructions}`).join('\n')}\nRelevant memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}\n\nWork directly in the project workspace using available tools. Inspect before editing, run meaningful validation, and finish with a concise result summary for the independent reviewer.`
}

function reviewPrompt(task: OrganizationTask, context: Awaited<ReturnType<OrganizationStore['taskContext']>>): string {
  return `You are an independent reviewer for ${context.company.name}. Do not assume the worker succeeded. Inspect the actual workspace and verify the task against acceptance criteria.\nProject: ${context.project.name}\nTask: ${task.title}\nDescription: ${task.description}\nAcceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}\nWorker summary:\n${task.resultSummary ?? 'No summary provided.'}\n\nRun relevant tests/checks. Then return exactly one JSON object between <nd-dsh-review> and </nd-dsh-review>:\n<nd-dsh-review>{"verdict":"pass|fail","summary":"evidence-based review","issues":["..."],"memory":[{"title":"lesson","content":"durable lesson","tags":["review"]}]}</nd-dsh-review>`
}

function messageText(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((block) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text' && typeof (block as Record<string, unknown>).text === 'string' ? [(block as Record<string, string>).text] : [])
  return parts.length ? parts.join('\n') : undefined
}

function extractTaggedJson<T>(text: string, tag: string): T | undefined {
  const match = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`).exec(text)
  if (!match?.[1]) return undefined
  return JSON.parse(match[1]) as T
}

function validatePlan(plan: ProjectPlanInput): void {
  if (!plan?.goal?.title?.trim() || !plan.goal.description?.trim() || !Array.isArray(plan.milestones) || plan.milestones.length === 0) throw new Error('Invalid ND-DSH project plan')
  for (const milestone of plan.milestones) if (!milestone.title?.trim() || !Array.isArray(milestone.tasks) || milestone.tasks.length === 0) throw new Error('Every milestone needs a title and tasks')
}
