import type { OrganizationControlSnapshot } from './organization-control.js'

export type StrategicAnchorStatus = 'proposed' | 'active' | 'achieved' | 'archived'
export type StrategicAnchorPriority = 'low' | 'medium' | 'high' | 'critical'
export type CompanyKnowledgeKind = 'product' | 'architecture' | 'decision' | 'lesson' | 'design' | 'incident' | 'feedback'
export type CompanyKnowledgeConfidence = 'authoritative' | 'high' | 'medium' | 'low'
export type CompanyKnowledgeStatus = 'active' | 'superseded' | 'stale' | 'archived'
export type CompanyScheduleStatus = 'active' | 'paused' | 'completed'
export type CompanyScheduleOutcome = 'success' | 'skipped' | 'failed'
export type NormalizedActionRisk = 'low' | 'medium' | 'high' | 'critical'
export type NormalizedActionExternality = 'internal' | 'external'
export type NormalizedActionDestructiveLevel = 'none' | 'reversible' | 'destructive'
export type NormalizedActionDecision = 'allow' | 'ask' | 'deny'

export interface OrganizationStrategicAnchor {
  id: string
  companyId: string
  projectId?: string
  title: string
  outcome: string
  successCriteria: string[]
  priority: StrategicAnchorPriority
  status: StrategicAnchorStatus
  sourceSignalId?: string
  createdAt: number
  updatedAt: number
}

export interface OrganizationCompanyKnowledge {
  id: string
  companyId: string
  projectId?: string
  kind: CompanyKnowledgeKind
  title: string
  content: string
  tags: string[]
  confidence: CompanyKnowledgeConfidence
  status: CompanyKnowledgeStatus
  source: 'human' | 'agent' | 'evidence' | 'system'
  sourceRef?: string
  supersedesId?: string
  createdAt: number
  updatedAt: number
}

export interface OrganizationCompanySchedule {
  id: string
  companyId: string
  projectId: string
  title: string
  intervalMinutes: number
  status: CompanyScheduleStatus
  nextRunAt: number
  lastRunAt?: number
  lastOutcome?: CompanyScheduleOutcome
  lastDetail?: string
  runCount: number
  maxRuns?: number
  createdAt: number
  updatedAt: number
}

export interface OrganizationActionAuditReceipt {
  id: string
  companyId: string
  projectId?: string
  taskId?: string
  action: string
  target: string
  scope: string
  risk: NormalizedActionRisk
  externality: NormalizedActionExternality
  destructiveLevel: NormalizedActionDestructiveLevel
  costUsd?: number
  engine?: string
  model?: string
  agentId?: string
  decision: NormalizedActionDecision
  reason: string
  result?: string
  createdAt: number
}

export interface OrganizationStrategySnapshot {
  version: 1
  anchors: OrganizationStrategicAnchor[]
  knowledge: OrganizationCompanyKnowledge[]
  schedules: OrganizationCompanySchedule[]
  audit: OrganizationActionAuditReceipt[]
}

export interface OrganizationReleaseReadiness {
  projectId: string
  state: 'not_ready' | 'blocked' | 'ready'
  totalTasks: number
  completedTasks: number
  verifiedTasks: number
  missingEvidenceTasks: number
  staleEvidenceTasks: number
  runningTasks: number
  blockedTasks: number
  blockers: string[]
}

export interface OrganizationStrategyProjection {
  generatedAt: number
  companyId?: string
  projectId?: string
  activeAnchors: OrganizationStrategicAnchor[]
  activeKnowledge: OrganizationCompanyKnowledge[]
  schedules: OrganizationCompanySchedule[]
  recentAudit: OrganizationActionAuditReceipt[]
  release?: OrganizationReleaseReadiness
  metrics: {
    activeAnchors: number
    activeKnowledge: number
    activeSchedules: number
    auditReceipts: number
  }
}

