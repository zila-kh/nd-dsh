export type OrganizationAutonomyLevel = 0 | 1 | 2 | 3 | 4
export type OrganizationPolicyEffect = 'allow' | 'ask' | 'deny'
export type OrganizationEntityStatus = 'active' | 'paused' | 'archived'
export type ProjectStatus = 'planning' | 'active' | 'blocked' | 'completed' | 'archived'
export type AgentStatus = 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline'
export type TaskStatus = 'backlog' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'completed'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type OrganizationRunKind = 'pm-plan' | 'task-execution' | 'task-review'
export type OrganizationRunStatus = 'running' | 'completed' | 'failed'
export type OrganizationScope = 'builtin' | 'company' | 'project' | 'team' | 'role' | 'agent'

export interface Company {
  id: string
  name: string
  mission: string
  autonomyLevel: OrganizationAutonomyLevel
  status: OrganizationEntityStatus
  createdAt: number
  updatedAt: number
}

export interface Project {
  id: string
  companyId: string
  name: string
  objective: string
  status: ProjectStatus
  workspacePath?: string
  repoUrls: string[]
  teamIds: string[]
  progress: number
  createdAt: number
  updatedAt: number
}

export interface OrganizationRole {
  id: string
  companyId: string
  name: string
  responsibility: string
  systemPrompt: string
  skillIds: string[]
}

export interface Team {
  id: string
  companyId: string
  name: string
  purpose: string
  roleIds: string[]
  skillIds: string[]
}

export interface OrganizationAgent {
  id: string
  companyId: string
  name: string
  roleId: string
  teamId?: string
  status: AgentStatus
  skillIds: string[]
  currentTaskId?: string
  lastSessionId?: string
}

export interface OrganizationSkill {
  id: string
  scope: OrganizationScope
  name: string
  description: string
  instructions: string
  companyId?: string
  projectId?: string
  teamId?: string
  roleId?: string
  agentId?: string
}

export interface WorkflowStep {
  id: string
  name: string
  kind: 'plan' | 'execute' | 'review'
  requiredRole?: string
}

export interface OrganizationWorkflow {
  id: string
  name: string
  scope: 'company' | 'project'
  companyId: string
  projectId?: string
  steps: WorkflowStep[]
}

export interface OrganizationGoal {
  id: string
  companyId: string
  projectId: string
  title: string
  description: string
  status: 'active' | 'completed' | 'blocked'
  progress: number
  createdAt: number
}

export interface Milestone {
  id: string
  companyId: string
  projectId: string
  goalId: string
  title: string
  description: string
  status: 'pending' | 'active' | 'completed' | 'blocked'
  order: number
}

export interface OrganizationTask {
  id: string
  companyId: string
  projectId: string
  goalId?: string
  milestoneId?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  priority: TaskPriority
  status: TaskStatus
  dependsOn: string[]
  assignedAgentId?: string
  executionSessionId?: string
  reviewSessionId?: string
  resultSummary?: string
  reviewSummary?: string
  createdAt: number
  updatedAt: number
}

export interface MemoryEntry {
  id: string
  companyId: string
  projectId?: string
  title: string
  content: string
  tags: string[]
  source: 'human' | 'pm' | 'worker' | 'reviewer'
  createdAt: number
  updatedAt: number
}

export interface OrganizationPolicy {
  id: string
  companyId: string
  action: string
  effect: OrganizationPolicyEffect
  description: string
}

export interface OrganizationActivity {
  id: string
  companyId: string
  projectId?: string
  type: string
  message: string
  createdAt: number
}

export interface OrganizationRun {
  id: string
  companyId: string
  projectId: string
  taskId?: string
  goalId?: string
  kind: OrganizationRunKind
  status: OrganizationRunStatus
  sessionId: string
  output?: string
  error?: string
  startedAt: number
  completedAt?: number
}

