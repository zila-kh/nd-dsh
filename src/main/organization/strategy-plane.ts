import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { OrganizationControlSnapshot } from '../../shared/organization-control.js'
import type { OrganizationSnapshot } from '../../shared/organization.js'
import {
  releaseReadinessFrom,
  type CompanyScheduleOutcome,
  type OrganizationActionAuditReceipt,
  type OrganizationCompanyKnowledge,
  type OrganizationCompanySchedule,
  type OrganizationHeartbeat,
  type OrganizationAutomationTrigger,
  type OrganizationSkillCandidate,
  type OrganizationTriggerReceipt,
  type OrganizationStrategicAnchor,
  type OrganizationStrategyMutation,
  type OrganizationStrategyProjection,
  type OrganizationStrategySnapshot,
} from '../../shared/organization-strategy.js'
import { nextCronAt, validateCron } from './cron.js'
import type { OrganizationStore } from './store.js'

const EMPTY: OrganizationStrategySnapshot = {
  version: 1,
  anchors: [],
  knowledge: [],
  schedules: [],
  heartbeats: [],
  triggers: [],
  triggerReceipts: [],
  skillCandidates: [],
  audit: [],
}

/**
 * Durable company strategy and long-horizon operating state. Execution remains
 * owned by OrganizationControlPlane + OrganizationOrchestrator; this layer owns
 * focus, durable company knowledge, recurring intent and normalized audit data.
 */
export class OrganizationStrategyPlane {
  private loaded = false
  private value: OrganizationStrategySnapshot = clone(EMPTY)
  private saveChain: Promise<void> = Promise.resolve()
  private onChanged: ((state: OrganizationStrategySnapshot) => void) | undefined

  constructor(
    private readonly filePath: string,
    private readonly store: Pick<OrganizationStore, 'state' | 'mutate'>,
  ) {}

  setOnChanged(listener: ((state: OrganizationStrategySnapshot) => void) | undefined): void {
    this.onChanged = listener
  }

  async state(): Promise<OrganizationStrategySnapshot> {
    await this.load()
    return clone(this.value)
  }

  async mutate(mutation: OrganizationStrategyMutation): Promise<OrganizationStrategySnapshot> {
    await this.load()
    const organization = await this.store.state()
    switch (mutation.type) {
      case 'anchor.add': this.addAnchor(organization, mutation); break
      case 'anchor.update': this.updateAnchor(mutation.id, mutation.patch); break
      case 'knowledge.add': this.addKnowledge(organization, mutation); break
      case 'knowledge.update': this.updateKnowledge(mutation.id, mutation.patch); break
      case 'schedule.add': this.addSchedule(organization, mutation); break
      case 'schedule.update': this.updateSchedule(mutation.id, mutation.patch); break
      case 'heartbeat.add': this.addHeartbeat(organization, mutation); break
      case 'heartbeat.update': this.updateHeartbeat(mutation.id, mutation.patch); break
      case 'trigger.add': this.addTrigger(organization, mutation); break
      case 'trigger.update': this.updateTrigger(mutation.id, mutation.patch); break
      case 'skill-candidate.add': this.addSkillCandidate(organization, mutation); break
      case 'skill-candidate.update': this.updateSkillCandidate(mutation.id, mutation.patch); break
      case 'skill-candidate.promote': await this.promoteSkillCandidate(mutation.id); break
      case 'action.record': this.recordAction(organization, mutation); break
    }
    await this.save()
    return clone(this.value)
  }

