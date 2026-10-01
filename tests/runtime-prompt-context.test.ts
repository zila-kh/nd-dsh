import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'
import { runtimePromptContext } from '../src/renderer/src/lib/runtime-prompt-context.js'
import { runtimePromptAction } from '../src/renderer/src/lib/runtime-prompt-action.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('runtime request ownership', () => {
  it('uses the bound worker and worktree even when another project is selected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-runtime-prompt-'))
    roots.push(root)
    const store = new OrganizationStore(join(root, 'organization.json'))
    let state = await store.mutate({ type: 'company.create', name: 'Request owner', mission: 'Test request ownership' })
    const company = state.companies[0]!
    const builder = state.agents.find((agent) => agent.companyId === company.id)!
    state = await store.mutate({ type: 'project.create', companyId: company.id, name: 'Worker project', objective: 'Test', workspacePath: root })
    const project = state.projects[0]!
    state = await store.mutate({ type: 'task.create', companyId: company.id, projectId: project.id, title: 'Worker task', description: 'Test', assignedAgentId: builder.id })
    const task = state.tasks[0]!
    const run = await store.beginRun('task-execution', company.id, project.id, 'request-session', task.id)
    state = await store.state()
    state.runs.find((item) => item.id === run.id)!.workspaceRoot = join(root, 'task-worktree')
    state.activeCompanyId = 'different-company'
    state.activeProjectId = 'different-project'
    expect(runtimePromptContext('request-session', state)).toMatchObject({
      company: 'Request owner', project: 'Worker project', task: 'Worker task',
      worker: builder.name, workspace: join(root, 'task-worktree'),
    })
    expect(runtimePromptContext('unknown-session', state)).toEqual({ sessionId: 'unknown-session' })
  })

  it('does not attribute an unloaded organization to the active workspace', () => {
    expect(runtimePromptContext('interactive-session', null)).toEqual({ sessionId: 'interactive-session' })
  })

  it('redacts credentials while retaining the requested command and workspace', () => {
    const preview = runtimePromptAction({ command: 'node --test --api-key sk-test-placeholder', workspace: 'test-worktree', nested: { authorization: 'dummy-private-value', password: 'dummy-password' }, url: 'https://dummy-user:dummy-password@example.test/?token=dummy-token' })!
    expect(preview).toContain('node --test')
    expect(preview).toContain('test-worktree')
    for (const hidden of ['sk-test-placeholder', 'dummy-private-value', 'dummy-password', 'dummy-token', 'dummy-user']) expect(preview).not.toContain(hidden)
    expect(preview).toContain('[redacted]')
  })

  it('bounds previews and ignores unrepresentable arguments', () => {
    expect(runtimePromptAction({ command: 'x'.repeat(8_000) })!.length).toBeLessThan(4_100)
    expect(runtimePromptAction(undefined)).toBeUndefined()
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(runtimePromptAction(cyclic)).toBeUndefined()
  })
})
