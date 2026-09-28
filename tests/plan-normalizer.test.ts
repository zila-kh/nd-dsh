import { describe, expect, it } from 'vitest'
import { normalizeProjectPlan } from '../src/main/organization/plan-normalizer.js'

function task(title: string, extra: Record<string, unknown> = {}) {
  return { title, description: `${title} work`, ...extra }
}

describe('normalizeProjectPlan', () => {
  it('keeps a well-formed plan unchanged', () => {
    const { plan, adjustments } = normalizeProjectPlan({
      goal: { title: 'Launch', description: 'Ship v1' },
      milestones: [{ title: 'Build', description: '', tasks: [task('API'), task('UI', { dependsOn: ['API'], priority: 'high' })] }],
    })
    expect(adjustments).toEqual([])
    expect(plan.milestones[0]!.tasks[1]).toMatchObject({ title: 'UI', dependsOn: ['API'], priority: 'high' })
  })

  it('resolves dependencies by near title, number, and unique partial title', () => {
    const { plan, adjustments } = normalizeProjectPlan({
      goal: { title: 'Launch' },
      milestones: [{
        title: 'Build',
        tasks: [
          task('Design database schema'),
          task('Build REST API'),
          task('Write docs', { dependsOn: ['design database schema.', '2'] }),
          task('Ship', { dependsOn: ['REST API', 'Task 3'] }),
        ],
      }],
    })
    const tasks = plan.milestones[0]!.tasks
    expect(tasks[2]!.dependsOn).toEqual(['Design database schema', 'Build REST API'])
    expect(tasks[3]!.dependsOn).toEqual(['Build REST API', 'Write docs'])
    expect(plan.goal.description).toBe('Launch')
    expect(adjustments).toEqual([])
  })

  it('drops unknown and self dependencies and breaks cycles instead of rejecting the plan', () => {
    const { plan, adjustments } = normalizeProjectPlan({
      goal: { title: 'Launch', description: 'x' },
      milestones: [{
        title: 'Build',
        tasks: [
          task('A', { dependsOn: ['B', 'A', 'Something else entirely'] }),
          task('B', { dependsOn: ['A'] }),
        ],
      }],
    })
    const [a, b] = plan.milestones[0]!.tasks
    expect(a!.dependsOn).toEqual(['B'])
    expect(b!.dependsOn).toBeUndefined()
    expect(adjustments.join(' ')).toMatch(/unknown dependency/)
    expect(adjustments.join(' ')).toMatch(/self-dependency/)
    expect(adjustments.join(' ')).toMatch(/break a cycle/)
  })

  it('renames duplicate titles and drops empty tasks and milestones', () => {
    const { plan, adjustments } = normalizeProjectPlan({
      goal: { title: 'Launch', description: 'x' },
      milestones: [
        { title: 'One', tasks: [task('Setup'), task('Setup'), { title: '  ' }] },
        { title: 'Empty', tasks: [] },
      ],
    })
    expect(plan.milestones).toHaveLength(1)
    expect(plan.milestones[0]!.tasks.map((item) => item.title)).toEqual(['Setup', 'Setup (2)'])
    expect(adjustments).toHaveLength(3)
  })

  it('downgrades artifact evidence without paths and ignores invalid priorities', () => {
    const { plan } = normalizeProjectPlan({
      goal: { title: 'Launch', description: 'x' },
      milestones: [{ title: 'Docs', tasks: [task('Research', { evidenceKind: 'artifact', priority: 'urgent' })] }],
    })
    const research = plan.milestones[0]!.tasks[0]!
    expect(research.evidenceKind).toBeUndefined()
    expect(research.priority).toBeUndefined()
  })

  it('rejects only a plan with no goal title or no tasks', () => {
    expect(() => normalizeProjectPlan({ milestones: [] })).toThrow(/goal needs a title/)
    expect(() => normalizeProjectPlan({ goal: { title: 'X' }, milestones: [{ title: 'M', tasks: [] }] })).toThrow(/no tasks/)
  })
})