  async projection(projectId: string | undefined, control: OrganizationControlSnapshot): Promise<OrganizationStrategyProjection> {
    await this.load()
    const organization = await this.store.state()
    const project = projectId
      ? organization.projects.find((item) => item.id === projectId)
      : organization.projects.find((item) => item.id === organization.activeProjectId)
    const companyId = project?.companyId ?? organization.activeCompanyId
    const companyFilter = (id: string): boolean => !companyId || id === companyId
    const projectFilter = (id: string | undefined): boolean => !project || id === undefined || id === project.id
    const activeAnchors = this.value.anchors.filter((item) => companyFilter(item.companyId) && projectFilter(item.projectId) && (item.status === 'active' || item.status === 'proposed'))
    const activeKnowledge = this.value.knowledge.filter((item) => companyFilter(item.companyId) && projectFilter(item.projectId) && item.status === 'active')
    const schedules = this.value.schedules.filter((item) => companyFilter(item.companyId) && (!project || item.projectId === project.id))
    const heartbeats = this.value.heartbeats.filter((item) => companyFilter(item.companyId) && (!project || item.projectId === project.id))
    const triggers = this.value.triggers.filter((item) => companyFilter(item.companyId) && (!project || item.projectId === project.id))
    const skillCandidates = this.value.skillCandidates.filter((item) => companyFilter(item.companyId) && projectFilter(item.projectId))
    const recentAudit = this.value.audit.filter((item) => companyFilter(item.companyId) && projectFilter(item.projectId)).slice(0, 30)
    return {
      generatedAt: Date.now(),
      ...(companyId ? { companyId } : {}),
      ...(project ? { projectId: project.id, release: releaseReadinessFrom(project.id, organization.tasks, control) } : {}),
      activeAnchors: clone(activeAnchors),
      activeKnowledge: clone(activeKnowledge),
      schedules: clone(schedules),
      heartbeats: clone(heartbeats),
      triggers: clone(triggers),
      skillCandidates: clone(skillCandidates),
      recentAudit: clone(recentAudit),
      metrics: {
        activeAnchors: activeAnchors.length,
        activeKnowledge: activeKnowledge.length,
        activeSchedules: schedules.filter((item) => item.status === 'active').length,
        activeHeartbeats: heartbeats.filter((item) => item.status === 'active').length,
        activeTriggers: triggers.filter((item) => item.status === 'active').length,
        proposedSkills: skillCandidates.filter((item) => item.status === 'proposed').length,
        auditReceipts: recentAudit.length,
      },
    }
  }

  async dueSchedules(now = Date.now()): Promise<OrganizationCompanySchedule[]> {
    await this.load()
    return clone(this.value.schedules.filter((item) => item.status === 'active' && item.nextRunAt <= now && (item.maxRuns === undefined || item.runCount < item.maxRuns)))
  }

  /** Advances cadence before dispatch so duplicate scheduler ticks fail closed. */
  async beginSchedule(id: string, now = Date.now()): Promise<OrganizationCompanySchedule | null> {
    await this.load()
    const item = this.value.schedules.find((row) => row.id === id)
    if (!item || item.status !== 'active' || item.nextRunAt > now || (item.maxRuns !== undefined && item.runCount >= item.maxRuns)) return null
    item.lastRunAt = now
    item.runCount += 1
    const mode = item.mode ?? 'interval'
    if (mode === 'once') {
      item.status = 'completed'
      item.nextRunAt = Number.MAX_SAFE_INTEGER
    } else {
      item.nextRunAt = nextScheduleRun(item, now)
      if (item.maxRuns !== undefined && item.runCount >= item.maxRuns) item.status = 'completed'
    }
    item.updatedAt = now
    await this.save()
    return clone(item)
  }

  /**
   * Hand a claimed run back when it could not do anything (a gate or budget held
   * it, or it failed before creating work): the run is not counted, and the
   * schedule retries soon instead of waiting a whole interval.
   */
  async releaseSchedule(id: string, outcome: CompanyScheduleOutcome, detail: string, retryInMs: number, now = Date.now()): Promise<void> {
    await this.load()
    const item = this.value.schedules.find((row) => row.id === id)
    if (!item) return
    item.runCount = Math.max(0, item.runCount - 1)
    if (item.status === 'completed') item.status = 'active'
    const intervalCap = (item.intervalMinutes ?? 15) * 60_000
    item.nextRunAt = now + Math.max(60_000, Math.min(retryInMs, intervalCap))
    item.lastOutcome = outcome
    item.lastDetail = clean(detail)
    item.updatedAt = now
    await this.save()
  }

  async dueHeartbeats(now = Date.now()): Promise<OrganizationHeartbeat[]> {
    await this.load()
    return clone(this.value.heartbeats.filter((item) => item.status === 'active' && item.nextRunAt <= now))
  }

  async beginHeartbeat(id: string, now = Date.now()): Promise<OrganizationHeartbeat | null> {
    await this.load()
    const item = this.value.heartbeats.find((row) => row.id === id)
    if (!item || item.status !== 'active' || item.nextRunAt > now) return null
    item.lastRunAt = now
    item.nextRunAt = now + item.intervalMinutes * 60_000
    item.updatedAt = now
    await this.save()
    return clone(item)
  }

