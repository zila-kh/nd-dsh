import { randomUUID } from 'node:crypto'
import type { CodingEngineDescriptor, DshEventFrame } from '../../shared/contracts.js'
import { ND_HARNESS_ENGINE_ID } from '../../shared/coding-engines.js'
import type { OrganizationAgent, OrganizationRole, OrganizationRun, OrganizationRunReceipt, OrganizationTask, ProjectPlanInput } from '../../shared/organization.js'
import { parseFastActionPlan } from '../../shared/fast-action.js'
import type { CodingEngineRegistry } from '../engines/coding-engine-registry.js'
import type { EngineSessionRouter } from '../engines/engine-session-router.js'
import type { HarnessService } from '../harness/harness-service.js'
import type { WorkspaceService } from '../workspace/workspace-service.js'
import type { CoreClient } from '../core/core-client.js'
import { taskMetricsRecorder } from '../metrics/task-metrics.js'
import { isRetryableExecutionFailure, MAX_EXECUTION_ATTEMPTS, retryBackoffMs, stallTimeoutMs } from './execution-reliability.js'
import type { OrganizationStore } from './store.js'
import { TaskIntegrationConflictError, TaskWorktreeManager, type TaskWorktree } from './task-worktree.js'
import { formatVerificationEvidence, runArtifactVerification, runVerification, type VerificationProcessRuntime } from './verification-evidence.js'
import { RuntimeCapacityError, type ExecutionCoordinator, type RuntimeAvailability } from './execution-coordinator.js'
import { executePreparedFastPath, ND_FAST_PATH_ENGINE_ID, prepareFastPath, type FastPathAuditRecorder, type PreparedFastPath } from './fast-path.js'
import { formatDecisionSupportForReviewer, formatDecisionSupportReceipt, type DecisionSupportReceipt } from './decision-support-contract.js'
import type { DecisionSupportService } from './decision-support.js'

interface ReviewVerdict {
  verdict: 'pass' | 'fail'
  summary: string
  issues?: string[]
  memory?: Array<{ title: string; content: string; tags?: string[] }>
}

interface ReviewWorktreeCheckpoint {
  worktree: TaskWorktree
  head: string
}

interface ExecutionAttemptBoundary {
  worktree: TaskWorktree
  head: string
}

interface ExecutionRoute {
  engineId: string
  attempt: number
  provider?: string
  model?: string
}

interface ProviderRoute {
  provider: string
  model: string
}

const MAX_AUTOPILOT_PARALLEL_FILL = 16

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
type TaskEngine = Pick<CodingEngineDescriptor, 'id' | 'name' | 'workerInstructions'>

/**
 * Asked before every automatic dispatch. Only the control plane can compute a
 * task's pool claims, so the guarded IPC layer installs this; an orchestrator
 * without it dispatches as before and lets the acquire refuse.
 */
export type DispatchAvailabilityProvider = (
  projectId: string,
  taskId: string,
  action: 'task.execute' | 'task.review',
) => Promise<RuntimeAvailability>

const DEFAULT_WORKER_INSTRUCTIONS = '\nExecution engine: ND Harness. Work directly in the project workspace using the available ND tools.\n'

export class OrganizationOrchestrator {
  private finalText = new Map<string, string>()
  private structuredHandled = new Set<string>()
  private structuredInFlight = new Set<string>()
  private autoAdvance = new Map<string, string>()
  private reviewWorktrees = new Map<string, ReviewWorktreeCheckpoint>()
  private executionBaselines = new Map<string, ExecutionAttemptBoundary>()
  private executionRoutes = new Map<string, ExecutionRoute>()
  private attemptedProviderRoutes = new Map<string, Set<string>>()
  private pendingFallbackRoutes = new Map<string, ProviderRoute>()
  private canceledSessions = new Set<string>()
  private lastProgressAt = new Map<string, number>()
  private parallelFillProjects = new Set<string>()
  private stallReconcileBusy = false
  private dispatchAvailability: DispatchAvailabilityProvider | undefined
  private fastPathAuditRecorder: FastPathAuditRecorder | undefined
  private readonly capacityWaiting = new Set<string>()
  private readonly structuredErrors = new Map<string, string>()
  private readonly decisionSupportReceipts = new Map<string, DecisionSupportReceipt>()
  private readonly taskWorktrees: TaskWorktreeManager

  constructor(
    private readonly store: OrganizationStore,
    private readonly harness: HarnessService,
    private readonly workspace: WorkspaceService,
    private readonly engines?: Pick<CodingEngineRegistry, 'assignedEngine' | 'assertAvailable'>,
    private readonly engineRuns?: Pick<EngineSessionRouter, 'createSession' | 'run' | 'stopSession'>,
    private readonly projectRuntime?: { check(projectId: string): Promise<unknown> },
    private readonly capabilities?: { assertUsableForAgent(agent?: { id?: string; roleId?: string; teamId?: string }): Promise<void> },
    private readonly executionCoordinator?: Pick<ExecutionCoordinator, 'releaseSession' | 'currentPermit'>,
    taskWorktrees?: TaskWorktreeManager,
    private readonly core?: Pick<CoreClient, 'request'>,
    private readonly verificationRuntime?: VerificationProcessRuntime,
    private readonly decisionSupport?: DecisionSupportService,
  ) {
    this.taskWorktrees = taskWorktrees ?? new TaskWorktreeManager()
  }

  /**
   * Installed by the guarded IPC layer, which owns the control plane the claims
   * come from. Without a provider the orchestrator cannot know whether a pool
   * has room, so it dispatches and lets the permit acquire refuse.
   */
  setDispatchAvailability(provider: DispatchAvailabilityProvider | undefined): void {
    this.dispatchAvailability = provider
  }

  setFastPathAuditRecorder(recorder: FastPathAuditRecorder | undefined): void {
    this.fastPathAuditRecorder = recorder
  }

