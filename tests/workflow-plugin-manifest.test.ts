import { describe, expect, it } from 'vitest'
import {
  parseWorkflowDetection,
  parseWorkflowEnvelope,
  parseWorkflowPluginManifest,
  parseWorkflowSnapshot,
  projectRepositoryBoard,
  safeSourcePath,
  workflowSnapshotKeyId,
} from '../src/shared/workflow-plugins.js'

/** Mirrors the reviewed nd-plugin.json shipped in next-mmo/agent-dev-workflow. */
function validManifest(): Record<string, unknown> {
  return {
    protocol: 'nd.workflow/1',
    id: 'agent-workflow-scrum',
    version: '0.1.0',
    surface: 'plugin',
    ndApiVersion: '1',
    description: 'Read-only Agent Workflow Scrum workflow contribution: detection, board snapshot, and bounded context for the ND host',
    contributions: [
      { kind: 'workflow', id: 'scrum', protocolVersion: 1, methods: ['detect', 'readSnapshot', 'buildContext'] },
      { kind: 'context', id: 'active-increment', protocolVersion: 1 },
      { kind: 'command', id: 'workflow-status', hostCommand: 'kb:workflow-status' },
    ],
    requestedPermissions: ['project.workflow.read', 'board.project', 'context.contribute'],
    transport: {
      kind: 'cli',
      invocation: '{packageManager} exec -- agent-workflow nd <method> --root <projectRoot> --json',
      requirements: { shell: false, fixedArgv: true, timeoutMs: 15_000, maxOutputBytes: 1_048_576, noInstall: true },
      methods: { detect: 'detect', readSnapshot: 'snapshot', buildContext: 'context' },
    },
    upstream: {
      package: '@next-mmo/agent-workflow-scrum',
      supportedConfigSchemas: [1],
      supportedModes: ['vibe', 'standard', 'strict', 'guided'],
      taskPrefixes: ['todo-', 'wip-', 'blocked-', 'done-'],
    },
    limitations: ['read-only: this plugin never mutates the target repository'],
  }
}

describe('parseWorkflowPluginManifest', () => {
  it('accepts the reviewed upstream manifest shape', () => {
    const manifest = parseWorkflowPluginManifest(validManifest())
    expect(manifest.id).toBe('agent-workflow-scrum')
    expect(manifest.ndApiVersion).toBe('1')
    expect(manifest.transport.requirements).toMatchObject({ shell: false, fixedArgv: true, noInstall: true, timeoutMs: 15_000 })
    expect(manifest.transport.methods.readSnapshot).toBe('snapshot')
    expect(manifest.upstream?.package).toBe('@next-mmo/agent-workflow-scrum')
  })

  it('clamps transport limits into ND-enforced bounds', () => {
    const value = validManifest() as Record<string, unknown>
    const transport = { ...(value.transport as Record<string, unknown>) }
    transport.requirements = { ...(transport.requirements as Record<string, unknown>), timeoutMs: 1, maxOutputBytes: 1 }
    const manifest = parseWorkflowPluginManifest({ ...value, transport })
    expect(manifest.transport.requirements.timeoutMs).toBe(2_000)
    expect(manifest.transport.requirements.maxOutputBytes).toBe(4_096)
  })

  it('rejects foreign protocols, surfaces, API versions, and missing workflow contributions', () => {
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), protocol: 'nd.workflow/2' })).toThrow(/protocol/i)
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), surface: 'mcp' })).toThrow(/surface/i)
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), ndApiVersion: '2' })).toThrow(/ND API/)
    const noWorkflow = { ...validManifest(), contributions: [{ kind: 'context', id: 'active-increment' }] }
    expect(() => parseWorkflowPluginManifest(noWorkflow)).toThrow(/workflow contribution/)
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), contributions: [{ kind: 'workflow', id: 'scrum', protocolVersion: 2 }] })).toThrow(/workflow contribution/)
  })

  it('rejects unknown permissions and unsafe transports', () => {
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), requestedPermissions: ['company.admin'] })).toThrow(/unknown permission/)
    expect(() => parseWorkflowPluginManifest({ ...validManifest(), requestedPermissions: [] })).toThrow(/between 1 and 4/)
    const shellOut = structuredClone(validManifest()) as Record<string, unknown>
    const transport = shellOut.transport as Record<string, unknown>
    transport.requirements = { ...(transport.requirements as Record<string, unknown>), shell: true }
    expect(() => parseWorkflowPluginManifest(shellOut)).toThrow(/shell: false/)
    const autoInstall = structuredClone(validManifest()) as Record<string, unknown>
    const transport2 = autoInstall.transport as Record<string, unknown>
    transport2.requirements = { ...(transport2.requirements as Record<string, unknown>), noInstall: false }
    expect(() => parseWorkflowPluginManifest(autoInstall)).toThrow(/noInstall/)
    const remote = structuredClone(validManifest()) as Record<string, unknown>
    ;(remote.transport as Record<string, unknown>).kind = 'remote-exec'
    expect(() => parseWorkflowPluginManifest(remote)).toThrow(/CLI/)
  })

  it('rejects malformed upstream package names', () => {
    const value = validManifest() as Record<string, unknown>
    expect(() => parseWorkflowPluginManifest({ ...value, upstream: { ...(value.upstream as Record<string, unknown>), package: 'not a package' } })).toThrow(/npm package name/)
    expect(() => parseWorkflowPluginManifest({ ...value, upstream: { ...(value.upstream as Record<string, unknown>), package: '../../escape' } })).toThrow(/npm package name/)
  })
})

