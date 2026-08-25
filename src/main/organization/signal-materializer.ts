import type { OrganizationSignal, SignalDisposition } from '../../shared/organization-control.js'
import type { OrganizationStore } from './store.js'

/**
 * Convert a triaged external signal into the existing organization model.
 * The marker makes retries idempotent without introducing another task store.
 */
export async function materializeOrganizationSignal(
  store: OrganizationStore,
  signal: OrganizationSignal,
  disposition: SignalDisposition,
): Promise<void> {
  if (disposition !== 'task' && disposition !== 'objective') return

  const state = await store.state()
  const project = signal.projectId
    ? state.projects.find((item) => item.id === signal.projectId && item.companyId === signal.companyId)
    : state.projects.find((item) => item.id === state.activeProjectId && item.companyId === signal.companyId)
      ?? state.projects.find((item) => item.companyId === signal.companyId && item.status !== 'archived')
  if (!project) throw new Error('Signal needs a company project before it can become work')

  const marker = `[nd-signal:${signal.id}]`
  if (disposition === 'objective') {
    if (state.goals.some((item) => item.projectId === project.id && item.description.includes(marker))) return
    await store.mutate({
      type: 'goal.create',
      companyId: signal.companyId,
      projectId: project.id,
      title: signal.title,
      description: `${signal.summary}\n\nSource: ${signal.source}\n${marker}`,
    })
    return
  }

  if (state.tasks.some((item) => item.projectId === project.id && item.description.includes(marker))) return
  await store.mutate({
    type: 'task.create',
    companyId: signal.companyId,
    projectId: project.id,
    title: signal.title,
    description: `${signal.summary}\n\nSource: ${signal.source}\n${marker}`,
    priority: 'medium',
    acceptanceCriteria: [
      'The reported signal is reproduced or otherwise validated against current product behavior.',
      'The resulting implementation or resolution is independently verified before completion.',
    ],
  })
}