export type OrganizationStrategyMutation =
  | { type: 'anchor.add'; companyId: string; projectId?: string; title: string; outcome: string; successCriteria?: string[]; priority?: StrategicAnchorPriority; sourceSignalId?: string }
  | { type: 'anchor.update'; id: string; patch: Partial<Pick<OrganizationStrategicAnchor, 'title' | 'outcome' | 'successCriteria' | 'priority' | 'status'>> }
  | { type: 'knowledge.add'; companyId: string; projectId?: string; kind: CompanyKnowledgeKind; title: string; content: string; tags?: string[]; confidence?: CompanyKnowledgeConfidence; source?: OrganizationCompanyKnowledge['source']; sourceRef?: string; supersedesId?: string }
  | { type: 'knowledge.update'; id: string; patch: Partial<Pick<OrganizationCompanyKnowledge, 'title' | 'content' | 'tags' | 'confidence' | 'status'>> }
  | { type: 'schedule.add'; companyId: string; projectId: string; title: string; intervalMinutes: number; nextRunAt?: number; maxRuns?: number }
  | { type: 'schedule.update'; id: string; patch: Partial<Pick<OrganizationCompanySchedule, 'title' | 'intervalMinutes' | 'status' | 'nextRunAt' | 'maxRuns'>> }
  | { type: 'action.record'; companyId: string; projectId?: string; taskId?: string; action: string; target: string; scope: string; risk: NormalizedActionRisk; externality: NormalizedActionExternality; destructiveLevel: NormalizedActionDestructiveLevel; costUsd?: number; engine?: string; model?: string; agentId?: string; decision: NormalizedActionDecision; reason: string; result?: string }

export interface OrganizationStrategyDesktopApi {
  state(): Promise<OrganizationStrategySnapshot>
  mutate(mutation: OrganizationStrategyMutation): Promise<OrganizationStrategySnapshot>
  projection(projectId?: string): Promise<OrganizationStrategyProjection>
  onChanged(listener: (state: OrganizationStrategySnapshot) => void): () => void
}

export const ORGANIZATION_STRATEGY_IPC = {
  state: 'organization-strategy:state',
  mutate: 'organization-strategy:mutate',
  projection: 'organization-strategy:projection',
  changed: 'organization-strategy:changed',
} as const

export function releaseReadinessFrom(
  projectId: string,
  tasks: Array<{ id: string; projectId: string; status: string }>,
  control: Pick<OrganizationControlSnapshot, 'evidence'>,
): OrganizationReleaseReadiness {
  const projectTasks = tasks.filter((task) => task.projectId === projectId)
  const latestEvidence = new Map<string, OrganizationControlSnapshot['evidence'][number]>()
  for (const receipt of control.evidence) {
    if (!latestEvidence.has(receipt.taskId)) latestEvidence.set(receipt.taskId, receipt)
  }
  const completed = projectTasks.filter((task) => task.status === 'completed')
  const verifiedTasks = completed.filter((task) => latestEvidence.get(task.id)?.status === 'verified').length
  const missingEvidenceTasks = completed.filter((task) => !latestEvidence.has(task.id)).length
  const staleEvidenceTasks = completed.filter((task) => {
    const status = latestEvidence.get(task.id)?.status
    return status === 'stale' || status === 'failed' || status === 'pending_review'
  }).length
  const blockedTasks = projectTasks.filter((task) => task.status === 'blocked').length
  const runningTasks = projectTasks.filter((task) => task.status === 'in_progress' || task.status === 'review').length
  const blockers: string[] = []
  if (!projectTasks.length) blockers.push('Project has no implementation tasks yet.')
  if (completed.length !== projectTasks.length) blockers.push(`${projectTasks.length - completed.length} task(s) are not completed.`)
  if (missingEvidenceTasks) blockers.push(`${missingEvidenceTasks} completed task(s) have no exact independent-review receipt.`)
  if (staleEvidenceTasks) blockers.push(`${staleEvidenceTasks} completed task(s) have stale, failed, or pending evidence.`)
  return {
    projectId,
    state: blockers.length ? (blockedTasks || staleEvidenceTasks ? 'blocked' : 'not_ready') : 'ready',
    totalTasks: projectTasks.length,
    completedTasks: completed.length,
    verifiedTasks,
    missingEvidenceTasks,
    staleEvidenceTasks,
    runningTasks,
    blockedTasks,
    blockers,
  }
}