describe('parseWorkflowEnvelope', () => {
  const expected = { protocol: 'nd.workflow/1', pluginId: 'agent-workflow-scrum' }

  it('accepts a matching envelope and parses diagnostics', () => {
    const envelope = parseWorkflowEnvelope({
      protocol: 'nd.workflow/1',
      plugin: { id: 'agent-workflow-scrum', version: '0.1.0' },
      root: '/tmp/project',
      diagnostics: [
        { severity: 'warning', code: 'legacy_archived_filename', message: 'kept wip- name', sourcePath: 'done/wip-0002.md' },
        { severity: 'bogus', code: 'x', message: 'dropped' },
      ],
    }, expected)
    expect(envelope.plugin.version).toBe('0.1.0')
    expect(envelope.diagnostics).toHaveLength(1)
    expect(envelope.diagnostics[0]?.code).toBe('legacy_archived_filename')
  })

  it('fails closed on identity mismatch', () => {
    expect(() => parseWorkflowEnvelope({ protocol: 'nd.workflow/1', plugin: { id: 'other', version: '1' }, root: '/', diagnostics: [] }, expected)).toThrow(/unexpected plugin/)
    expect(() => parseWorkflowEnvelope({ protocol: 'other/1', plugin: { id: 'agent-workflow-scrum', version: '1' }, root: '/', diagnostics: [] }, expected)).toThrow(/protocol mismatch/)
  })
})

describe('parseWorkflowDetection', () => {
  it('reads supported and config', () => {
    expect(parseWorkflowDetection({ supported: true, config: { schemaVersion: 1, mode: 'standard', packageManager: 'npm' } })).toMatchObject({
      supported: true,
      config: { schemaVersion: 1, mode: 'standard', packageManager: 'npm' },
    })
    expect(parseWorkflowDetection({ supported: false })).toEqual({ supported: false })
  })
})

