import { describe, expect, it } from 'vitest'
import type { OrganizationMutation, OrganizationSnapshot, OrganizationTask } from '../src/shared/organization.js'
import type { OrganizationCompanySchedule } from '../src/shared/organization-strategy.js'
import { runDueSchedules, type ScheduleRunnerDeps } from '../src/main/organization/schedule-runner.js'

function schedule(): OrganizationCompanySchedule {
  return { id: 'sched-1', companyId: 'c1', projectId: 'p1', title: 'Weekly sprint review', intervalMinutes: 60 * 24 * 7, status: 'active', nextRunAt: 0, runCount: 0, createdAt: 0, updatedAt: 0 }
}

function harness(options: { autonomy: number; gate?: 'ready' | 'held'; openTask?: Partial<OrganizationTask> }) {
  const tasks: OrganizationTask[] = options.openTask ? [{ id: 't0', companyId: 'c1', projectId: 'p1', title: 'Old', description: '', acceptanceCriteria: [], priority: 'medium', status: 'ready', dependsOn: [], createdAt: 0, updatedAt: 0, ...options.openTask } as OrganizationTask] : []
  const events: string[] = []
  const created: Array<Extract<OrganizationMutation, { type: 'task.create' }>> = []
  const deps: ScheduleRunnerDeps = {
    strategy: {
      dueSchedules: async () => [schedule()],
      beginSchedule: async () => schedule(),
      finishSchedule: async (_id, outcome, detail) => { events.push(`finish:${outcome}:${detail}`) },
      releaseSchedule: async (_id, outcome, detail) => { events.push(`release:${outcome}:${detail}`) },
      mutate: async () => undefined,
    },
    control: {
      shouldRun: async () => ({ route: options.gate === 'held' ? 'gate' : 'ready', action: 'workflow.continue', companyId: 'c1', projectId: 'p1', reason: options.gate === 'held' ? 'Gate is open' : 'ok' }) as never,
    },
    store: {
      state: async () => ({ companies: [{ id: 'c1', autonomyLevel: options.autonomy }], projects: [{ id: 'p1', companyId: 'c1' }], tasks }) as unknown as OrganizationSnapshot,
      mutate: async (mutation) => {
        if (mutation.type === 'task.create') {
          created.push(mutation)
          tasks.push({
            id: 'generated-task', companyId: mutation.companyId, projectId: mutation.projectId,
            title: mutation.title, description: mutation.description, acceptanceCriteria: [], priority: mutation.priority ?? 'medium',
            status: 'ready', dependsOn: mutation.dependsOn ?? [],
            ...(mutation.sourceScheduleId ? { sourceScheduleId: mutation.sourceScheduleId } : {}),
            ...(mutation.assignedAgentId ? { assignedAgentId: mutation.assignedAgentId } : {}),
            ...(mutation.requestedSkillIds ? { requestedSkillIds: mutation.requestedSkillIds } : {}),
            createdAt: 1, updatedAt: 1,
          })
        }
        return { companies: [{ id: 'c1', autonomyLevel: options.autonomy }], projects: [{ id: 'p1', companyId: 'c1' }], tasks } as unknown as OrganizationSnapshot
      },
    },
    orchestrator: { runTask: async (taskId) => { events.push(`runTask:${taskId}`); return { runId: 'r1', kind: 'task-execution' } as never } },
    now: () => Date.UTC(2026, 8, 29),
  }
  return { deps, events, created }
}

describe('runDueSchedules', () => {
  it('creates a task named after the schedule and leaves it for a human below autonomy 3', async () => {
    const { deps, events, created } = harness({ autonomy: 2 })
    await runDueSchedules(deps)
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ title: 'Weekly sprint review · 2026-09-29', sourceScheduleId: 'sched-1', projectId: 'p1' })
    expect(created[0]!.description).toContain('every 1 week(s)')
    expect(events.some((item) => item.startsWith('runTask:'))).toBe(false)
    expect(events.at(-1)).toMatch(/^finish:success:.*waiting on the board/)
  })

  it('starts the work when the company allows autonomous execution', async () => {
    const { deps, events, created } = harness({ autonomy: 3 })
    await runDueSchedules(deps)
    expect(created).toHaveLength(1)
    expect(events).toContain('runTask:generated-task')
    expect(events.at(-1)).toMatch(/Dispatched task-execution run r1/)
  })

  it('does not pile up tasks while the previous scheduled task is still open', async () => {
    const { deps, created, events } = harness({ autonomy: 2, openTask: { sourceScheduleId: 'sched-1', title: 'Weekly sprint review · 2026-09-22' } })
    await runDueSchedules(deps)
    expect(created).toHaveLength(0)
    expect(events.at(-1)).toMatch(/still open/)
  })

  it('does not auto-restart blocked or in-flight scheduled work', async () => {
    for (const status of ['blocked', 'in_progress', 'review'] as const) {
      const { deps, events, created } = harness({
        autonomy: 3,
        openTask: { sourceScheduleId: 'sched-1', title: 'Existing scheduled work', status },
      })
      await runDueSchedules(deps)
      expect(created).toHaveLength(0)
      expect(events.some((item) => item.startsWith('runTask:'))).toBe(false)
      expect(events.at(-1)).toContain(`is ${status}; ND will not auto-restart`)
    }
  })

  it('hands the run back for a soon retry when a gate holds it', async () => {
    const { deps, created, events } = harness({ autonomy: 3, gate: 'held' })
    await runDueSchedules(deps)
    expect(created).toHaveLength(0)
    expect(events).toEqual(['release:skipped:Gate is open'])
  })
})
