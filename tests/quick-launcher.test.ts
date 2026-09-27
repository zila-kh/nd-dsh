import { describe, expect, it } from 'vitest'
import type { Project } from '../src/shared/organization.js'
import {
  buildLauncherMemoryMutation,
  buildLauncherTaskMutation,
  compactLauncherText,
  isQuickLauncherKey,
  launcherTitle,
  recentLauncherProjects,
} from '../src/renderer/src/lib/quick-launcher-model.js'

function project(id: string, updatedAt: number): Project {
  return {
    id,
    companyId: 'company-a',
    name: `Project ${id}`,
    objective: `Ship ${id}`,
    status: 'active',
    repoUrls: [],
    teamIds: [],
    progress: 0,
    createdAt: updatedAt - 10,
    updatedAt,
  }
}

describe('ND Quick Launcher model', () => {
  it('recognizes the in-app launcher shortcut without stealing Alt shortcuts', () => {
    expect(isQuickLauncherKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: false })).toBe(true)
    expect(isQuickLauncherKey({ key: 'K', ctrlKey: false, metaKey: true, altKey: false })).toBe(true)
    expect(isQuickLauncherKey({ key: 'k', ctrlKey: true, metaKey: false, altKey: true })).toBe(false)
    expect(isQuickLauncherKey({ key: 'j', ctrlKey: true, metaKey: false, altKey: false })).toBe(false)
    expect(isQuickLauncherKey({ key: 'k', ctrlKey: false, metaKey: false, altKey: false })).toBe(false)
  })

  it('normalizes compact labels and bounded task/note titles', () => {
    expect(compactLauncherText('  hello   launcher\nworld  ')).toBe('hello launcher world')
    expect(compactLauncherText('123456789', 6)).toBe('12345…')
    expect(launcherTitle('  First   line  \nsecond line', 120, 'fallback')).toBe('First line')
    expect(launcherTitle('   \nsecond line', 120, 'fallback')).toBe('fallback')
    expect(launcherTitle('x'.repeat(140), 120, 'fallback')).toHaveLength(120)
  })

  it('sorts recent projects newest-first without mutating organization state', () => {
    const input = [project('old', 10), project('new', 30), project('middle', 20)]
    const originalOrder = input.map((item) => item.id)

    expect(recentLauncherProjects(input, 2).map((item) => item.id)).toEqual(['new', 'middle'])
    expect(input.map((item) => item.id)).toEqual(originalOrder)
    expect(recentLauncherProjects(input, 0)).toEqual([])
  })

  it('builds a project-scoped task mutation with a stable acceptance contract', () => {
    const mutation = buildLauncherTaskMutation(
      'company-a',
      'project-a',
      ' Fix   checkout race \nKeep the retry bounded.',
    )

    expect(mutation).toEqual({
      type: 'task.create',
      companyId: 'company-a',
      projectId: 'project-a',
      title: 'Fix checkout race',
      description: ' Fix   checkout race \nKeep the retry bounded.',
      acceptanceCriteria: ['Requested outcome is implemented and verified.'],
    })
  })

  it('builds project or company memory without sharing mutable tag input', () => {
    const tags = ['capture', 'clipboard']
    const scoped = buildLauncherMemoryMutation('company-a', 'project-a', '  copied value  ', tags)
    tags.push('later')

    expect(scoped).toEqual({
      type: 'memory.add',
      companyId: 'company-a',
      projectId: 'project-a',
      title: 'copied value',
      content: '  copied value  ',
      tags: ['capture', 'clipboard'],
    })

    expect(buildLauncherMemoryMutation('company-a', undefined, '', ['launcher'])).toEqual({
      type: 'memory.add',
      companyId: 'company-a',
      title: 'Quick note',
      content: '',
      tags: ['launcher'],
    })
  })
})