  /**
   * Re-enters the parallel fill for one project after a runtime permit was
   * released. A round that ended on a full pool is the only thing resume means:
   * every other stop needs a different trigger (a gate, a fix, a new plan), and
   * re-dispatching into a failing task would spin.
   */
  async resumeAutopilotDispatch(projectId: string): Promise<void> {
    if (!this.capacityWaiting.has(projectId)) return
    await this.fillParallelReadyTasks(projectId)
  }

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
    this.lastProgressAt.set(sessionId, run.startedAt)
    try {
      await this.harness.run(pmPrompt(context), { sessionId, ...modelOpts })
    } catch (cause) {
      const active = await this.store.runBySession(sessionId)
      if (active) await this.store.completeRun(run.id, undefined, errorMessage(cause)).catch(() => undefined)
      throw cause
    }
    return receipt(run)
  }

  async runTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.execute'), explicit, 'task execution')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic execution')
    if (context.task.status !== 'ready' && context.task.status !== 'blocked') throw new Error(`Task is ${context.task.status}; only ready or blocked tasks can run`)

    const state = await this.store.state()
    const previousExecution = state.runs.find((item) => item.taskId === taskId && item.kind === 'task-execution')
    const attempt = await this.store.executionAttemptCount(taskId) + 1
    const retryablePreviousFailure = Boolean(previousExecution?.status === 'failed' && isRetryableExecutionFailure(previousExecution.error ?? ''))
    const fallbackRoute = retryablePreviousFailure
      ? this.pendingFallbackRoutes.get(taskId) ?? await this.selectFallbackProviderRoute(context)
      : undefined
    const useFallbackRoute = Boolean(fallbackRoute)

    const taskWorktree = await this.taskWorktrees.ensure(context.project.workspacePath, context.task.id)
    if (taskWorktree) {
      await this.journalEffect({
        kind: 'workspace.allocate',
        state: 'complete',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId: context.task.id,
        resourceId: context.task.id,
        idempotencyKey: `workspace.allocate:${context.task.id}`,
        data: { branch: taskWorktree.branch },
      })
    }
    await this.assertTaskRunSlot(context.task.id, context.project.id, Boolean(taskWorktree))
    const attemptHead = taskWorktree ? await this.taskWorktrees.baseline(taskWorktree) : undefined
    const workspaceRoot = taskWorktree?.root ?? context.project.workspacePath
    let fastEscalationReason: string | undefined

    const fastPlan = parseFastActionPlan(context.task.description)
    if (fastPlan && workspaceRoot && this.core && this.fastPathAuditRecorder) {
      const prepared = await prepareFastPath({
        plan: fastPlan,
        context: {
          company: { id: context.company.id },
          project: { id: context.project.id },
          task: { id: context.task.id },
          ...(context.agent ? { agent: { id: context.agent.id } } : {}),
        },
        root: workspaceRoot,
        explicit,
        policy: (action) => this.store.policy(context.company.id, action),
        audit: this.fastPathAuditRecorder,
      })
      if (prepared.kind === 'ready') return this.runPreparedFastTask(context, prepared.prepared, taskWorktree, attemptHead, attempt)
      fastEscalationReason = prepared.reason
    } else if (fastPlan) {
      fastEscalationReason = 'Fast path is unavailable without ND Core and the durable action-audit sink.'
    }

    const engine = await this.resolveTaskEngine(context.agent?.id, useFallbackRoute)
    const prompt = workerPrompt(context, engine, attempt, taskWorktree)
    let modelOpts = this.resolveAgentModel(context.agent, context.role)
    if (useFallbackRoute) {
      modelOpts = fallbackRoute!
      this.pendingFallbackRoutes.delete(taskId)
    }

    if (!taskWorktree) await this.prepareWorkspace(context.project.workspacePath)
    await this.warmProjectTarget(context.project.id)
    await this.capabilities?.assertUsableForAgent(context.agent)
    const sessionEffectKey = `engine.session:${context.task.id}:${attempt}`
    await this.journalEffect({
      kind: 'engine.session',
      state: 'intent',
      companyId: context.company.id,
      projectId: context.project.id,
      taskId: context.task.id,
      idempotencyKey: sessionEffectKey,
      data: { engineId: engine.id, attempt },
    })
    let target: { engineId: string; sessionId: string }
    try {
      target = this.engineRuns
        ? await this.engineRuns.createSession(engine.id, taskWorktree?.root)
        : { engineId: ND_HARNESS_ENGINE_ID, sessionId: await this.createHarnessSession(taskWorktree?.root) }
      await this.journalEffect({
        kind: 'engine.session',
        state: 'complete',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId: context.task.id,
        resourceId: target.sessionId,
        idempotencyKey: sessionEffectKey,
        data: { engineId: target.engineId, attempt },
      })
    } catch (cause) {
      await this.journalEffect({
        kind: 'engine.session',
        state: 'failed',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId: context.task.id,
        idempotencyKey: sessionEffectKey,
        data: { engineId: engine.id, attempt, error: errorMessage(cause) },
      }).catch(() => undefined)
      throw cause
    }
    const run = await this.store.beginRun(
      'task-execution',
      context.company.id,
      context.project.id,
      target.sessionId,
      context.task.id,
      context.task.goalId,
      {
        ...(taskWorktree ? { parallelTask: true } : {}),
        engineId: engine.id,
        workspaceKind: taskWorktree ? 'git-worktree' : 'project-workspace',
        ...(workspaceRoot ? { workspaceRoot } : {}),
        ...(taskWorktree ? { workspaceBranch: taskWorktree.branch } : {}),
        ...(attemptHead ? { baselineCommit: attemptHead } : {}),
        ...(this.executionCoordinator?.currentPermit()?.id ? { runtimePermitId: this.executionCoordinator.currentPermit()!.id } : {}),
      },
    )
    if (taskWorktree && attemptHead) this.executionBaselines.set(target.sessionId, { worktree: taskWorktree, head: attemptHead })
    const effectiveRoute = this.effectiveExecutionRoute(engine.id, attempt, modelOpts)
    this.executionRoutes.set(target.sessionId, effectiveRoute)
    this.noteProviderAttempt(taskId, effectiveRoute)
    this.lastProgressAt.set(target.sessionId, run.startedAt)
    if (fastEscalationReason) taskMetricsRecorder()?.noteEscalation(target.sessionId)

    try {
      await this.store.markExecution(context.task.id, target.sessionId)
      if (this.engineRuns) await this.engineRuns.run(prompt, { sessionId: target.sessionId, ...modelOpts })
      else await this.harness.run(prompt, { sessionId: target.sessionId, ...modelOpts })
    } catch (cause) {
      const message = errorMessage(cause)
      const queued = await this.handleExecutionFailure(run, message)
      this.cleanupSession(target.sessionId)
      if (queued) {
        await delay(retryBackoffMs(attempt))
        await this.continueProject(run.projectId)
      }
      throw cause
    }
    return receipt(run)
  }

  private async runPreparedFastTask(
    context: Awaited<ReturnType<OrganizationStore['taskContext']>>,
    prepared: PreparedFastPath,
    taskWorktree: TaskWorktree | undefined,
    attemptHead: string | undefined,
    attempt: number,
  ): Promise<OrganizationRunReceipt> {
    if (!this.core) throw new Error('ND Core is required for the fast path.')
    const workspaceRoot = taskWorktree?.root ?? context.project.workspacePath
    if (!workspaceRoot) throw new Error('Fast path requires a project workspace.')
    const sessionId = 'fast-' + randomUUID()
    const run = await this.store.beginRun(
      'task-execution',
      context.company.id,
      context.project.id,
      sessionId,
      context.task.id,
      context.task.goalId,
      {
        ...(taskWorktree ? { parallelTask: true } : {}),
        engineId: ND_FAST_PATH_ENGINE_ID,
        workspaceKind: taskWorktree ? 'git-worktree' : 'project-workspace',
        workspaceRoot,
        ...(taskWorktree ? { workspaceBranch: taskWorktree.branch } : {}),
        ...(attemptHead ? { baselineCommit: attemptHead } : {}),
        ...(this.executionCoordinator?.currentPermit()?.id ? { runtimePermitId: this.executionCoordinator.currentPermit()!.id } : {}),
      },
    )
    if (taskWorktree && attemptHead) this.executionBaselines.set(sessionId, { worktree: taskWorktree, head: attemptHead })
    this.executionRoutes.set(sessionId, { engineId: ND_FAST_PATH_ENGINE_ID, attempt })
    this.lastProgressAt.set(sessionId, run.startedAt)
    taskMetricsRecorder()?.noteRoute(sessionId, { engineId: ND_FAST_PATH_ENGINE_ID })

    try {
      await this.store.markExecution(context.task.id, sessionId)
      const fast = await executePreparedFastPath(prepared, this.core)
      const checkpointHead = taskWorktree ? await this.taskWorktrees.checkpoint(taskWorktree, context.task.title) : undefined
      if (checkpointHead) {
        await this.store.updateRunProvenance(run.id, { checkpointCommit: checkpointHead })
        await this.journalEffect({
          kind: 'checkpoint',
          state: 'complete',
          companyId: context.company.id,
          projectId: context.project.id,
          taskId: context.task.id,
          runId: run.id,
          resourceId: checkpointHead,
          idempotencyKey: `checkpoint:${run.id}:${checkpointHead}`,
        })
      }
      const verification = context.task.evidenceKind === 'artifact'
        ? await runArtifactVerification(context.task.artifactPaths, workspaceRoot)
        : await runVerification(context.project.testCommand, workspaceRoot, this.verificationRuntime)
      taskMetricsRecorder()?.noteVerification(sessionId, verification.status, verification.durationMs)
      await this.journalEffect({
        kind: 'verification.receipt',
        state: 'complete',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId: context.task.id,
        runId: run.id,
        idempotencyKey: `verification:${run.id}`,
        data: {
          status: verification.status,
          durationMs: verification.durationMs,
          ...(verification.exitCode === undefined ? {} : { exitCode: verification.exitCode }),
          ...(verification.reason ? { reason: verification.reason } : {}),
        },
      })
      const output = fast.output + formatVerificationEvidence(verification)

      if (verification.status === 'failed') {
        const reason = `Machine verification failed: ${verification.reason ?? `exit ${verification.exitCode ?? 'unknown'}`}`
        await this.store.completeRun(run.id, output, reason)
        await this.failTask(context.task.id, reason)
        const queued = await this.queueVerificationRework(context.task.id, reason)
        this.cleanupTaskRouting(context.task.id)
        this.cleanupSession(sessionId)
        if (queued) await this.continueProject(context.project.id)
        return receipt(run)
      }

      const workflow = await this.workflowKinds(context.project.id)
      if (!workflow.has('review') && taskWorktree) {
        const integrationKey = `integration:${context.task.id}:${run.id}`
        await this.journalEffect({
          kind: 'integration',
          state: 'intent',
          companyId: context.company.id,
          projectId: context.project.id,
          taskId: context.task.id,
          runId: run.id,
          idempotencyKey: integrationKey,
        })
        try {
          const integrated = await this.taskWorktrees.integrate(context.project.workspacePath, context.task.id)
          await this.journalEffect({
            kind: 'integration',
            state: 'complete',
            companyId: context.company.id,
            projectId: context.project.id,
            taskId: context.task.id,
            runId: run.id,
            resourceId: integrated.head,
            idempotencyKey: integrationKey,
          })
          await this.store.markIntegrated(context.task.id, integrated.head)
        } catch (cause) {
          await this.journalEffect({
            kind: 'integration',
            state: cause instanceof TaskIntegrationConflictError ? 'failed' : 'uncertain',
            companyId: context.company.id,
            projectId: context.project.id,
            taskId: context.task.id,
            runId: run.id,
            idempotencyKey: integrationKey,
            data: { error: errorMessage(cause) },
          }).catch(() => undefined)
          throw cause
        }
      }
      await this.store.completeRun(run.id, output)
      if (workflow.has('review')) await this.store.markForReview(context.task.id, output)
      else await this.store.completeWithoutReview(context.task.id, output)
      this.cleanupTaskRouting(context.task.id)
      this.cleanupSession(sessionId)
      return receipt(run)
    } catch (cause) {
      const reason = errorMessage(cause)
      if (await this.store.runBySession(sessionId)) {
        await this.store.completeRun(run.id, undefined, reason).catch(() => undefined)
        await this.failTask(context.task.id, reason)
      }
      this.cleanupTaskRouting(context.task.id)
      this.cleanupSession(sessionId)
      throw new Error('Fast path failed closed: ' + reason)
    }
  }

  async reviewTask(taskId: string, explicit = true): Promise<OrganizationRunReceipt> {
    const context = await this.store.taskContext(taskId)
    this.assertPolicy(await this.store.policy(context.company.id, 'task.review'), explicit, 'task review')
    if (!explicit && context.company.autonomyLevel < 3) throw new Error('Autonomy level 3+ is required for automatic review')
    if (context.task.status !== 'review') throw new Error('Task must be ready for review')
    const reviewer = await this.store.reviewerForTask(taskId)
    const reviewerAgent = reviewer.agent
    const reviewerRole = reviewer.role
    const modelOpts = this.resolveAgentModel(reviewerAgent, reviewerRole)
    const taskWorktree = await this.taskWorktrees.existing(context.project.workspacePath, context.task.id)
    await this.assertTaskRunSlot(context.task.id, context.project.id, Boolean(taskWorktree))
    if (!taskWorktree) await this.prepareWorkspace(context.project.workspacePath)
    const reviewHead = taskWorktree ? await this.taskWorktrees.checkpoint(taskWorktree, context.task.title) : undefined
    const sessionId = await this.createHarnessSession(taskWorktree?.root)
    const run = await this.store.beginRun(
      'task-review',
      context.company.id,
      context.project.id,
      sessionId,
      context.task.id,
      context.task.goalId,
      {
        ...(taskWorktree ? { parallelTask: true } : {}),
        engineId: ND_HARNESS_ENGINE_ID,
        workspaceKind: taskWorktree ? 'git-worktree' : 'project-workspace',
        ...((taskWorktree?.root ?? context.project.workspacePath)
          ? { workspaceRoot: (taskWorktree?.root ?? context.project.workspacePath)! }
          : {}),
        ...(taskWorktree ? { workspaceBranch: taskWorktree.branch } : {}),
        ...(this.executionCoordinator?.currentPermit()?.id ? { runtimePermitId: this.executionCoordinator.currentPermit()!.id } : {}),
      },
    )
    if (reviewHead) await this.store.updateRunProvenance(run.id, { checkpointCommit: reviewHead })
    if (taskWorktree && reviewHead) this.reviewWorktrees.set(sessionId, { worktree: taskWorktree, head: reviewHead })
    this.lastProgressAt.set(sessionId, run.startedAt)
    await this.store.markReviewStarted(taskId, sessionId, reviewerAgent?.id)
    const decisionSupport = await this.decisionSupport?.reviewAssist({
      company: context.company.name,
      project: context.project.name,
      task: {
        id: context.task.id,
        title: context.task.title,
        description: context.task.description,
        acceptanceCriteria: context.task.acceptanceCriteria,
        ...(context.task.workScopes ? { workScopes: context.task.workScopes } : {}),
        ...(context.task.resultSummary ? { resultSummary: context.task.resultSummary } : {}),
      },
    })
    if (decisionSupport) {
      this.decisionSupportReceipts.set(sessionId, decisionSupport)
      await this.journalEffect({
        kind: 'decision.review-assist',
        state: 'complete',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId: context.task.id,
        runId: run.id,
        idempotencyKey: `decision.review-assist:${run.id}`,
        data: {
          mode: decisionSupport.mode,
          threshold: decisionSupport.threshold,
          ...(decisionSupport.selectedProvider ? { selectedProvider: decisionSupport.selectedProvider } : {}),
          escalated: decisionSupport.escalated,
          ...(decisionSupport.kernelError ? { kernelError: decisionSupport.kernelError } : {}),
          attempts: decisionSupport.attempts.map((attempt) => ({
            provider: attempt.provider,
            ok: attempt.ok,
            ...(attempt.result ? {
              model: attempt.result.model,
              minimumConfidence: attempt.result.minimumConfidence,
              latencyMs: attempt.result.latencyMs,
            } : {}),
            ...(attempt.error ? { error: attempt.error } : {}),
          })),
        },
      })
    }
    try {
      await this.harness.run(reviewPrompt(context.task, context, taskWorktree, formatDecisionSupportForReviewer(decisionSupport)), { sessionId, ...modelOpts })
    } catch (cause) {
      const active = await this.store.runBySession(sessionId)
      if (active) {
        await this.store.completeRun(run.id, undefined, errorMessage(cause)).catch(() => undefined)
        await this.store.clearReviewSession(taskId).catch(() => undefined)
      }
      this.cleanupSession(sessionId)
      throw cause
    }
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

    const running = state.runs.filter((item) => item.status === 'running')
    const globalRun = running.find((item) => item.kind === 'pm-plan' || !item.taskId)
    if (globalRun) {
      if (globalRun.projectId === id) return receipt(globalRun)
      if (explicit) throw new Error(`Another project already has an active ${globalRun.kind} run in session ${globalRun.sessionId}`)
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
    if (ready && workflow.has('execute')) {
      const first = await this.runTask(ready.id, explicit)
      if (company.autonomyLevel >= 4) await this.fillParallelReadyTasks(id)
      return first
    }

    if (running.length > 0) return receipt(running.find((item) => item.projectId === id) ?? running[0]!)

    const hasGoals = state.goals.some((goal) => goal.projectId === id)
    if (!hasGoals && workflow.has('plan')) {
      const hasFailedPlan = state.runs.some((run) => run.projectId === id && run.kind === 'pm-plan' && run.status === 'failed')
      if (hasFailedPlan && !explicit) return null
      return this.planProject(id, explicit)
    }
    return null
  }

  /** Cancel one organization run without touching unrelated workers. */
  async cancelRun(runId: string): Promise<void> {
    const state = await this.store.state()
    const run = state.runs.find((item) => item.id === runId && item.status === 'running')
    if (!run) throw new Error('Organization run is not active')
    this.canceledSessions.add(run.sessionId)
    try {
      await this.stopSession(run.sessionId)
    } catch (error) {
      this.canceledSessions.delete(run.sessionId)
      throw error
    }
    const stillActive = await this.store.runBySession(run.sessionId)
    if (stillActive) await this.handleCanceledRun(stillActive, run.sessionId)
  }

  /**
   * Stop every live run for one project before the project is forgotten. Each
   * run goes through the normal cancellation path, so its session is stopped,
   * the task worktree is rolled back to its attempt baseline and the employee
   * that owned it is released. Failures propagate: a project is never forgotten
   * while an agent is still working on it.
   */
  async stopProjectWork(projectId: string): Promise<number> {
    const state = await this.store.state()
    const running = state.runs.filter((run) => run.projectId === projectId && run.status === 'running')
    let stopped = 0
    for (const run of running) {
      try {
        await this.cancelRun(run.id)
        stopped += 1
      } catch (error) {
        // A run that finished on its own between the read and the cancel is done,
        // not a failure to stop.
        const stillRunning = await this.store.activeRun(projectId)
        if (stillRunning) throw error
      }
    }
    return stopped
  }

  /**
   * Called by the existing organization reconciliation loop. A stale session is
   * canceled, rolled back and retried only when Autopilot and bounded policy
   * allow it; the 30-minute task lease is never used as a stall detector.
   */
  async reconcileStalledRuns(now = Date.now()): Promise<number> {
    if (this.stallReconcileBusy) return 0
    this.stallReconcileBusy = true
    let recovered = 0
    try {
      const state = await this.store.state()
      for (const run of state.runs.filter((item) => item.status === 'running' && item.kind === 'task-execution' && item.taskId)) {
        const lastProgress = this.lastProgressAt.get(run.sessionId) ?? run.startedAt
        if (now - lastProgress < stallTimeoutMs()) continue
        const message = `Execution stalled with no engine progress for ${stallTimeoutMs()}ms.`
        try { await this.stopSession(run.sessionId) } catch { /* recovery still fails closed below */ }
        const queued = await this.handleExecutionFailure(run, message, true)
        this.cleanupSession(run.sessionId)
        recovered += 1
        if (queued) {
          await delay(retryBackoffMs(await this.store.executionAttemptCount(run.taskId!)))
          await this.continueProject(run.projectId)
        }
      }
      return recovered
    } finally {
      this.stallReconcileBusy = false
    }
  }

  async handleHarnessEvent(frame: DshEventFrame): Promise<void> {
    const sessionId = frame.sessionId
    if (!sessionId) return
    this.lastProgressAt.set(sessionId, Date.now())
    const run = await this.store.runBySession(sessionId)

    if (frame.kind === 'session-event' && frame.event && run) {
      const data = frame.event.data as Record<string, unknown> | undefined
      const text = frame.event.type === 'assistant/chunk'
        ? messageText(data?.chunk)
        : frame.event.type === 'assistant/message'
          ? messageText(data?.message)
          : undefined
      if (text !== undefined) {
        const accumulated = frame.event.type === 'assistant/chunk'
          ? `${this.finalText.get(sessionId) ?? ''}${text}`
          : text
        this.finalText.set(sessionId, accumulated)
        if (!this.structuredHandled.has(sessionId)) {
          if (run.kind === 'pm-plan') await this.handlePlan(run.projectId, sessionId, accumulated)
          if (run.kind === 'task-review' && run.taskId) await this.handleReview(run.taskId, run.projectId, sessionId, accumulated)
        }
      }
      return
    }

    if (frame.kind === 'agent-error' && run) {
      if (this.consumeCanceledSession(sessionId)) {
        await this.handleCanceledRun(run, sessionId)
        return
      }
      if (run.kind === 'task-execution' && run.taskId) {
        const queued = await this.handleExecutionFailure(run, frame.message ?? 'Agent error')
        this.cleanupSession(sessionId)
        if (queued) {
          await delay(retryBackoffMs(await this.store.executionAttemptCount(run.taskId)))
          await this.continueProject(run.projectId)
        }
        return
      }
      await this.store.completeRun(run.id, this.finalText.get(sessionId), frame.message ?? 'Agent error')
      if (run.taskId) await this.failTask(run.taskId, frame.message ?? 'Agent error')
      this.cleanupSession(sessionId)
      if (run.kind !== 'pm-plan') await this.continueProject(run.projectId)
      return
    }

    if (frame.kind !== 'session-status' || frame.running !== false) return

    const canceled = this.consumeCanceledSession(sessionId)
    if (canceled) {
      if (run) await this.handleCanceledRun(run, sessionId)
      else this.cleanupSession(sessionId)
      return
    }

    if (run?.kind === 'task-execution' && run.taskId) {
      const workerOutput = `${this.finalText.get(sessionId) ?? 'Worker session finished.'}${this.routeEvidence(sessionId)}`
      try {
        const context = await this.store.taskContext(run.taskId)
        const worktree = await this.taskWorktrees.existing(context.project.workspacePath, run.taskId)
        const checkpointHead = worktree ? await this.taskWorktrees.checkpoint(worktree, context.task.title) : undefined
        if (checkpointHead) {
          await this.store.updateRunProvenance(run.id, { checkpointCommit: checkpointHead })
          await this.journalEffect({
            kind: 'checkpoint',
            state: 'complete',
            companyId: context.company.id,
            projectId: context.project.id,
            taskId: context.task.id,
            runId: run.id,
            resourceId: checkpointHead,
            idempotencyKey: `checkpoint:${run.id}:${checkpointHead}`,
          })
        }
        const verification = context.task.evidenceKind === 'artifact'
          ? await runArtifactVerification(context.task.artifactPaths, worktree?.root ?? context.project.workspacePath)
          : await runVerification(context.project.testCommand, worktree?.root ?? context.project.workspacePath, this.verificationRuntime)
        taskMetricsRecorder()?.noteVerification(sessionId, verification.status, verification.durationMs)
        await this.journalEffect({
          kind: 'verification.receipt',
          state: 'complete',
          companyId: context.company.id,
          projectId: context.project.id,
          taskId: context.task.id,
          runId: run.id,
          idempotencyKey: `verification:${run.id}`,
          data: {
            status: verification.status,
            durationMs: verification.durationMs,
            ...(verification.exitCode === undefined ? {} : { exitCode: verification.exitCode }),
            ...(verification.reason ? { reason: verification.reason } : {}),
          },
        })
        const output = `${workerOutput}${formatVerificationEvidence(verification)}`
        if (verification.status === 'failed') {
          const message = `Machine verification failed: ${verification.reason ?? `exit ${verification.exitCode ?? 'unknown'}`}`
          await this.store.completeRun(run.id, output, message)
          await this.failTask(run.taskId, message)
          const queued = await this.queueVerificationRework(run.taskId, message)
          this.cleanupTaskRouting(run.taskId)
          this.cleanupSession(sessionId)
          if (queued) await this.continueProject(run.projectId)
          return
        }
        const workflow = await this.workflowKinds(run.projectId)
        if (!workflow.has('review') && worktree) {
          const integrationKey = `integration:${run.taskId}:${run.id}`
          await this.journalEffect({
            kind: 'integration',
            state: 'intent',
            companyId: context.company.id,
            projectId: context.project.id,
            taskId: run.taskId,
            runId: run.id,
            idempotencyKey: integrationKey,
          })
          try {
            const integrated = await this.taskWorktrees.integrate(context.project.workspacePath, run.taskId)
            await this.journalEffect({
              kind: 'integration',
              state: 'complete',
              companyId: context.company.id,
              projectId: context.project.id,
              taskId: run.taskId,
              runId: run.id,
              resourceId: integrated.head,
              idempotencyKey: integrationKey,
            })
            await this.store.markIntegrated(run.taskId, integrated.head)
          } catch (cause) {
            await this.journalEffect({
              kind: 'integration',
              state: cause instanceof TaskIntegrationConflictError ? 'failed' : 'uncertain',
              companyId: context.company.id,
              projectId: context.project.id,
              taskId: run.taskId,
              runId: run.id,
              idempotencyKey: integrationKey,
              data: { error: errorMessage(cause) },
            }).catch(() => undefined)
            throw cause
          }
        }
        await this.store.completeRun(run.id, output)
        if (workflow.has('review')) await this.store.markForReview(run.taskId, output)
        else await this.store.completeWithoutReview(run.taskId, output)
        this.cleanupTaskRouting(run.taskId)
      } catch (cause) {
        const message = errorMessage(cause)
        await this.store.completeRun(run.id, workerOutput, message).catch(() => undefined)
        if (cause instanceof TaskIntegrationConflictError) {
          await this.store.markIntegrationConflict(run.taskId, message).catch(() => undefined)
        } else {
          await this.failTask(run.taskId, message)
        }
      }
      this.cleanupSession(sessionId)
      await this.continueProject(run.projectId)
      return
    }

    if (run && this.structuredHandled.has(sessionId)) {
      await this.store.completeRun(run.id, this.finalText.get(sessionId))
    } else if (run && (run.kind === 'pm-plan' || run.kind === 'task-review')) {
      await delay(STRUCTURED_RESULT_GRACE_MS)
      const reopened = await this.store.runBySession(sessionId)
      if (!reopened) {
        this.cleanupSession(sessionId)
        return
      }
      if (this.structuredHandled.has(sessionId)) {
        await this.store.completeRun(run.id, this.finalText.get(sessionId))
      } else {
        const detail = this.structuredErrors.get(sessionId)
        const message = detail
          ? `Structured ${run.kind} failed: ${detail}`
          : `Expected structured ${run.kind} result was not produced`
        await this.store.completeRun(run.id, this.finalText.get(sessionId), message)
        if (run.taskId) {
          // Keep the completed worker evidence reviewable. A malformed or
          // truncated reviewer response is a retryable review failure, not a
          // reason to hide the task behind the blocked state.
          await this.store.clearReviewSession(run.taskId)
        }
      }
    } else if (run) {
      const detail = this.structuredErrors.get(sessionId)
      const message = detail
        ? `Structured ${run.kind} failed: ${detail}`
        : `Expected structured ${run.kind} result was not produced`
      await this.store.completeRun(run.id, this.finalText.get(sessionId), message)
      if (run.taskId) await this.failTask(run.taskId, detail ? `Structured review failed: ${detail}` : 'Structured review result was not produced')
    }

    const project = this.autoAdvance.get(sessionId)
    this.cleanupSession(sessionId)
    if (project) await this.continueProject(project)
  }

  private async handlePlan(projectId: string, sessionId: string, text: string): Promise<void> {
    let plan: ProjectPlanInput | undefined
    try {
      plan = extractTaggedJson<ProjectPlanInput>(text, 'nd-dsh-plan', ['goal', 'milestones'])
      if (!plan) return
      validatePlan(plan)
      this.structuredErrors.delete(sessionId)
    } catch (cause) {
      this.structuredErrors.set(sessionId, errorMessage(cause))
      return
    }
    if (this.structuredInFlight.has(sessionId)) return
    this.structuredInFlight.add(sessionId)
    try {
      await this.store.applyPlan(projectId, plan)
    } catch (cause) {
      this.structuredErrors.set(sessionId, `Failed to apply plan: ${errorMessage(cause)}`)
      throw cause
    } finally {
      this.structuredInFlight.delete(sessionId)
    }
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async handleReview(taskId: string, projectId: string, sessionId: string, text: string): Promise<void> {
    let review: ReviewVerdict | undefined
    try {
      review = extractTaggedJson<ReviewVerdict>(text, 'nd-dsh-review', ['verdict', 'summary'])
      if (!review) return
      if ((review.verdict !== 'pass' && review.verdict !== 'fail') || typeof review.summary !== 'string' || !review.summary.trim()) {
        throw new Error('Invalid ND-DSH review result: verdict must be pass or fail with non-empty summary')
      }
      this.structuredErrors.delete(sessionId)
    } catch (cause) {
      this.structuredErrors.set(sessionId, errorMessage(cause))
      return
    }
    if (this.structuredInFlight.has(sessionId)) return
    this.structuredInFlight.add(sessionId)
    try {
      const issueText = review.issues?.length ? `\nIssues: ${review.issues.join('; ')}` : ''
      let summary = `${review.summary}${issueText}${formatDecisionSupportReceipt(this.decisionSupportReceipts.get(sessionId))}`
      const context = await this.store.taskContext(taskId)
      const reviewRun = await this.store.runBySession(sessionId)
      const reviewRunId = reviewRun?.id ?? sessionId
      let passed = review.verdict === 'pass'
      let integrationConflict = false
      if (passed) {
        const checkpoint = this.reviewWorktrees.get(sessionId)
        if (checkpoint) {
          const integrationKey = `integration:${taskId}:${sessionId}`
          try {
            await this.taskWorktrees.assertUnchanged(checkpoint.worktree, checkpoint.head)
            await this.journalEffect({
              kind: 'integration',
              state: 'intent',
              companyId: context.company.id,
              projectId: context.project.id,
              taskId,
              runId: reviewRunId,
              idempotencyKey: integrationKey,
            })
            const integrated = await this.taskWorktrees.integrate(context.project.workspacePath, taskId)
            await this.journalEffect({
              kind: 'integration',
              state: 'complete',
              companyId: context.company.id,
              projectId: context.project.id,
              taskId,
              runId: sessionId,
              resourceId: integrated.head,
              idempotencyKey: integrationKey,
            })
            await this.store.markIntegrated(taskId, integrated.head)
          } catch (cause) {
            await this.journalEffect({
              kind: 'integration',
              state: cause instanceof TaskIntegrationConflictError ? 'failed' : 'uncertain',
              companyId: context.company.id,
              projectId: context.project.id,
              taskId,
              runId: reviewRunId,
              idempotencyKey: integrationKey,
              data: { error: errorMessage(cause) },
            }).catch(() => undefined)
            passed = false
            integrationConflict = cause instanceof TaskIntegrationConflictError
            summary = `${summary}\nIntegration/evidence gate: ${errorMessage(cause)}`
            if (integrationConflict) await this.store.markIntegrationConflict(taskId, summary)
          }
        }
      }
      const executionAttempts = await this.store.executionAttemptCount(taskId)
      const automaticRework = !passed
        && !integrationConflict
        && context.company.autonomyLevel >= 4
        && executionAttempts < MAX_EXECUTION_ATTEMPTS

      await this.journalEffect({
        kind: 'review.result',
        state: 'complete',
        companyId: context.company.id,
        projectId: context.project.id,
        taskId,
        runId: reviewRunId,
        idempotencyKey: `review:${taskId}:${reviewRunId}`,
        data: {
          verdict: passed ? 'pass' : 'fail',
          issueCount: review.issues?.length ?? 0,
          integrationConflict,
        },
      })
      await this.store.completeReview(taskId, passed, summary, review.memory ?? [])
      if (automaticRework) await this.store.queueRework(taskId, summary)
    } finally {
      this.structuredInFlight.delete(sessionId)
    }
    this.structuredHandled.add(sessionId)
    this.autoAdvance.set(sessionId, projectId)
  }

  private async handleExecutionFailure(run: OrganizationRun, message: string, stalled = false): Promise<boolean> {
    if (!run.taskId) return false
    const active = await this.store.runBySession(run.sessionId)
    if (!active) return false
    const rollback = await this.rollbackExecutionAttempt(run.sessionId)
    const detail = rollback ? message : `${message}\nRollback failed; automatic retry disabled.`
    const output = `${this.finalText.get(run.sessionId) ?? ''}${this.routeEvidence(run.sessionId)}` || undefined
    await this.store.completeRun(run.id, output, detail).catch(() => undefined)
    await this.failTask(run.taskId, detail)
    if (!rollback) return false
    const context = await this.store.taskContext(run.taskId)
    const attempts = await this.store.executionAttemptCount(run.taskId)
    const retryable = stalled || isRetryableExecutionFailure(message)
    if (context.company.autonomyLevel < 4 || attempts >= MAX_EXECUTION_ATTEMPTS || !retryable) return false
    const fallback = await this.selectFallbackProviderRoute(context)
    if (fallback) this.pendingFallbackRoutes.set(run.taskId, fallback)
    await this.store.queueRework(run.taskId, `${stalled ? 'Stall recovery' : 'Transient engine/provider failure'}: ${message}`)
    return true
  }

  private async queueVerificationRework(taskId: string, message: string): Promise<boolean> {
    const context = await this.store.taskContext(taskId)
    const attempts = await this.store.executionAttemptCount(taskId)
    if (context.company.autonomyLevel < 4 || attempts >= MAX_EXECUTION_ATTEMPTS) return false
    await this.store.queueRework(taskId, message)
    return true
  }

  private async handleCanceledRun(run: OrganizationRun, sessionId: string): Promise<void> {
    const message = 'Canceled by user before the run completed.'
    taskMetricsRecorder()?.noteCanceled(sessionId)
    if (run.kind === 'task-execution') await this.rollbackExecutionAttempt(sessionId)
    const output = `${this.finalText.get(sessionId) ?? ''}${this.routeEvidence(sessionId)}` || undefined
    await this.store.completeRun(run.id, output, message)
    if (run.taskId) {
      await this.failTask(run.taskId, message)
      this.cleanupTaskRouting(run.taskId)
    }
    this.cleanupSession(sessionId)
  }

  private async rollbackExecutionAttempt(sessionId: string): Promise<boolean> {
    const boundary = this.executionBaselines.get(sessionId)
    if (!boundary) return false
    try {
      await this.taskWorktrees.rollback(boundary.worktree, boundary.head)
      return true
    } catch (error) {
      console.warn('Organization attempt rollback failed:', errorMessage(error))
      return false
    }
  }

  private async selectFallbackProviderRoute(context: Awaited<ReturnType<OrganizationStore['taskContext']>>): Promise<ProviderRoute | undefined> {
    const attempted = this.attemptedProviderRoutes.get(context.task.id) ?? new Set<string>()
    const assignedEngineId = this.engines ? await this.engines.assignedEngine(context.agent?.id) : ND_HARNESS_ENGINE_ID
    if (assignedEngineId === ND_HARNESS_ENGINE_ID && attempted.size === 0) {
      const configured = this.resolveAgentModel(context.agent, context.role)
      const provider = configured.provider ?? this.harness.status().provider
      const model = configured.model ?? this.harness.status().model
      if (provider && model) attempted.add(providerRouteKey(provider, model))
    }
    this.attemptedProviderRoutes.set(context.task.id, attempted)

    const catalog = await this.harness.gatewayRpc('session.models').catch(() => undefined)
    if (!catalog?.ok || !catalog.value || typeof catalog.value !== 'object') return undefined
    const groups = (catalog.value as { groups?: unknown }).groups
    if (!Array.isArray(groups)) return undefined
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue
      const provider = typeof (group as { id?: unknown }).id === 'string' ? (group as { id: string }).id.trim() : ''
      const models = (group as { models?: unknown }).models
      if (!provider || !Array.isArray(models)) continue
      for (const item of models) {
        if (!item || typeof item !== 'object') continue
        const model = typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id.trim() : ''
        if (!model || attempted.has(providerRouteKey(provider, model))) continue
        return { provider, model }
      }
    }
    return undefined
  }

  private effectiveExecutionRoute(engineId: string, attempt: number, modelOpts: { provider?: string; model?: string }): ExecutionRoute {
    if (engineId !== ND_HARNESS_ENGINE_ID) return { engineId, attempt }
    const provider = modelOpts.provider ?? this.harness.status().provider
    const model = modelOpts.model ?? this.harness.status().model
    return {
      engineId,
      attempt,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }
  }

  private noteProviderAttempt(taskId: string, route: ExecutionRoute): void {
    if (!route.provider || !route.model) return
    const routes = this.attemptedProviderRoutes.get(taskId) ?? new Set<string>()
    routes.add(providerRouteKey(route.provider, route.model))
    this.attemptedProviderRoutes.set(taskId, routes)
  }

  private routeEvidence(sessionId: string): string {
    const route = this.executionRoutes.get(sessionId)
    return route ? `\n\n<nd-dsh-execution-route>${JSON.stringify(route)}</nd-dsh-execution-route>` : ''
  }

  private async journalEffect(input: {
    kind: string
    state: 'intent' | 'complete' | 'failed' | 'uncertain'
    companyId?: string
    projectId?: string
    taskId?: string
    runId?: string
    resourceId?: string
    idempotencyKey?: string
    data?: unknown
  }): Promise<void> {
    if (!this.core) return
    await this.core.request('effectJournal.append', {
      kind: input.kind,
      state: input.state,
      ...(input.companyId ? { companyId: input.companyId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.data === undefined ? {} : { data: input.data }),
    }, 5_000)
  }

  private cleanupTaskRouting(taskId: string): void {
    this.attemptedProviderRoutes.delete(taskId)
    this.pendingFallbackRoutes.delete(taskId)
  }

  private async stopSession(sessionId: string): Promise<void> {
    if (this.executionRoutes.get(sessionId)?.engineId === ND_FAST_PATH_ENGINE_ID) return
    if (this.engineRuns) return this.engineRuns.stopSession(sessionId)
    const result = await this.harness.gatewayRpc('session.cancel', { sessionId })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.cancel failed')
  }

  private consumeCanceledSession(sessionId: string): boolean {
    if (this.canceledSessions.delete(sessionId)) return true
    return this.harness.consumeCanceledSession(sessionId)
  }

  private async continueProject(projectId: string): Promise<void> {
    try {
      await this.runNext(projectId, false)
    } catch (error) {
      console.warn('Organization autopilot paused:', error instanceof Error ? error.message : String(error))
    }
  }

  private async fillParallelReadyTasks(projectId: string): Promise<void> {
    if (this.parallelFillProjects.has(projectId)) return
    this.parallelFillProjects.add(projectId)
    try {
      // The bound is an iteration guard, not a capacity decision: it caps how
      // many candidates one round inspects and how many runs it starts. Every
      // dispatch still acquires its own permit, and the availability probe is
      // what ends a round when a pool is full.
      for (let attempt = 0; attempt < MAX_AUTOPILOT_PARALLEL_FILL; attempt += 1) {
        const state = await this.store.state()
        const project = state.projects.find((item) => item.id === projectId)
        const company = project ? state.companies.find((item) => item.id === project.companyId) : undefined
        if (!project || company?.autonomyLevel !== 4) return
        const { task, capacityBound } = await this.nextDispatchableTask(projectId)
        if (!task) {
          if (capacityBound) this.capacityWaiting.add(projectId)
          else this.capacityWaiting.delete(projectId)
          return
        }
        this.capacityWaiting.delete(projectId)
        try {
          await this.runTask(task.id, false)
        } catch (error) {
          // A pool filled between the probe and the acquire. The run never
          // started, so no task record and no run receipt claim a failure; the
          // round just waits for the next release.
          if (error instanceof RuntimeCapacityError) {
            this.capacityWaiting.add(projectId)
            return
          }
          console.warn('Parallel autopilot fill paused:', errorMessage(error))
          return
        }
      }
    } finally {
      this.parallelFillProjects.delete(projectId)
    }
  }

  /**
   * The ready task this round should dispatch next, plus whether the round is
   * ending because every candidate hit a full pool. A full project pool refuses
   * all of them; a full role or team pool refuses only the tasks that carry it,
   * so a lower-priority task can still proceed.
   */
  private async nextDispatchableTask(projectId: string): Promise<{ task: OrganizationTask | undefined; capacityBound: boolean }> {
    const candidates = (await this.store.readyTasks(projectId)).slice(0, MAX_AUTOPILOT_PARALLEL_FILL)
    if (!this.dispatchAvailability) return { task: candidates[0], capacityBound: false }
    let capacityBound = false
    for (const candidate of candidates) {
      const availability = await this.dispatchAvailability(projectId, candidate.id, 'task.execute')
      if (availability.granted) return { task: candidate, capacityBound }
      if (availability.blockedPool) capacityBound = true
    }
    return { task: undefined, capacityBound }
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
    if (task.assignedAgentId) {
      const hasOtherActiveRun = state.runs.some((run) => run.status === 'running' && run.taskId && run.taskId !== taskId
        && state.tasks.find((candidate) => candidate.id === run.taskId)?.assignedAgentId === task.assignedAgentId)
      if (!hasOtherActiveRun) {
        await this.store.mutate({ type: 'agent.update', id: task.assignedAgentId, patch: { status: 'idle' } }).catch(() => undefined)
      }
    }
    console.warn(`Organization task blocked: ${message}`)
  }

  private async assertNoActiveRun(projectId: string): Promise<void> {
    const active = (await this.store.state()).runs.find((item) => item.status === 'running')
    if (!active) return
    if (active.projectId === projectId) throw new Error(`Project already has an active ${active.kind} run in session ${active.sessionId}`)
    throw new Error(`Another project already has an active ${active.kind} run in session ${active.sessionId}`)
  }

  private async assertTaskRunSlot(taskId: string, projectId: string, isolated: boolean): Promise<void> {
    const state = await this.store.state()
    const active = state.runs.filter((item) => item.status === 'running')
    if (active.length === 0) return
    if (!isolated) throw new Error('Task cannot run beside another organization run without an isolated Git worktree')
    const global = active.find((item) => item.kind === 'pm-plan' || !item.taskId)
    if (global) throw new Error(`Global ${global.kind} run is active in session ${global.sessionId}`)
    const sameTask = active.find((item) => item.taskId === taskId)
    if (sameTask) throw new Error(`Task already has an active ${sameTask.kind} run in session ${sameTask.sessionId}`)
    // Agent records are logical employees, not single OS worker slots. The
    // control plane owns bounded capacity; isolated task worktrees own safety.
    for (const run of active) {
      if (!run.taskId) throw new Error('Non-task organization work cannot overlap task execution')
      const context = await this.store.taskContext(run.taskId)
      const worktree = await this.taskWorktrees.existing(context.project.workspacePath, run.taskId)
      if (!worktree) throw new Error(`Active task ${run.taskId} is not isolated in a Git worktree`)
    }
    const project = state.projects.find((item) => item.id === projectId)
    if (!project) throw new Error('Project not found')
  }

  private async resolveTaskEngine(agentId: string | undefined, fallback: boolean): Promise<TaskEngine> {
    if (!this.engines || fallback) {
      if (this.engines && fallback) {
        const descriptor = this.engines.assertAvailable(ND_HARNESS_ENGINE_ID)
        return { id: descriptor.id, name: descriptor.name, ...(descriptor.workerInstructions === undefined ? {} : { workerInstructions: descriptor.workerInstructions }) }
      }
      return { id: ND_HARNESS_ENGINE_ID, name: 'ND Harness' }
    }
    const engineId = await this.engines.assignedEngine(agentId)
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
    void this.executionCoordinator?.releaseSession(sessionId).catch((error) => {
      console.warn('Runtime permit release failed:', error instanceof Error ? error.message : String(error))
    })
    this.finalText.delete(sessionId)
    this.structuredHandled.delete(sessionId)
    this.structuredInFlight.delete(sessionId)
    this.structuredErrors.delete(sessionId)
    this.autoAdvance.delete(sessionId)
    this.reviewWorktrees.delete(sessionId)
    this.executionBaselines.delete(sessionId)
    this.executionRoutes.delete(sessionId)
    this.canceledSessions.delete(sessionId)
    this.lastProgressAt.delete(sessionId)
    this.decisionSupportReceipts.delete(sessionId)
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

  private async createHarnessSession(cwd?: string): Promise<string> {
    if (!cwd) return this.harness.createSession()
    const result = await this.harness.gatewayRpc('session.create', { cwd })
    if (!result.ok) throw new Error(result.error?.message ?? 'Harness session.create failed')
    const sessionId = (result.value as { sessionId?: unknown } | undefined)?.sessionId
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Harness session.create returned no session id')
    return sessionId
  }

  private async warmProjectTarget(projectId: string): Promise<void> {
    if (!this.projectRuntime) return
    try {
      await this.projectRuntime.check(projectId)
    } catch (error) {
      console.warn('Project target check skipped:', error instanceof Error ? error.message : String(error))
    }
  }
}

function pmPrompt(context: Awaited<ReturnType<OrganizationStore['projectContext']>>): string {
  const roles = context.roles.map((item) => `- ${item.name}: ${item.responsibility}`).join('\n') || '- Software Engineer'
  const teams = context.teams.map((item) => `- ${item.name}: ${item.purpose}`).join('\n') || '- Engineering'
  return `You are the AI Product Manager for ${context.company.name}.\nMission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\n\nCreate a practical delivery plan. Respect company/project isolation. Use the existing teams and roles when assigning work. Keep independent work parallel: use dependsOn only for real code/data ordering, never merely to serialize execution. Tests, docs, accessibility, i18n, fixtures and independent components should remain parallel when safe. For each task, declare advisory workScopes when the likely file area is known. Use evidenceKind "artifact" with relative artifactPaths for design, research, or document deliverables that should be verified by produced artifacts instead of a code test command. Return concise reasoning, then exactly one JSON object between <nd-dsh-plan> and </nd-dsh-plan>.\n\nSchema:\n<nd-dsh-plan>{"goal":{"title":"...","description":"..."},"milestones":[{"title":"...","description":"...","tasks":[{"title":"...","description":"...","priority":"medium","acceptanceCriteria":["..."],"dependsOn":["earlier task title"],"role":"Software Engineer","workScopes":["src/feature/**"],"evidenceKind":"code","artifactPaths":[]}]}],"memory":[{"title":"...","content":"...","tags":["plan"]}]}</nd-dsh-plan>\n\nAvailable roles:\n${roles}\nAvailable teams:\n${teams}\nKnown memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}`
}

function workerPrompt(context: Awaited<ReturnType<OrganizationStore['taskContext']>>, engine: TaskEngine, attempt: number, worktree?: TaskWorktree): string {
  const reviewFeedback = context.task.reviewSummary
    ? `\nPrevious independent review feedback:\n${context.task.reviewSummary}\nResolve every relevant issue before declaring the task complete.\n`
    : ''
  const engineInstructions = engine.workerInstructions ?? DEFAULT_WORKER_INSTRUCTIONS
  const isolation = worktree
    ? `\nND task isolation: this session is already rooted at the dedicated worktree ${worktree.root}. Stay on branch ${worktree.branch}; do not switch worktrees/branches, push, merge into the project branch, or modify the base checkout. ND will checkpoint and integrate only after verification.\n`
    : ''
  return `You are ${context.agent?.name ?? 'an AI worker'} acting as ${context.role?.name ?? 'Software Engineer'} inside company ${context.company.name}.\nCompany mission: ${context.company.mission}\nProject: ${context.project.name}\nObjective: ${context.project.objective}\nTask: ${context.task.title}\nExecution attempt: ${attempt}/${MAX_EXECUTION_ATTEMPTS}\nDescription: ${context.task.description}\nAcceptance criteria:\n${context.task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}${reviewFeedback}\nResponsibilities: ${context.role?.responsibility ?? 'Complete the assigned work.'}\nRole instructions: ${context.role?.systemPrompt ?? 'Execute carefully and verify the result.'}\nRelevant skills:\n${context.skills.map((item) => `- ${item.name}: ${item.instructions}`).join('\n')}\nRelevant memory:\n${context.memory.map((item) => `- ${item.title}: ${item.content}`).join('\n') || '- none'}\nPolicies:\n${context.policies.map((item) => `- ${item.action}: ${item.effect}`).join('\n')}${engineInstructions}${isolation}\nInspect before editing, run meaningful validation, and finish with a concise result summary for the independent reviewer.`
}

function reviewPrompt(task: OrganizationTask, context: Awaited<ReturnType<OrganizationStore['taskContext']>>, worktree?: TaskWorktree, decisionSupport = ''): string {
  const isolation = worktree
    ? `\nReview the isolated task branch ${worktree.branch} in the current worktree. Do not edit, commit, switch branches, merge, or push; a PASS is valid only while the exact checkpoint stays unchanged.\n`
    : ''
  return `You are an independent reviewer for ${context.company.name}. Do not assume the worker succeeded. Inspect the actual workspace and verify the task against acceptance criteria. ND machine verification has already run when a project test command is configured; reviewer prose cannot override a red machine check.\nProject: ${context.project.name}\nTask: ${task.title}\nDescription: ${task.description}\nAcceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}\nWorker summary:\n${task.resultSummary ?? 'No summary provided.'}${isolation}${decisionSupport}\n\nRun relevant additional checks. Then return exactly one JSON object between <nd-dsh-review> and </nd-dsh-review>:\n<nd-dsh-review>{"verdict":"pass|fail","summary":"evidence-based review","issues":["..."],"memory":[{"title":"lesson","content":"durable lesson","tags":["review"]}]}</nd-dsh-review>`
}

function receipt(run: OrganizationRun): OrganizationRunReceipt {
  return {
    runId: run.id,
    sessionId: run.sessionId,
    projectId: run.projectId,
    ...(run.taskId ? { taskId: run.taskId } : {}),
    kind: run.kind,
    ...(run.engineId ? { engineId: run.engineId } : {}),
    ...(run.workspaceKind ? { workspaceKind: run.workspaceKind } : {}),
    ...(run.workspaceRoot ? { workspaceRoot: run.workspaceRoot } : {}),
    ...(run.workspaceBranch ? { workspaceBranch: run.workspaceBranch } : {}),
    ...(run.baselineCommit ? { baselineCommit: run.baselineCommit } : {}),
    ...(run.checkpointCommit ? { checkpointCommit: run.checkpointCommit } : {}),
    ...(run.runtimePermitId ? { runtimePermitId: run.runtimePermitId } : {}),
  }
}

function providerRouteKey(provider: string, model: string): string {
  const route = provider === 'deepseek' ? 'deepseek-official' : provider
  return `${route.trim()}::${model.trim()}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function messageText(message: unknown): string | undefined {
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return undefined
  const record = message as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (record.delta && typeof record.delta === 'object') return messageText(record.delta)
  const content = record.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((block) => block && typeof block === 'object' && ['text', 'text-delta', 'output_text'].includes(String((block as Record<string, unknown>).type)) && typeof (block as Record<string, unknown>).text === 'string' ? [(block as Record<string, string>).text] : [])
  return parts.length ? parts.join('\n') : undefined
}

function extractJsonObjectString(text: string, requiredMarkers?: string[]): string | undefined {
  let searchIndex = 0
  while (searchIndex < text.length) {
    const start = text.indexOf('{', searchIndex)
    if (start === -1) return undefined
    let depth = 0
    let inString = false
    let escaped = false
    let end = -1
    for (let i = start; i < text.length; i++) {
      const char = text[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (char === '{') depth++
        else if (char === '}') {
          depth--
          if (depth === 0) {
            end = i + 1
            break
          }
        }
      }
    }
    if (end === -1) {
      return undefined
    }
    const candidate = text.slice(start, end)
    if (!requiredMarkers || requiredMarkers.every((marker) => candidate.includes(marker))) {
      return candidate
    }
    searchIndex = start + 1
  }
  return undefined
}

function sanitizeJson(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  return cleaned.replace(/,(\s*[}\]])/g, '$1')
}

function extractTaggedJson<T>(text: string, tag: string, fallbackMarkers?: string[]): T | undefined {
  const tagRegex = new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|$)`, 'i')
  const match = tagRegex.exec(text)
  let candidateText: string | undefined
  if (match?.[1]?.trim()) {
    candidateText = match[1]
  } else if (fallbackMarkers && fallbackMarkers.some((marker) => text.includes(marker))) {
    candidateText = text
  }

  if (!candidateText) return undefined

  const jsonObject = extractJsonObjectString(candidateText, fallbackMarkers)
  if (!jsonObject) return undefined

  const sanitized = sanitizeJson(jsonObject)
  return JSON.parse(sanitized) as T
}

function validatePlan(plan: ProjectPlanInput): void {
  if (!plan?.goal?.title?.trim() || !plan.goal.description?.trim() || !Array.isArray(plan.milestones) || plan.milestones.length === 0) throw new Error('Invalid ND-DSH project plan')
  const tasks = plan.milestones.flatMap((milestone) => {
    if (!milestone.title?.trim() || !Array.isArray(milestone.tasks) || milestone.tasks.length === 0) throw new Error('Every milestone needs a title and tasks')
    return milestone.tasks
  })
  const titleMap = new Map<string, ProjectPlanInput['milestones'][number]['tasks'][number]>()
  for (const task of tasks) {
    const key = task.title.trim().toLowerCase()
    if (!key) throw new Error('Every planned task needs a title')
    if (titleMap.has(key)) throw new Error(`Duplicate planned task title: ${task.title}`)
    titleMap.set(key, task)
  }
  const graph = new Map<string, string[]>()
  for (const [key, task] of titleMap) {
    const dependencies = (task.dependsOn ?? []).map((value) => value.trim().toLowerCase())
    for (const dependency of dependencies) {
      if (!titleMap.has(dependency)) throw new Error(`Unknown planned task dependency: ${dependency}`)
      if (dependency === key) throw new Error(`Task cannot depend on itself: ${task.title}`)
    }
    if (task.workScopes !== undefined && (!Array.isArray(task.workScopes) || task.workScopes.some((value) => typeof value !== 'string' || !value.trim()))) throw new Error(`Invalid workScopes for planned task: ${task.title}`)
    if (task.evidenceKind !== undefined && task.evidenceKind !== 'code' && task.evidenceKind !== 'artifact') throw new Error(`Invalid evidenceKind for planned task: ${task.title}`)
    if (task.evidenceKind === 'artifact' && (!Array.isArray(task.artifactPaths) || task.artifactPaths.length === 0)) throw new Error(`Artifact planned task requires artifactPaths: ${task.title}`)
    graph.set(key, dependencies)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (key: string): void => {
    if (visited.has(key)) return
    if (visiting.has(key)) throw new Error(`Planned task dependency cycle detected at ${titleMap.get(key)?.title ?? key}`)
    visiting.add(key)
    for (const dependency of graph.get(key) ?? []) visit(dependency)
    visiting.delete(key)
    visited.add(key)
  }
  for (const key of graph.keys()) visit(key)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}