  async finishHeartbeat(id: string, detail: string, now = Date.now()): Promise<void> {
    await this.load()
    const item = this.value.heartbeats.find((row) => row.id === id)
    if (!item) return
    item.lastDetail = clean(detail)
    item.updatedAt = now
    await this.save()
  }

  async pendingTriggerFirings(): Promise<Array<{ trigger: OrganizationAutomationTrigger; activity: OrganizationSnapshot['activity'][number] }>> {
    await this.load()
    const organization = await this.store.state()
    const seen = new Set(this.value.triggerReceipts.map((item) => `${item.triggerId}:${item.activityId}`))
    const output: Array<{ trigger: OrganizationAutomationTrigger; activity: OrganizationSnapshot['activity'][number] }> = []
    for (const trigger of this.value.triggers.filter((item) => item.status === 'active')) {
      if (trigger.maxRuns !== undefined && trigger.runCount >= trigger.maxRuns) continue
      for (const activity of organization.activity) {
        if (activity.companyId !== trigger.companyId || activity.projectId !== trigger.projectId || activity.type !== trigger.eventType) continue
        if (seen.has(`${trigger.id}:${activity.id}`)) continue
        output.push({ trigger: clone(trigger), activity: clone(activity) })
        if (output.length >= 50) return output
      }
    }
    return output
  }

  async recordTriggerFire(triggerId: string, activityId: string, outcome: CompanyScheduleOutcome, detail: string): Promise<void> {
    await this.load()
    if (this.value.triggerReceipts.some((item) => item.triggerId === triggerId && item.activityId === activityId)) return
    const trigger = must(this.value.triggers.find((item) => item.id === triggerId), 'Automation trigger')
    const receipt: OrganizationTriggerReceipt = {
      id: randomUUID(), triggerId, activityId, outcome, detail: clean(detail), createdAt: Date.now(),
    }
    this.value.triggerReceipts.unshift(receipt)
    this.value.triggerReceipts = this.value.triggerReceipts.slice(0, 2_000)
    if (outcome === 'success') trigger.runCount += 1
    if (trigger.maxRuns !== undefined && trigger.runCount >= trigger.maxRuns) trigger.status = 'completed'
    trigger.updatedAt = Date.now()
    await this.save()
  }

  async finishSchedule(id: string, outcome: CompanyScheduleOutcome, detail: string): Promise<void> {
    await this.load()
    const item = this.value.schedules.find((row) => row.id === id)
    if (!item) return
    item.lastOutcome = outcome
    item.lastDetail = clean(detail)
    item.updatedAt = Date.now()
    await this.save()
  }

  private addAnchor(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'anchor.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    const now = Date.now()
    const row: OrganizationStrategicAnchor = {
      id: randomUUID(), companyId: input.companyId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      title: clean(input.title), outcome: clean(input.outcome), successCriteria: cleanList(input.successCriteria ?? []),
      priority: input.priority ?? 'high', status: 'active',
      ...(input.sourceSignalId ? { sourceSignalId: clean(input.sourceSignalId) } : {}),
      createdAt: now, updatedAt: now,
    }
    this.value.anchors.unshift(row)
  }

