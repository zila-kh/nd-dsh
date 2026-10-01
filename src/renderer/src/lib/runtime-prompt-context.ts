import type { OrganizationSnapshot } from '../../../shared/organization.js'

/** Resolve the request's own session, never the company/project currently selected. */
export function runtimePromptContext(sessionId: string, organization: OrganizationSnapshot | null) {
  const run = organization?.runs.filter((item) => item.sessionId === sessionId).sort((a, b) => b.startedAt - a.startedAt)[0]
  if (!organization || !run) return { sessionId }
  const project = organization.projects.find((item) => item.id === run.projectId && item.companyId === run.companyId)
  const task = organization.tasks.find((item) => item.id === run.taskId && item.projectId === run.projectId)
  const agentId = run.kind === 'task-review' ? task?.reviewerAgentId : task?.assignedAgentId
  const agent = organization.agents.find((item) => item.id === agentId && item.companyId === run.companyId)
  return {
    sessionId,
    company: organization.companies.find((item) => item.id === run.companyId)?.name,
    project: project?.name,
    task: task?.title,
    worker: agent?.name,
    workspace: run.workspaceRoot ?? project?.workspacePath,
  }
}
