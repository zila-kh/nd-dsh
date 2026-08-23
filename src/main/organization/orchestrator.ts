import type { CodingEngineDescriptor, DshEventFrame } from '../../shared/contracts.js'
import { ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import type { OrganizationAgent, OrganizationRole, OrganizationRun, OrganizationRunReceipt, OrganizationTask, ProjectPlanInput } from '../../shared/organization.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { EngineSessionRouter } from '../engines/engine-session-router.js'
import type { HarnessService } from '../harness/harness-service.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import type { OrganizationStore } from './store.js'

interface ReviewVerdict {
  verdict: 'pass' | 'fail'
  summary: string
  issues?: string[]
  memory?: Array<{ title: string; content: string; tags?: string[] }>
}

const MAX_AUTOPILOT_EXECUTION_ATTEMPTS = 3

/**
 * Gateway session events and host lifecycle events arrive on two separate
 * WebSocket connections, so the final assistant/message of a session can be
 * delivered shortly AFTER the matching session-status(complete). Structured
 * results (pm plans, review verdicts) must wait out this grace period before
 * the run is declared "structured result missing", or valid plans get
 * discarded on every race the host socket wins.
 */
const STRUCTURED_RESULT_GRACE_MS = 2_500

type WorkflowKind = 'plan' | 'execute' | 'review'

/** The execution-relevant slice of an engine descriptor. */
type TaskEngine = Pick<CodingEngineDescriptor, 'id' | 'name' | 'workerInstructions'>

/** Fallback guidance when a descriptor carries none (kept neutral and ND-owned). */
const DEFAULT_WORKER_INSTRUCTIONS = '\nExecution engine: ND Harness. Work directly in the project workspace using the available ND tools.\n'

export class OrganizationOrchestrator {
  private finalText = new Map<string, string>()
  private structuredHandled = new Set<string>()
  private structuredInFlight = new Set<string>()
  private autoAdvance = new Map<string, string>()

  constructor(
    private readonly store: OrganizationStore,
    private readonly harness: HarnessService,
    private readonly workspace: WorkspaceService,
    private readonly engines?: Pick<CodingEngineRegistry, 'assignedEngine' | 'assertAvailable'>,
    private readonly engineRuns?: Pick<EngineSessionRouter, 'createSession' | 'run'>,
  ) {}

  async planProject(projectId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.projectContext(projectId)
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic planning')
    this.assertPolicy(await this.store.policy(context.company.id, 'internal.plan'), explicit, 'internal planning')
    await this.assertNoActiveRun(projectId)
    await this.prepareWorkspace(context.project.workspacePath)
    const pmAgent = context.agents.find((item) => {
      const role = context.roles.find((r) => r.id === item.roleId)
      return role?.name.toLowerCase().includes('product manager')
    })
    const pmRole = pmAgent ? context.roles.find((r) => r.id === pmAgent.roleId) : context.roles.find((r) => r.name.toLowerCase().includes('product manager'))
    const modelOpts = this.resolveAgentModel(pmAgent, pmRole)
    const sessionId = await this.harness.createSession()
    const run = await this.store.beginRun('pm-plan', context.company.id, projectId, sessionId)
    await this.harness.run(pmPrompt(context), { sessionId, ...modelOpts })
    return receipt(run)
  }

  async runTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.execute'), explicit, 'task execution')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic execution')
    if (context.task.status !== 'ready' && context.task.status !== 'blocked') throw new Error(`Task is ${context.task.status}; only ready or blocked tasks can run`)
    const engine = await this.resolveTaskEngine(context.agent?.id)
    const prompt = workerPrompt(context, engine)
    const modelOpts = this.resolveAgentModel(context.agent, context.role)
    await this.assertNoActiveRun(context.project.id)
    await this.prepareWorkspace(context.project.workspacePath)
    // Engine routing is transport-level only: the session is created on the
    // assigned engine through the router, and completion arrives as the same
    // shared event frames every engine emits.
    const target = this.engineRuns
      ? await this.engineRuns.createSession(engine.id)
      : { engineId: ND_HARNESS_ENGINE_ID, sessionId: await this.harness.createSession() }
    const run = await this.store.beginRun('task-execution', context.company.id, context.project.id, target.sessionId, context.task.id, context.task.goalId)
    await this.store.markExecution(context.task.id, target.sessionId)
    if (this.engineRuns) await this.engineRuns.run(prompt, { sessionId: target.sessionId, ...modelOpts })
    else await this.harness.run(prompt, { sessionId: target.sessionId, ...modelOpts })
    return receipt(run)
  }

  async reviewTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    const projectCtx = await this.store.projectContext(context.project.id)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.review'), explicit, 'task review')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic review')
    if (context.task.status !== 'review') throw new Error('Task must be ready for review')
    const reviewerAgent = projectCtx.agents.find((item) => {
      const role = projectCtx.roles.find((r) => r.id === item.roleId)
      return role?.name.toLowerCase().includes('reviewer')
    })
    const reviewerRole = reviewerAgent ? projectCtx.roles.find((r) => r.id === reviewerAgent.roleId) : projectCtx.roles.find((r) => r.name.toLowerCase().includes('reviewer'))
    const modelOpts = this.resolveAgentModel(reviewerAgent, reviewerRole)
    await this.assertNoActiveRun(context.project.id)
    await this.prepareWorkspace(context.project.workspacePath)
    const sessionId = await this.harness.createSession()
    const run = await this.store.beginRun('task-review', context.company.id, context.project.id, sessionId, context.task.id, context.task.goalId)
    await this.store.markReviewStarted(taskId, sessionId)
    await this.harness.run(reviewPrompt(context.task, context), { sessionId, ...modelOpts })
    return receipt(run)
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

    const active = state.runs.find((item) => item.status === 'running')
    if (active) {
      if (active.projectId === id) return receipt(active)
      if (explicit) throw new Error(`Another project already has an active ${active.kind} run in session ${active.sessionId}`)
      return null
    }

    const workflow = await this.workflowKinds(id)
    const reviewing = state.tasks.find((task) => task.projectId === id && task.status === 'review' && !task.reviewSessionId)
    if (reviewing) {
      if (workflow.has('review')) return this.reviewTask(reviewing.id, explicit)
      await this.store.completeWithoutReview(reviewing.id, reviewing.resultSummary ?? 'Worker session completed without a review step in this workflow.')
      return this.runNext(id, explicit)
    }

    const ready = await this.store.nextReadyTask(id)
    if (ready && workflow.has('execute')) return this.runTask(ready.id, explicit)

    const hasGoals = state.goals.some((goal) => goal.projectId === id)
    if (!hasGoals && workflow.has('plan')) {
      const hasFailedPlan = state.runs.some((run) => run.projectId === id && run.kind === 'pm-plan' && run.status === 'failed')
      if (hasFailedPlan && !explicit) return null
      return this.planProject(id, explicit)
    }
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
            if (run.kind === 'pm-plan') await this.handlePlan(run.projectId, sessionId, text)
            if (run.kind === 'task-review' && run.taskId) await this.handleReview(run.taskId, run.projectId, sessionId, text)
          }
        }
      }
      return
    }

    if (frame.kind === 'agent-error' && run) {
      if (this.harness.consumeCanceledSession(sessionId)) {
        await this.handleCanceledRun(run, sessionId)
        return
      }
      await this.store.completeRun(run.id, this.finalText.get(sessionId), frame.message ?? 'Agent error')
      if (run.taskId) await this.failTask(run.taskId, frame.message ?? 'Agent error')
      this.cleanupSession(sessionId)
      if (run.kind !== 'pm-plan') {
        await this.continueProject(run.projectId)
      }
      return
    }

    if (frame.kind !== 'session-status' || frame.running !== false) return

    const canceled = this.harness.consumeCanceledSession(sessionId)
    if (canceled) {
      if (run) await this.handleCanceledRun(run, sessionId)
      else this.cleanupSession(sessionId)
      return
    }

    if (run?.kind === 'task-execution' && run.taskId) {
      const output = this.finalText.get(sessionId) ?? 'Worker session finished.'
      await this.store.completeRun(run.id, output)
      const workflow = await this.workflowKinds(run.projectId)
      if (workflow.has('review')) await this.store.markForReview(run.taskId, output)
      else await this.store.completeWithoutReview(run.taskId, output)
      this.cleanupSession(sessionId)
      await this.continueProject(run.projectId)
      return
    }

    if (run && this.structuredHandled.has(sessionId)) {
      await this.store.completeRun(run.id, this.finalText.get(sessionId))
    } else if (run && (run.kind === 'pm-plan' || run.kind === 'task-review')) {
      // The completion status may beat the final assistant/message across the
      // two gateway sockets. Wait out the grace period; if the structured
      // result lands in the meantime it is applied normally and the run
      // completes successfully instead of failing as "missing".
      await new Promise((resolve) => setTimeout(resolve, STRUCTURED_RESULT_GRACE_MS))
      const reopened = await this.store.runBySession(sessionId)
      if (!reopened) {
        this.cleanupSession(sessionId)
        return
      }
      if (this.structuredHandled.has(sessionId)) {
        await this.store.completeRun(run.id, this.finalText.get(sessionId))
      } else {
        await this.store.completeRun(run.id, this.finalText.get(sessionId), `Expected structured ${run.kind} result was not produced`)
        if (run.taskId) await this.failTask(run.taskId, 'Structured review result was not produced')
      }
    } else if (run) {
      await this.store.completeRun(run.id, this.finalText.get(sessionId), `Expected structured ${run.kind} result was not produced`)
      if (run.taskId) await this.failTask(run.taskId, 'Structured review result was not produced')
    }

    const project = this.autoAdvance.get(sessionId)
    this.cleanupSession(sessionId)
    if (project) await this.continueProject(project)
  }

  private async handlePlan(projectId: string, sessionId: string, text: string): Promise<void> {
    const plan = extractTaggedJson<ProjectPlanInput>(text, 'nd-dsh-plan')
    if (!plan) return
    validatePlan(plan)
    // Duplicate delivery across the two gateway sockets must not create the
    // plan twice; claim the session synchronously before any await.
    if (this.structuredInFlight.has(sessionId)) return
    this.structuredInFlight.add(sessionId)
    try {
      await this.store.applyPlan(projectId, plan)
    } finally {
      this.structuredInFlight.delete(sessionId)
    }
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async handleReview(taskId: string, projectId: string, sessionId: string, text: string): Promise<void> {
    const review = extractTaggedJson<ReviewVerdict>(text, 'nd-dsh-review')
    if (!review) return
    if ((review.verdict !== 'pass' && review.verdict !== 'fail') || typeof review.summary !== 'string' || !review.summary.trim()) throw new Error('Invalid ND-DSH review result')
    // Duplicate delivery across the two gateway sockets must not complete the
    // review twice; claim the session synchronously before any await.
    if (this.structuredInFlight.has(sessionId)) return
    this.structuredInFlight.add(sessionId)
    try {
      const issueText = review.issues?.length ? `\nIssues: ${review.issues.join('; ')}` : ''
      const summary = `${review.summary}${issueText}`
      const context = await this.store.taskContext(taskId)
      const executionAttempts = await this.store.executionAttemptCount(taskId)
      const automaticRework = review.verdict === 'fail'
        && context.company.autonomyLevel >= 4
        && executionAttempts < MAX_AUTOPILOT_EXECUTION_ATTEMPTS

      await this.store.completeReview(taskId, review.verdict === 'pass', summary, review.memory ?? [])
      if (automaticRework) await this.store.queueRework(taskId, summary)
    } finally {
      this.structuredInFlight.delete(sessionId)
    }
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async handleCanceledRun(run: OrganizationRun, sessionId: string): Promise<void> {
    const message = 'Canceled by user before the run completed.'
    await this.store.completeRun(run.id, this.finalText.get(sessionId), message)
    if (run.taskId) await this.failTask(run.taskId, message)
    this.cleanupSession(sessionId)
  }

  private async continueProject(projectId: string): Promise<void> {
    try {
      await this.runNext(projectId, false)
    } catch (error) {
      console.warn('Organization autopilot paused:', error instanceof Error ? error.message : String(error))
    }
  }

  private resolveAgentModel(agent?: OrganizationAgent, role?: OrganizationRole): { provider?: string; model?: string } {
    const provider = agent?.providerId ?? role?.providerId
    const model = agent?.modelId ?? role?.modelId
    return provider && model ? { provider, model } : {}
  }

  private async failTask(taskId: string, message: string): Promise<void> {
    const state = await this.store.state()
    const task = state.tasks.find((item) => item.id === taskId)
    if (!task) return
    await this.store.mutate({ type: 'task.update', id: taskId, patch: { status: 'blocked' } })
    console.warn(`Organization task blocked: ${message}`)
  }

  private async assertNoActiveRun(projectId: string): Promise<void> {
    const active = (await this.store.state()).runs.find((item) => item.status === 'running')
    if (!active) return
    if (active.projectId === projectId) throw new Error(`Project already has an active ${active.kind} run in session ${active.sessionId}`)
    throw new Error(`Another project already has an active ${active.kind} run in session ${active.sessionId}`)
  }

  private async resolveTaskEngine(agentId: string | undefined): Promise<TaskEngine> {
    if (!this.engines) return { id: ND_HARNESS_ENGINE_ID, name: 'ND Harness' }
    const engineId = await this.engines.assignedEngine(agentId)
    // Catalog availability is the only gate; the registry owns which engines
    // may run, and each descriptor owns its own execution guidance.
    const descriptor = this.engines.assertAvailable(engineId)
    return {
      id: descriptor.id,
      name: descriptor.name,
      ...(descriptor.workerInstructions === undefined ? {} : { workerInstructions: descriptor.workerInstructions }),
    }
  }

  private async workflowKinds(projectId: string): Promise<Set<WorkflowKind>> {
    const workflow = await this.store.workflowForProject(projectId)
    const kinds = new Set<WorkflowKind>()
    for (const step of workflow?.steps ?? []) kinds.add(step.kind)
    if (kinds.size === 0) {
      kinds.add('plan')
      kinds.add('execute')
      kinds.add('review')
    }
    return kinds
  }

  private cleanupSession(sessionId: string): void {
    this.finalText.delete(sessionId)
    this.structuredHandled.delete(sessionId)
    this.structuredInFlight.delete(sessionId)
    this.autoAdvance.delete(sessionId)
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
  const roles = context.roles.map((item) => `- ${item.name}: ${item.responsibility}`).join('\n') || '- Software Engineer'
  const teams = context.teams.map((item) => `- ${item.name}: ${item.purpose}`).join('\n') || '- Engineering'
  return `You are the AI Product Manager for ${context.company.name}.\nMission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\n\nCreate a practical delivery plan. Respect company/project isolation. Use the existing teams and roles when assigning work. Return concise reasoning, then exactly one JSON object between <nd-dsh-plan> and </nd-dsh-plan>.\n\nSchema:\n<nd-dsh-plan>{"goal":{"title":"...","description":"..."},"milestones":[{"title":"...","description":"...","tasks":[{"title":"...","description":"...","priority":"medium","acceptanceCriteria":["..."],"dependsOn":["earlier task title"],"role":"Software Engineer"}]}],"memory":[{"title":"...","content":"...","tags":["plan"]}]}</nd-dsh-plan>\n\nAvailable roles:\n${roles}\nAvailable teams:\n${teams}\nKnown memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}`
}

function workerPrompt(context: Awaited<ReturnType<OrganizationStore['taskContext']>>, engine: TaskEngine): string {
  const reviewFeedback = context.task.reviewSummary
    ? `\nPrevious independent review feedback:\n${context.task.reviewSummary}\nResolve every relevant issue before declaring the task complete.\n`
    : ''
  const engineInstructions = engine.workerInstructions ?? DEFAULT_WORKER_INSTRUCTIONS
  return `You are ${context.agent?.name ?? 'an AI worker'} acting as ${context.role?.name ?? 'Software Engineer'} inside company ${context.company.name}.\nCompany mission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\nTask: ${context.task.title}\nDescription: ${context.task.description}\nAcceptance criteria:\n${context.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}${reviewFeedback}\nResponsibilities: ${context.role?.responsibility ?? 'Complete the assigned work.'}\nRole instructions: ${context.role?.systemPrompt ?? 'Execute carefully and verify the result.'}\nRelevant skills:\n${context.skills.map((item) => `- ${item.name}: ${item.instructions}`).join('\n')}\nRelevant memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}${engineInstructions}\nInspect before editing, run meaningful validation, and finish with a concise result summary for the independent reviewer.`
}

function reviewPrompt(task: OrganizationTask, context: Awaited<ReturnType<OrganizationStore['taskContext']>>): string {
  return `You are an independent reviewer for ${context.company.name}. Do not assume the worker succeeded. Inspect the actual workspace and verify the task against acceptance criteria.\nProject: ${context.project.name}\nTask: ${task.title}\nDescription: ${task.description}\nAcceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}\nWorker summary:\n${task.resultSummary ?? 'No summary provided.'}\n\nRun relevant tests/checks. Then return exactly one JSON object between <nd-dsh-review> and </nd-dsh-review>:\n<nd-dsh-review>{"verdict":"pass|fail","summary":"evidence-based review","issues":["..."],"memory":[{"title":"lesson","content":"durable lesson","tags":["review"]}]}</nd-dsh-review>`
}

function receipt(run: OrganizationRun): OrganizationRunReceipt {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    projectId: run.projectId,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    kind: run.kind,
  }
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
  let raw = match[1].trim()
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function validatePlan(plan: ProjectPlanInput): void {
  if (!plan?.goal?.title?.trim() || !plan.goal.description?.trim() || !Array.isArray(plan.milestones) || plan.milestones.length === 0) throw new Error('Invalid ND-DSH project plan')
  for (const milestone of plan.milestones) if (!milestone.title?.trim() || !Array.isArray(milestone.tasks) || milestone.tasks.length === 0) throw new Error('Every milestone needs a title and tasks')
}
