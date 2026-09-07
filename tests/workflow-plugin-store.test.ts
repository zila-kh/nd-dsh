import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowPluginStore } from '../src/main/workflows/workflow-plugin-store.js'
import {
  parseWorkflowPluginManifest,
  workflowSnapshotKeyId,
  type InstalledWorkflowPlugin,
  type ProjectWorkflowBinding,
  type WorkflowPluginManifest,
} from '../src/shared/workflow-plugins.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore(): Promise<{ store: WorkflowPluginStore; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-workflow-store-'))
  tempDirs.push(dir)
  return { store: new WorkflowPluginStore(join(dir, 'plugins.json')), path: join(dir, 'plugins.json') }
}

function manifest(): WorkflowPluginManifest {
  return parseWorkflowPluginManifest({
    protocol: 'nd.workflow/1',
    id: 'agent-workflow-scrum',
    version: '0.1.0',
    surface: 'plugin',
    ndApiVersion: '1',
    description: 'pilot plugin',
    contributions: [{ kind: 'workflow', id: 'scrum', protocolVersion: 1, methods: ['detect', 'readSnapshot', 'buildContext'] }],
    requestedPermissions: ['project.workflow.read', 'board.project'],
    transport: {
      kind: 'cli',
      invocation: 'x',
      requirements: { shell: false, fixedArgv: true, timeoutMs: 15_000, maxOutputBytes: 1_048_576, noInstall: true },
      methods: { detect: 'detect', readSnapshot: 'snapshot', buildContext: 'context' },
    },
  })
}

function binding(overrides: Partial<ProjectWorkflowBinding> = {}): ProjectWorkflowBinding {
  return {
    version: 1,
    companyId: 'c1',
    projectId: 'p1',
    pluginId: 'agent-workflow-scrum',
    pluginVersion: '0.1.0',
    contributionId: 'scrum',
    mode: 'mirror',
    contextEnabled: false,
    root: '/tmp/project',
    source: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('WorkflowPluginStore', () => {
  it('upserts plugins by id preserving install time and updating provenance', async () => {
    const { store } = await tempStore()
    const first = await store.upsertPlugin(manifest(), { kind: 'local', path: '/tmp/bundle' }, 100)
    expect(first.installedAt).toBe(100)
    const second = await store.upsertPlugin(manifest(), { kind: 'local', path: '/tmp/bundle2', gitDirty: true }, 200)
    expect(second.installedAt).toBe(100)
    expect(second.updatedAt).toBe(200)
    expect(second.source).toMatchObject({ path: '/tmp/bundle2', gitDirty: true })
    expect((await store.state()).plugins).toHaveLength(1)
  })

  it('persists across instances', async () => {
    const { store, path } = await tempStore()
    await store.upsertPlugin(manifest(), { kind: 'git', url: 'https://github.com/next-mmo/agent-workflow-scrum.git', resolvedSha: 'a'.repeat(40), localPath: '/cache/agent-workflow-scrum' }, 5)
    const reopened = new WorkflowPluginStore(path)
    const loaded = await reopened.getPlugin('agent-workflow-scrum')
    expect(loaded?.source).toMatchObject({ kind: 'git', resolvedSha: 'a'.repeat(40) })
    expect(loaded?.manifest.transport.requirements.noInstall).toBe(true)
  })

  it('keeps bindings scoped per company/project/plugin and returns the most recent', async () => {
    const { store } = await tempStore()
    await store.putBinding(binding({ updatedAt: 10 }))
    await store.putBinding(binding({ companyId: 'c2', updatedAt: 11 }))
    await store.putBinding(binding({ projectId: 'p2', updatedAt: 12 }))
    await store.putBinding(binding({ updatedAt: 20, root: '/tmp/new-root' }))
    const latest = await store.getBinding('c1', 'p1')
    expect(latest?.root).toBe('/tmp/new-root')
    expect(await store.getBinding('c2', 'p1')).toMatchObject({ companyId: 'c2' })
    expect(await store.getBinding('c1', 'p2')).toMatchObject({ projectId: 'p2' })
    expect(await store.getBinding('c1', 'p1', 'other-plugin')).toBeUndefined()
  })

  it('snapshots are keyed per binding and removed with it', async () => {
    const { store } = await tempStore()
    const key = { companyId: 'c1', projectId: 'p1', pluginId: 'agent-workflow-scrum' }
    const snapshot = {
      version: 1 as const,
      scannedAt: '2026-09-06T12:00:00.000Z',
      git: { available: false, dirty: false },
      stale: false,
      tasks: [],
      prds: [],
      diagnostics: [],
    }
    await store.putSnapshot(key, snapshot)
    expect(await store.getSnapshot('c1', 'p1', 'agent-workflow-scrum')).toBeDefined()
    expect(await store.getSnapshot('c1', 'p1', 'other')).toBeUndefined()
    await store.removeSnapshot('c1', 'p1', 'agent-workflow-scrum')
    expect(await store.getSnapshot('c1', 'p1', 'agent-workflow-scrum')).toBeUndefined()
    expect(workflowSnapshotKeyId(key)).toBe('c1:p1:agent-workflow-scrum')
  })

  it('removing a plugin cascades its bindings and snapshots but leaves others intact', async () => {
    const { store } = await tempStore()
    await store.upsertPlugin(manifest(), { kind: 'local', path: '/tmp/bundle' }, 1)
    await store.putBinding(binding({}))
    await store.putBinding(binding({ pluginId: 'other-plugin', updatedAt: 2 }))
    await store.putSnapshot({ companyId: 'c1', projectId: 'p1', pluginId: 'agent-workflow-scrum' }, emptySnapshot())
    await store.putSnapshot({ companyId: 'c1', projectId: 'p1', pluginId: 'other-plugin' }, emptySnapshot())

    await store.removePlugin('agent-workflow-scrum')

    expect(await store.getPlugin('agent-workflow-scrum')).toBeUndefined()
    expect(await store.getBinding('c1', 'p1', 'agent-workflow-scrum')).toBeUndefined()
    expect(await store.getSnapshot('c1', 'p1', 'agent-workflow-scrum')).toBeUndefined()
    expect(await store.getBinding('c1', 'p1', 'other-plugin')).toBeDefined()
    expect(await store.getSnapshot('c1', 'p1', 'other-plugin')).toBeDefined()
  })

  it('emits full state on every mutation', async () => {
    const { store } = await tempStore()
    const listener = vi.fn()
    store.setOnChanged(listener)
    await store.upsertPlugin(manifest(), { kind: 'local', path: '/tmp/bundle' }, 1)
    expect(listener).toHaveBeenCalledTimes(1)
    const emitted: InstalledWorkflowPlugin[] = listener.mock.calls[0]![0].plugins
    expect(emitted).toHaveLength(1)
    store.setOnChanged(undefined)
    await store.putBinding(binding({}))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

function emptySnapshot() {
  return {
    version: 1 as const,
    scannedAt: '2026-09-06T12:00:00.000Z',
    git: { available: false, dirty: false },
    stale: false,
    tasks: [],
    prds: [],
    diagnostics: [],
  }
}