export interface OrganizationSnapshot {
  version: 1
  activeCompanyId?: string
  activeProjectId?: string
  companies: Company[]
  projects: Project[]
  roles: OrganizationRole[]
  teams: Team[]
  agents: OrganizationAgent[]
  skills: OrganizationSkill[]
  workflows: OrganizationWorkflow[]
  goals: OrganizationGoal[]
  milestones: Milestone[]
  tasks: OrganizationTask[]
  memory: MemoryEntry[]
  policies: OrganizationPolicy[]
  activity: OrganizationActivity[]
  runs: OrganizationRun[]
}

export interface ProjectPlanInput {
  goal: { title: string; description: string }
  milestones: Array<{
    title: string
    description: string
    tasks: Array<{
      title: string
      description: string
      priority?: TaskPriority
      acceptanceCriteria?: string[]
      dependsOn?: string[]
      role?: string
    }>
  }>
  memory?: Array<{ title: string; content: string; tags?: string[] }>
}

export type OrganizationMutation =
  | { type: 'company.create'; name: string; mission: string }
  | { type: 'company.update'; id: string; patch: Partial<Pick<Company, 'name' | 'mission' | 'autonomyLevel' | 'status'>> }
  | { type: 'company.activate'; id: string }
  | { type: 'project.create'; companyId: string; name: string; objective: string; workspacePath?: string; repoUrls?: string[] }
  | { type: 'project.update'; id: string; patch: Partial<Pick<Project, 'name' | 'objective' | 'status' | 'workspacePath' | 'repoUrls' | 'teamIds'>> }
  | { type: 'project.activate'; id: string }
  | { type: 'team.create'; companyId: string; name: string; purpose: string; roleIds?: string[]; skillIds?: string[] }
  | { type: 'role.create'; companyId: string; name: string; responsibility: string; systemPrompt: string; skillIds?: string[] }
  | { type: 'agent.create'; companyId: string; name: string; roleId: string; teamId?: string; skillIds?: string[] }
  | { type: 'skill.create'; scope: Exclude<OrganizationScope, 'builtin'>; name: string; description: string; instructions: string; companyId?: string; projectId?: string; teamId?: string; roleId?: string; agentId?: string }
  | { type: 'workflow.create'; companyId: string; projectId?: string; name: string; steps: WorkflowStep[] }
  | { type: 'goal.create'; companyId: string; projectId: string; title: string; description: string }
  | { type: 'task.create'; companyId: string; projectId: string; goalId?: string; milestoneId?: string; title: string; description: string; acceptanceCriteria?: string[]; priority?: TaskPriority; dependsOn?: string[]; assignedAgentId?: string }
  | { type: 'task.update'; id: string; patch: Partial<Pick<OrganizationTask, 'title' | 'description' | 'acceptanceCriteria' | 'priority' | 'status' | 'dependsOn' | 'assignedAgentId'>> }
  | { type: 'memory.add'; companyId: string; projectId?: string; title: string; content: string; tags?: string[] }
  | { type: 'policy.set'; companyId: string; action: string; effect: OrganizationPolicyEffect; description?: string }

export interface OrganizationRunReceipt {
  runId: string
  sessionId: string
  projectId: string
  taskId?: string
  kind: OrganizationRunKind
}

export interface OrganizationDesktopApi {
  state(): Promise<OrganizationSnapshot>
  mutate(mutation: OrganizationMutation): Promise<OrganizationSnapshot>
  planProject(projectId: string): Promise<OrganizationRunReceipt>
  runTask(taskId: string): Promise<OrganizationRunReceipt>
  reviewTask(taskId: string): Promise<OrganizationRunReceipt>
  runNext(projectId?: string): Promise<OrganizationRunReceipt | null>
  onChanged(listener: (state: OrganizationSnapshot) => void): () => void
}

export const ORGANIZATION_IPC = {
  state: 'organization:state',
  mutate: 'organization:mutate',
  planProject: 'organization:plan-project',
  runTask: 'organization:run-task',
  reviewTask: 'organization:review-task',
  runNext: 'organization:run-next',
  changed: 'organization:changed',
} as const
