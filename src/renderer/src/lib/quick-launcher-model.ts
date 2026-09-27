import type { OrganizationMutation, Project } from '../../../shared/organization'

export interface QuickLauncherKeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function isQuickLauncherKey(input: QuickLauncherKeyLike): boolean {
  return (input.ctrlKey || input.metaKey) && !input.altKey && input.key.toLowerCase() === 'k'
}

export function compactLauncherText(value: string, max = 54): string {
  const cleaned = value.trim().replace(/\s+/g, ' ')
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, Math.max(0, max - 1))}…`
}

export function launcherTitle(value: string, max: number, fallback: string): string {
  const firstLine = value.split(/\r?\n/)[0]?.trim().replace(/\s+/g, ' ') ?? ''
  return firstLine.slice(0, max) || fallback
}

export function recentLauncherProjects(projects: Project[], limit = 6): Project[] {
  return [...projects]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(0, limit))
}

export function buildLauncherTaskMutation(
  companyId: string,
  projectId: string,
  text: string,
): Extract<OrganizationMutation, { type: 'task.create' }> {
  return {
    type: 'task.create',
    companyId,
    projectId,
    title: launcherTitle(text, 120, 'Launcher task'),
    description: text,
    acceptanceCriteria: ['Requested outcome is implemented and verified.'],
  }
}

export function buildLauncherMemoryMutation(
  companyId: string,
  projectId: string | undefined,
  text: string,
  tags: string[] = ['launcher', 'manual'],
): Extract<OrganizationMutation, { type: 'memory.add' }> {
  return {
    type: 'memory.add',
    companyId,
    ...(projectId ? { projectId } : {}),
    title: launcherTitle(text, 80, 'Quick note'),
    content: text,
    tags: [...tags],
  }
}