  private updateAnchor(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'anchor.update' }>['patch']): void {
    const row = must(this.value.anchors.find((item) => item.id === id), 'Strategic anchor')
    if (patch.title !== undefined) row.title = clean(patch.title)
    if (patch.outcome !== undefined) row.outcome = clean(patch.outcome)
    if (patch.successCriteria !== undefined) row.successCriteria = cleanList(patch.successCriteria)
    if (patch.priority !== undefined) row.priority = patch.priority
    if (patch.status !== undefined) row.status = patch.status
    row.updatedAt = Date.now()
  }

  private addKnowledge(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'knowledge.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    const now = Date.now()
    if (input.supersedesId) {
      const previous = must(this.value.knowledge.find((item) => item.id === input.supersedesId), 'Superseded knowledge')
      if (previous.companyId !== input.companyId) throw new Error('Knowledge supersession must stay inside one company')
      previous.status = 'superseded'
      previous.updatedAt = now
    }
    const row: OrganizationCompanyKnowledge = {
      id: randomUUID(), companyId: input.companyId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      kind: input.kind, title: clean(input.title), content: clean(input.content), tags: cleanList(input.tags ?? []),
      confidence: input.confidence ?? 'high', status: 'active', source: input.source ?? 'human',
      ...(input.sourceRef ? { sourceRef: clean(input.sourceRef) } : {}),
      ...(input.supersedesId ? { supersedesId: input.supersedesId } : {}),
      createdAt: now, updatedAt: now,
    }
    this.value.knowledge.unshift(row)
  }

  private updateKnowledge(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'knowledge.update' }>['patch']): void {
    const row = must(this.value.knowledge.find((item) => item.id === id), 'Company knowledge')
    if (patch.title !== undefined) row.title = clean(patch.title)
    if (patch.content !== undefined) row.content = clean(patch.content)
    if (patch.tags !== undefined) row.tags = cleanList(patch.tags)
    if (patch.confidence !== undefined) row.confidence = patch.confidence
    if (patch.status !== undefined) row.status = patch.status
    row.updatedAt = Date.now()
  }

  private addSchedule(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'schedule.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    const mode = input.mode ?? 'interval'
    const now = Date.now()
    if (input.agentId && !organization.agents.some((item) => item.id === input.agentId && item.companyId === input.companyId)) throw new Error('Scheduled agent not found in company')
    const intervalMinutes = mode === 'interval' || mode === 'routine'
      ? positiveInteger(input.intervalMinutes ?? 60, 'intervalMinutes')
      : input.intervalMinutes === undefined ? undefined : positiveInteger(input.intervalMinutes, 'intervalMinutes')
    if (mode === 'routine' && !input.agentId) throw new Error('Agent routine requires agentId')
    if (mode === 'routine' && !input.prompt?.trim()) throw new Error('Agent routine requires a prompt')
    if (mode === 'cron') validateCron(clean(input.cron ?? ''), input.timezone)
    const runAt = mode === 'once' ? positiveInteger(input.runAt ?? input.nextRunAt ?? now + 60_000, 'runAt') : undefined
    const row: OrganizationCompanySchedule = {
      id: randomUUID(), companyId: input.companyId, projectId: input.projectId,
      title: clean(input.title), mode,
      ...(intervalMinutes === undefined ? {} : { intervalMinutes }),
      ...(mode === 'cron' ? { cron: clean(input.cron ?? ''), timezone: input.timezone?.trim() || 'UTC' } : {}),
      ...(runAt === undefined ? {} : { runAt }),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.prompt?.trim() ? { prompt: clean(input.prompt) } : {}),
      ...(input.skillIds?.length ? { skillIds: cleanList(input.skillIds) } : {}),
      status: 'active',
      nextRunAt: mode === 'once'
        ? runAt!
        : mode === 'cron'
          ? nextCronAt(clean(input.cron ?? ''), input.timezone, now)
          : input.nextRunAt === undefined ? now + (intervalMinutes ?? 60) * 60_000 : positiveInteger(input.nextRunAt, 'nextRunAt'),
      runCount: 0,
      ...(input.maxRuns === undefined ? {} : { maxRuns: positiveInteger(input.maxRuns, 'maxRuns') }),
      createdAt: now, updatedAt: now,
    }
    this.value.schedules.unshift(row)
  }

  private updateSchedule(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'schedule.update' }>['patch']): void {
    const row = must(this.value.schedules.find((item) => item.id === id), 'Company schedule')
    if (patch.title !== undefined) row.title = clean(patch.title)
    if (patch.intervalMinutes !== undefined) row.intervalMinutes = positiveInteger(patch.intervalMinutes, 'intervalMinutes')
    if (patch.cron !== undefined) { validateCron(clean(patch.cron), patch.timezone ?? row.timezone); row.cron = clean(patch.cron) }
    if (patch.timezone !== undefined) row.timezone = clean(patch.timezone)
    if (patch.runAt !== undefined) row.runAt = positiveInteger(patch.runAt, 'runAt')
    if (patch.status !== undefined) row.status = patch.status
    if (patch.nextRunAt !== undefined) row.nextRunAt = positiveInteger(patch.nextRunAt, 'nextRunAt')
    if (patch.maxRuns !== undefined) row.maxRuns = positiveInteger(patch.maxRuns, 'maxRuns')
    if (patch.agentId !== undefined) row.agentId = patch.agentId
    if (patch.prompt !== undefined) row.prompt = clean(patch.prompt)
    if (patch.skillIds !== undefined) row.skillIds = cleanList(patch.skillIds)
    row.updatedAt = Date.now()
  }

  private addHeartbeat(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'heartbeat.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    const intervalMinutes = positiveInteger(input.intervalMinutes, 'intervalMinutes')
    const now = Date.now()
    this.value.heartbeats.unshift({
      id: randomUUID(), companyId: input.companyId, projectId: input.projectId,
      title: clean(input.title), intervalMinutes, status: 'active',
      nextRunAt: now + intervalMinutes * 60_000, createdAt: now, updatedAt: now,
    })
  }

  private updateHeartbeat(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'heartbeat.update' }>['patch']): void {
    const row = must(this.value.heartbeats.find((item) => item.id === id), 'Heartbeat')
    if (patch.title !== undefined) row.title = clean(patch.title)
    if (patch.intervalMinutes !== undefined) row.intervalMinutes = positiveInteger(patch.intervalMinutes, 'intervalMinutes')
    if (patch.status !== undefined) row.status = patch.status
    if (patch.nextRunAt !== undefined) row.nextRunAt = positiveInteger(patch.nextRunAt, 'nextRunAt')
    row.updatedAt = Date.now()
  }

  private addTrigger(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'trigger.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    if (input.agentId && !organization.agents.some((item) => item.id === input.agentId && item.companyId === input.companyId)) throw new Error('Trigger agent not found in company')
    const now = Date.now()
    this.value.triggers.unshift({
      id: randomUUID(), companyId: input.companyId, projectId: input.projectId,
      title: clean(input.title), eventType: clean(input.eventType), action: input.action, prompt: clean(input.prompt),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      status: 'active', runCount: 0,
      ...(input.maxRuns === undefined ? {} : { maxRuns: positiveInteger(input.maxRuns, 'maxRuns') }),
      createdAt: now, updatedAt: now,
    })
  }

  private updateTrigger(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'trigger.update' }>['patch']): void {
    const row = must(this.value.triggers.find((item) => item.id === id), 'Automation trigger')
    if (patch.title !== undefined) row.title = clean(patch.title)
    if (patch.eventType !== undefined) row.eventType = clean(patch.eventType)
    if (patch.action !== undefined) row.action = patch.action
    if (patch.prompt !== undefined) row.prompt = clean(patch.prompt)
    if (patch.agentId !== undefined) row.agentId = patch.agentId
    if (patch.status !== undefined) row.status = patch.status
    if (patch.maxRuns !== undefined) row.maxRuns = positiveInteger(patch.maxRuns, 'maxRuns')
    row.updatedAt = Date.now()
  }

  private addSkillCandidate(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'skill-candidate.add' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    if (input.sourceAgentId && !organization.agents.some((item) => item.id === input.sourceAgentId && item.companyId === input.companyId)) throw new Error('Skill candidate agent not found in company')
    const now = Date.now()
    this.value.skillCandidates.unshift({
      id: randomUUID(), companyId: input.companyId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.sourceAgentId ? { sourceAgentId: input.sourceAgentId } : {}),
      name: clean(input.name), description: clean(input.description), instructions: clean(input.instructions),
      evidence: cleanList(input.evidence ?? []), status: 'proposed', createdAt: now, updatedAt: now,
    })
  }

  private updateSkillCandidate(id: string, patch: Extract<OrganizationStrategyMutation, { type: 'skill-candidate.update' }>['patch']): void {
    const row = must(this.value.skillCandidates.find((item) => item.id === id), 'Skill candidate')
    if (patch.name !== undefined) row.name = clean(patch.name)
    if (patch.description !== undefined) row.description = clean(patch.description)
    if (patch.instructions !== undefined) row.instructions = clean(patch.instructions)
    if (patch.evidence !== undefined) row.evidence = cleanList(patch.evidence)
    if (patch.status !== undefined) {
      if (patch.status === 'approved') throw new Error('Use skill-candidate.promote to approve and activate a learned skill')
      row.status = patch.status
    }
    row.updatedAt = Date.now()
  }

  private async promoteSkillCandidate(id: string): Promise<void> {
    const row = must(this.value.skillCandidates.find((item) => item.id === id), 'Skill candidate')
    if (row.status !== 'proposed') throw new Error('Only proposed skill candidates can be promoted')
    await this.store.mutate({
      type: 'skill.create',
      scope: row.projectId ? 'project' : 'company',
      companyId: row.companyId,
      ...(row.projectId ? { projectId: row.projectId } : {}),
      name: row.name,
      description: row.description,
      instructions: row.instructions,
    })
    row.status = 'approved'
    row.promotedAt = Date.now()
    row.updatedAt = row.promotedAt
  }

  private recordAction(organization: OrganizationSnapshot, input: Extract<OrganizationStrategyMutation, { type: 'action.record' }>): void {
    assertCompanyProject(organization, input.companyId, input.projectId)
    if (input.costUsd !== undefined && (!Number.isFinite(input.costUsd) || input.costUsd < 0)) throw new Error('costUsd must be a finite non-negative number')
    const row: OrganizationActionAuditReceipt = {
      id: randomUUID(), companyId: input.companyId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      action: clean(input.action), target: clean(input.target), scope: clean(input.scope), risk: input.risk,
      externality: input.externality, destructiveLevel: input.destructiveLevel,
      ...(input.costUsd === undefined ? {} : { costUsd: input.costUsd }),
      ...(input.credentialScope ? { credentialScope: cleanList(input.credentialScope) } : {}),
      ...(input.engine ? { engine: clean(input.engine) } : {}),
      ...(input.model ? { model: clean(input.model) } : {}),
      ...(input.agentId ? { agentId: clean(input.agentId) } : {}),
      ...(input.provider ? { provider: clean(input.provider) } : {}),
      ...(input.capability ? { capability: clean(input.capability) } : {}),
      ...(input.provenance ? { provenance: cleanList(input.provenance) } : {}),
      ...(input.requestedAt === undefined ? {} : { requestedAt: positiveInteger(input.requestedAt, 'requestedAt') }),
      decision: input.decision, reason: clean(input.reason),
      ...(input.result ? { result: clean(input.result) } : {}), createdAt: Date.now(),
    }
    this.value.audit.unshift(row)
    this.value.audit = this.value.audit.slice(0, 1_000)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as unknown
      this.value = normalize(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error
    }
    this.loaded = true
  }

  private async save(): Promise<void> {
    const snapshot = clone(this.value)
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    const write = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const temp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(temp, serialized, { mode: 0o600 })
      await fs.rename(temp, this.filePath)
    })
    this.saveChain = write
    await write
    this.onChanged?.(snapshot)
  }
}