describe('parseWorkflowSnapshot', () => {
  it('keeps valid tasks and drops malformed ones with a diagnostic', () => {
    const snapshot = parseWorkflowSnapshot({
      scannedAt: '2026-09-06T12:00:00.000Z',
      git: { available: true, branch: 'main', head: 'a'.repeat(40), dirty: false },
      tasks: [
        {
          key: '1', sourcePath: 'todo-0001-0001-bootstrap.md', contentHash: 'h1', title: 'Bootstrap',
          lifecycle: 'todo', displayStatus: 'ready', archived: false, legacyArchive: false,
          prdRefs: ['0000'], outcome: 'working app', scope: ['app'], criteria: [{ text: 'renders', checked: true }],
          evidence: 'browser pass', humanAcceptance: 'accepted by ND', diagnostics: [],
        },
        { lifecycle: 'todo', sourcePath: '../../escape.md', title: 'escape attempt' },
        { lifecycle: 'nope', sourcePath: 'x.md', title: 'bad lifecycle' },
        { lifecycle: 'done', sourcePath: 'done/done-x.md' },
      ],
      prds: [{ key: '0', sourcePath: '.agents/docs/prd/0000-prd-index.md', title: 'PRD index', inIndex: true }],
      diagnostics: [{ severity: 'info', code: 'scan', message: 'ok' }],
    })
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]).toMatchObject({ key: '1', title: 'Bootstrap', displayStatus: 'ready', humanAcceptance: 'accepted by ND' })
    expect(snapshot.tasks[0]!.criteria).toEqual([{ text: 'renders', checked: true }])
    expect(snapshot.diagnostics.filter((item) => item.code === 'invalid_task_record')).toHaveLength(3)
    expect(snapshot.prds).toHaveLength(1)
    expect(snapshot.stale).toBe(false)
  })

  it('accepts the upstream facts-object shape for evidence and acceptance', () => {
    const snapshot = parseWorkflowSnapshot({
      scannedAt: '2026-09-06T12:00:00.000Z',
      git: { available: true, dirty: true },
      tasks: [
        {
          key: '1', sourcePath: 'todo-0001-0001-a.md', contentHash: 'sha256:aa', title: 'A',
          lifecycle: 'todo', displayStatus: 'ready', archived: false, legacyArchive: false,
          prdRefs: [], scope: [], criteria: [],
          evidence: { present: false, excerpt: '' },
          humanAcceptance: { recorded: false, excerpt: '' },
          diagnostics: [],
        },
        {
          key: '2', sourcePath: 'done/done-0002-b.md', contentHash: 'sha256:bb', title: 'B',
          lifecycle: 'done', displayStatus: 'completed', archived: true, legacyArchive: false,
          prdRefs: [], scope: [], criteria: [],
          evidence: { present: true, excerpt: 'integration test pass' },
          humanAcceptance: { recorded: true, excerpt: '' },
          diagnostics: [],
        },
      ],
      prds: [],
      diagnostics: [],
    })
    expect(snapshot.tasks[0]?.evidencePresent).toBeUndefined()
    expect(snapshot.tasks[0]?.humanAcceptanceRecorded).toBeUndefined()
    expect(snapshot.tasks[1]?.evidencePresent).toBe(true)
    expect(snapshot.tasks[1]?.evidence).toBe('integration test pass')
    expect(snapshot.tasks[1]?.humanAcceptanceRecorded).toBe(true)
  })

  it('rejects a missing or malformed top level', () => {
    expect(() => parseWorkflowSnapshot(null)).toThrow()
    expect(() => parseWorkflowSnapshot({ tasks: [] })).toThrow(/scannedAt/)
    expect(() => parseWorkflowSnapshot({ scannedAt: 'not-a-date', tasks: [] })).toThrow(/ISO/)
  })
})

describe('safeSourcePath', () => {
  it('allows relative paths inside the root and rejects escapes', () => {
    expect(safeSourcePath('todo-0001-0001-a.md')).toBe('todo-0001-0001-a.md')
    expect(safeSourcePath('done/done-0003.md')).toBe('done/done-0003.md')
    expect(safeSourcePath('.agents/docs/prd/0000.md')).toBe('.agents/docs/prd/0000.md')
    expect(safeSourcePath('../escape.md')).toBe('')
    expect(safeSourcePath('a/../../escape.md')).toBe('')
    expect(safeSourcePath('')).toBe('')
    expect(safeSourcePath(`x/${'y'.repeat(2_000)}`)).toBe('')
  })

  it('accepts absolute paths only under the reported root', () => {
    expect(safeSourcePath('C:\\proj\\done\\a.md', 'C:/proj')).toBe('C:/proj/done/a.md')
    expect(safeSourcePath('C:/proj/a.md', 'C:/proj')).toBe('C:/proj/a.md')
    expect(safeSourcePath('C:/other/a.md', 'C:/proj')).toBe('')
    expect(safeSourcePath('/srv/proj/a.md', '/srv/proj')).toBe('/srv/proj/a.md')
    expect(safeSourcePath('/srv/other/a.md', '/srv/proj')).toBe('')
    expect(safeSourcePath('/srv/proj/a.md')).toBe('')
  })
})

describe('workflowSnapshotKeyId', () => {
  it('namespaces by company, project, and plugin', () => {
    expect(workflowSnapshotKeyId({ companyId: 'c1', projectId: 'p1', pluginId: 'agent-workflow-scrum' })).toBe('c1:p1:agent-workflow-scrum')
  })
})
