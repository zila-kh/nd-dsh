import type { OrganizationTask, Project } from './organization.js'

const PRIORITY = { low: 0, medium: 1, high: 2, critical: 3 } as const

/** UI and dispatch use the same scope and queue order. Reviews may finish outside it. */
export function taskInDeliveryScope(task: OrganizationTask, project: Project): boolean {
  return task.projectId === project.id && (!project.deliveryMilestoneId || task.milestoneId === project.deliveryMilestoneId)
}

export function compareDeliveryTasks(a: OrganizationTask, b: OrganizationTask): number {
  return (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER)
    || PRIORITY[b.priority] - PRIORITY[a.priority]
    || a.createdAt - b.createdAt
    || a.id.localeCompare(b.id)
}