function normalize(value: unknown): OrganizationStrategySnapshot {
  if (!value || typeof value !== 'object') return clone(EMPTY)
  const input = value as Partial<OrganizationStrategySnapshot>
  return {
    version: 1,
    anchors: Array.isArray(input.anchors) ? input.anchors : [],
    knowledge: Array.isArray(input.knowledge) ? input.knowledge : [],
    schedules: Array.isArray(input.schedules) ? input.schedules.map((item) => ({ mode: item.mode ?? 'interval', ...item })) : [],
    heartbeats: Array.isArray(input.heartbeats) ? input.heartbeats : [],
    triggers: Array.isArray(input.triggers) ? input.triggers : [],
    triggerReceipts: Array.isArray(input.triggerReceipts) ? input.triggerReceipts : [],
    skillCandidates: Array.isArray(input.skillCandidates) ? input.skillCandidates : [],
    audit: Array.isArray(input.audit) ? input.audit : [],
  }
}

function nextScheduleRun(schedule: OrganizationCompanySchedule, now: number): number {
  const mode = schedule.mode ?? 'interval'
  if (mode === 'cron') return nextCronAt(schedule.cron ?? '', schedule.timezone, now)
  return now + positiveInteger(schedule.intervalMinutes ?? 60, 'intervalMinutes') * 60_000
}

function assertCompanyProject(organization: OrganizationSnapshot, companyId: string, projectId?: string): void {
  if (!organization.companies.some((item) => item.id === companyId)) throw new Error('Company not found')
  if (projectId && !organization.projects.some((item) => item.id === projectId && item.companyId === companyId)) throw new Error('Project not found in company')
}

function clean(value: string): string {
  const result = value.trim()
  if (!result || result.length > 8_000) throw new Error('Value must be a non-empty bounded string')
  return result
}

function cleanList(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => clean(item)).filter(Boolean))).slice(0, 50)
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function must<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} not found`)
  return value
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
