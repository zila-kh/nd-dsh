import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OrganizationStore } from '../src/main/organization/store.js'
import { WorkflowPluginStore } from '../src/main/workflows/workflow-plugin-store.js'
import { WorkflowService } from '../src/main/workflows/workflow-service.js'
import { projectRepositoryBoard } from '../src/shared/workflow-plugins.js'

/**
 * Live round trip against a REAL initialized workflow project and the REAL
 * upstream CLI. Opt-in only:
 *   ND_DSH_LIVE_WORKFLOW=<project-root> pnpm vitest run tests/workflow-live.test.ts
 * Optionally points the plugin bundle elsewhere via ND_DSH_LIVE_WORKFLOW_PLUGIN.
 * Never runs in CI or pnpm test; the project must have the workflow package
 * installed (ND never installs it).
 */
const projectRoot = process.env.ND_DSH_LIVE_WORKFLOW?.trim()
const pluginBundle = process.env.ND_DSH_LIVE_WORKFLOW_PLUGIN?.trim()
  ?? 'C:/Users/dila/Documents/GitHub/next-mmo/agent-dev-workflow/packages/agent-workflow-scrum/plugin'

const tempDirs: string[] = []

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })))
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  tempDirs.push(dir)
  return dir
}

describe.skipIf(!projectRoot)('live workflow mirror (real CLI)', () => {
  it('installs, detects, enables, and mirrors the real project board', { timeout: 60_000 }, async () => {
    const dir = await tempDir('nd-workflow-live')
    const org = new OrganizationStore(join(dir, 'organization.json'))
    await org.mutate({ type: 'company.create', name: 'Live Company', mission: 'validate the mirror' })
    const company = (await org.state()).companies[0]!.id
    await org.mutate({ type: 'project.create', companyId: company, name: 'Live Project', objective: 'mirror', workspacePath: projectRoot! })
    const project = (await org.state()).projects[0]!.id

    const store = new WorkflowPluginStore(join(dir, 'workflow-plugins.json'))
    const service = new WorkflowService({ store, organization: org })

    const state = await service.install({ kind: 'local', path: pluginBundle })
    expect(state.plugins).toHaveLength(1)
    expect(state.plugins[0]?.id).toBe('agent-workflow-scrum')

    const previews = await service.detect(company, project)
    expect(previews[0]?.supported).toBe(true)

    await service.enable(company, project, 'agent-workflow-scrum')
    const refreshed = await service.refresh(company, project)
    expect(refreshed.snapshots).toHaveLength(1)

    const view = await service.projectView(company, project)
    expect(view.binding?.mode).toBe('mirror')
    expect(view.snapshot?.stale).toBe(false)
    expect(view.snapshot?.tasks.length).toBeGreaterThanOrEqual(1)
    for (const task of view.snapshot?.tasks ?? []) {
      expect(task.sourcePath).not.toContain('..')
      expect(task.sourcePath.startsWith('.agents/') || task.sourcePath.startsWith('.agents\\')).toBe(true)
    }

    const board = projectRepositoryBoard(view.snapshot, 'repo:agent-workflow-scrum')
    const columns = ['ready', 'in_progress', 'review', 'blocked', 'completed', 'needs_attention'] as const
    const mirrored = columns.reduce((sum, column) => sum + board[column].length, 0)
    expect(mirrored).toBe(view.snapshot?.tasks.length)
  })
})
