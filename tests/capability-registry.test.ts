import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodingEngineRegistry } from '../src/main/engines/coding-engine-registry.js'
import { CapabilityAssignmentStore } from '../src/main/capabilities/capability-assignment-store.js'
import { CapabilityRegistry, type CapabilityBuiltinProbes, type CapabilitySetupAdapters } from '../src/main/capabilities/capability-registry.js'
import { CapabilityStatusStore } from '../src/main/capabilities/capability-status-store.js'
import type { CodingEngineDescriptor } from '../src/shared/contracts.js'
import {
  DEFAULT_CAPABILITY_PROVIDER,
  GRAPHIFY_CONTEXT_ID,
  ND_CODEX_CLI_CAPABILITY_ID,
  ND_CODEX_DELEGATED_CAPABILITY_ID,
  ND_HARNESS_CAPABILITY_ID,
  ND_MEMORY_MCP_ID,
  ND_ORG_MEMORY_ID,
  ND_SESSION_RECALL_ID,
  ND_WORKSPACE_CONTEXT_ID,
  OPENVIKING_MEMORY_ID,
} from '../src/shared/capabilities.js'
import { buildCodingEngineCatalog } from '../src/shared/coding-engines.js'

/** Extra available engine so role and team fallbacks can use distinct usable providers. */
const TEST_ENGINE: CodingEngineDescriptor = {
  id: 'test-engine',
  name: 'Test Engine',
  integration: 'primary',
  available: true,
  description: 'Extra available engine used to prove routing precedence.',
  capabilities: {
    workspace: true,
    filesystem: true,
    shell: true,
    browser: false,
    skills: false,
    mcp: false,
    modelProviderRouting: false,
    humanApprovals: false,
    streaming: false,
    persistentSessions: false,
  },
}

interface RegistryFixture {
  registry: CapabilityRegistry
  assignments: CapabilityAssignmentStore
  statuses: CapabilityStatusStore
  statusPath: string
}

async function registryFixture(
  builtinProbes: CapabilityBuiltinProbes = {},
  extraEngines: CodingEngineDescriptor[] = [],
  setupAdapters: CapabilitySetupAdapters = {},
): Promise<RegistryFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-registry-'))
  const assignments = new CapabilityAssignmentStore(join(dir, 'capability-assignments.json'))
  const statusPath = join(dir, 'capability-statuses.json')
  const statuses = new CapabilityStatusStore(statusPath)
  const catalog = [
    ...buildCodingEngineCatalog({ harnessReady: true, codexReady: false, codexCliReady: true, antigravityReady: false }),
    ...extraEngines,
  ]
  const engines: Pick<CodingEngineRegistry, 'list' | 'assign'> = {
    list: () => catalog,
    assign: async () => ({}),
  }
  return { registry: new CapabilityRegistry(assignments, engines, statuses, builtinProbes, setupAdapters), assignments, statuses, statusPath }
}

const APPROVED_GRAPHIFY_SETUP = {
  sourceLabel: 'Graphify',
  sourceUrl: 'https://github.com/Graphify-Labs/graphify',
  packageId: 'graphifyy',
  version: '1.2.3',
  integrity: `sha256-${'a'.repeat(64)}` as const,
  prerequisites: ['Python 3.12'],
  fields: [{ id: 'workspace_token', label: 'Workspace token', required: true, sensitive: true }],
}

const SHARED_HARNESS_SETUP = {
  mode: 'source-runtime' as const,
  sourceLabel: 'DeepSeek Harness source checkout',
  sourceUrl: 'https://github.com/deepseek-ai/deepseek-harness',
  runtimeId: 'DeepSeek Harness runtime',
  version: '0.2.0-test',
  prerequisites: ['Node.js 24 or newer'],
  fields: [],
}

describe('CapabilityRegistry', () => {
  it('recovers an interrupted persisted setup as retryable failure after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-status-recovery-'))
    const statusPath = join(directory, 'capability-statuses.json')
    await writeFile(statusPath, JSON.stringify({
      version: 1,
      providers: {
        [ND_MEMORY_MCP_ID]: {
          providerId: ND_MEMORY_MCP_ID,
          enabled: false,
          setupState: 'installing',
          setupProgress: 55,
          setupMessage: 'Building Harness runtime packages',
        },
      },
    }))

    await expect(new CapabilityStatusStore(statusPath).get(ND_MEMORY_MCP_ID)).resolves.toMatchObject({
      enabled: false,
      setupState: 'failed',
      setupProgress: 55,
      setupMessage: expect.stringMatching(/interrupted/i),
      setupError: expect.stringMatching(/retry/i),
    })
  })

  it('shares one successful source-runtime setup across capabilities backed by the same runtime', async () => {
    const setupAdapters: CapabilitySetupAdapters = Object.fromEntries(
      [ND_MEMORY_MCP_ID, ND_SESSION_RECALL_ID].map((providerId) => [providerId, {
        descriptor: SHARED_HARNESS_SETUP,
        checkPrerequisites: async () => [{ id: 'node', label: 'Node.js 24 or newer', met: true }],
        install: async () => ({ installedVersion: SHARED_HARNESS_SETUP.version }),
        verify: async () => undefined,
      }]),
    )
    const { registry } = await registryFixture({}, [], setupAdapters)

    await expect(registry.setup(ND_MEMORY_MCP_ID, {})).resolves.toMatchObject({ setupState: 'installed' })
    await expect(registry.statuses()).resolves.toMatchObject({
      [ND_MEMORY_MCP_ID]: { setupState: 'installed', installedVersion: SHARED_HARNESS_SETUP.version },
      [ND_SESSION_RECALL_ID]: { setupState: 'installed', installedVersion: SHARED_HARNESS_SETUP.version },
    })
  })

  it('lists available builtins plus four unavailable adapter slots with reasons', async () => {
    const { registry } = await registryFixture()
    const byId = new Map(registry.list().map((item) => [item.id, item]))

    for (const builtin of [ND_HARNESS_CAPABILITY_ID, ND_ORG_MEMORY_ID, ND_WORKSPACE_CONTEXT_ID]) {
      expect(byId.get(builtin)?.available).toBe(true)
      expect(byId.get(builtin)?.integration).toBe('builtin')
    }
    for (const slot of [OPENVIKING_MEMORY_ID, ND_MEMORY_MCP_ID, ND_SESSION_RECALL_ID, GRAPHIFY_CONTEXT_ID]) {
      expect(byId.get(slot)?.available).toBe(false)
      expect(byId.get(slot)?.unavailableReason).toBeTruthy()
    }
    expect(byId.get(ND_CODEX_DELEGATED_CAPABILITY_ID)?.available).toBe(false)
    expect(byId.get(ND_CODEX_CLI_CAPABILITY_ID)?.available).toBe(true)
  })

  it('does not expose stale enabled or verification state for an unavailable adapter', async () => {
    const { registry, statuses } = await registryFixture()
    await statuses.recordProbe(GRAPHIFY_CONTEXT_ID, { ok: true, at: 123 })
    await statuses.setEnabled(GRAPHIFY_CONTEXT_ID, true)

    await expect(registry.statuses()).resolves.toMatchObject({
      [GRAPHIFY_CONTEXT_ID]: { enabled: false },
    })
    const status = (await registry.statuses())[GRAPHIFY_CONTEXT_ID]
    expect(status?.lastVerifiedAt).toBeUndefined()
    expect(status?.lastProbeAt).toBeUndefined()
  })

  it('stamps verification on success and records failures that invalidate any earlier pass', async () => {
    let memoryHealthy = false
    const { registry } = await registryFixture({
      [ND_ORG_MEMORY_ID]: async () => {
        if (!memoryHealthy) throw new Error('memory backend unreachable')
      },
    })

    const failed = await registry.verify(ND_ORG_MEMORY_ID)
    expect(failed.lastError).toBe('memory backend unreachable')
    expect(failed.lastVerifiedAt).toBeUndefined()

    memoryHealthy = true
    const recovered = await registry.verify(ND_ORG_MEMORY_ID)
    expect(recovered.lastVerifiedAt).toBeDefined()
    expect(recovered.lastError).toBeUndefined()

    memoryHealthy = false
    const regressed = await registry.verify(ND_ORG_MEMORY_ID)
    expect(regressed.lastError).toBe('memory backend unreachable')
    expect(regressed.lastVerifiedAt).toBeUndefined()
  })

  it('gates enabling on a passing verify while disabling stays always allowed', async () => {
    const { registry } = await registryFixture()

    await expect(registry.setEnabled(ND_CODEX_CLI_CAPABILITY_ID, true)).rejects.toThrow(/verification/i)

    const verified = await registry.verify(ND_CODEX_CLI_CAPABILITY_ID)
    expect(verified.lastVerifiedAt).toBeDefined()
    expect(verified.lastError).toBeUndefined()
    expect(verified.enabled).toBe(false)

    const enabled = await registry.setEnabled(ND_CODEX_CLI_CAPABILITY_ID, true)
    expect(enabled.enabled).toBe(true)

    await expect(registry.setEnabled(GRAPHIFY_CONTEXT_ID, false)).resolves.toMatchObject({ enabled: false })
  })

  it('runs an approved setup adapter, keeps secrets out of status, and requires a fresh verify after every setup', async () => {
    const received: string[] = []
    let verifyHealthy = true
    const setupAdapters: CapabilitySetupAdapters = {
      [GRAPHIFY_CONTEXT_ID]: {
        descriptor: APPROVED_GRAPHIFY_SETUP,
        checkPrerequisites: async () => [{ id: 'python', label: 'Python 3.12', met: true, detail: '3.12.8' }],
        install: async (values, report) => {
          received.push(values.workspace_token ?? '')
          await report({ state: 'installing', progress: 65, message: 'Installing managed package' })
          await report({ state: 'configuring', progress: 90, message: 'Writing provider-owned configuration' })
          return {
            installedVersion: '1.2.3',
            sourceUrl: APPROVED_GRAPHIFY_SETUP.sourceUrl,
            integrity: APPROVED_GRAPHIFY_SETUP.integrity,
          }
        },
        verify: async () => { if (!verifyHealthy) throw new Error('graph service unavailable') },
      },
    }
    const { registry, statusPath } = await registryFixture({}, [], setupAdapters)
    const descriptor = registry.list().find((item) => item.id === GRAPHIFY_CONTEXT_ID)
    expect(descriptor).toMatchObject({ available: true, setup: APPROVED_GRAPHIFY_SETUP })

    await expect(registry.setup(GRAPHIFY_CONTEXT_ID, {})).rejects.toThrow(/Workspace token is required/)
    await expect(registry.setEnabled(GRAPHIFY_CONTEXT_ID, true)).rejects.toThrow(/Download & Setup/)
    await expect(registry.checkSetup(GRAPHIFY_CONTEXT_ID)).resolves.toMatchObject({ ready: true })

    const installed = await registry.setup(GRAPHIFY_CONTEXT_ID, { workspace_token: 'secret-value' })
    expect(installed).toMatchObject({ setupState: 'installed', installedVersion: '1.2.3', enabled: false })
    expect(JSON.stringify(installed)).not.toContain('secret-value')
    expect(await readFile(statusPath, 'utf8')).not.toContain('secret-value')
    await expect(new CapabilityStatusStore(statusPath).get(GRAPHIFY_CONTEXT_ID)).resolves.toMatchObject({
      setupState: 'installed', installedVersion: '1.2.3', enabled: false,
    })
    expect(received).toEqual(['secret-value'])
    await expect(registry.setEnabled(GRAPHIFY_CONTEXT_ID, true)).rejects.toThrow(/verification/i)

    await registry.verify(GRAPHIFY_CONTEXT_ID)
    await registry.setEnabled(GRAPHIFY_CONTEXT_ID, true)
    await registry.assign('agent', 'agent-graph', 'context', GRAPHIFY_CONTEXT_ID)
    await expect(registry.resolve('context', { id: 'agent-graph' })).resolves.toMatchObject({ id: GRAPHIFY_CONTEXT_ID })

    verifyHealthy = false
    const failed = await registry.verify(GRAPHIFY_CONTEXT_ID)
    expect(failed.enabled).toBe(false)
    expect(failed.lastVerifiedAt).toBeUndefined()
    await expect(registry.resolve('context', { id: 'agent-graph' })).rejects.toThrow(/disabled/i)
    verifyHealthy = true
    await registry.verify(GRAPHIFY_CONTEXT_ID)
    await registry.setEnabled(GRAPHIFY_CONTEXT_ID, true)

    const reinstalled = await registry.setup(GRAPHIFY_CONTEXT_ID, { workspace_token: 'rotated-secret' })
    expect(reinstalled.enabled).toBe(false)
    expect(reinstalled.lastVerifiedAt).toBeUndefined()
    expect(received).toEqual(['secret-value', 'rotated-secret'])
  })

  it('blocks setup when prerequisites fail and rejects unapproved installer metadata', async () => {
    const missingPrerequisite: CapabilitySetupAdapters = {
      [GRAPHIFY_CONTEXT_ID]: {
        descriptor: APPROVED_GRAPHIFY_SETUP,
        checkPrerequisites: async () => [{ id: 'python', label: 'Python 3.12', met: false, detail: 'Not found' }],
        install: async () => { throw new Error('install must not run') },
        verify: async () => undefined,
      },
    }
    const { registry } = await registryFixture({}, [], missingPrerequisite)
    await expect(registry.setup(GRAPHIFY_CONTEXT_ID, { workspace_token: 'secret' })).rejects.toThrow(/Missing prerequisites: Python 3.12/)
    await expect(registry.statuses()).resolves.toMatchObject({
      [GRAPHIFY_CONTEXT_ID]: { enabled: false, setupState: 'failed', setupError: expect.stringMatching(/Python 3.12/) },
    })

    const floatingVersion: CapabilitySetupAdapters = {
      [GRAPHIFY_CONTEXT_ID]: {
        ...missingPrerequisite[GRAPHIFY_CONTEXT_ID]!,
        descriptor: { ...APPROVED_GRAPHIFY_SETUP, version: 'latest' },
      },
    }
    const invalid = await registryFixture({}, [], floatingVersion)
    expect(() => invalid.registry.list()).toThrow(/exact approved version/)
  })

  it('refuses to assign an unavailable provider through the registry gate', async () => {
    const { registry } = await registryFixture()
    await expect(registry.assign('agent', 'agent-a', 'memory', OPENVIKING_MEMORY_ID)).rejects.toThrow(/reserved|unavailable/i)
    await expect(registry.assign('agent', 'agent-a', 'context', 'no-such-provider')).rejects.toThrow(/Unknown context provider/)
  })

  it('resolves untouched builtins and falls back through role then team then default', async () => {
    const { registry, assignments } = await registryFixture({}, [TEST_ENGINE])

    for (const kind of ['engine', 'memory', 'context'] as const) {
      const resolved = await registry.resolve(kind)
      expect(resolved.id).toBe(DEFAULT_CAPABILITY_PROVIDER[kind])
    }

    // Adapter-integrated engines start unverified and off; enable both so routing can reach them.
    for (const providerId of [ND_CODEX_CLI_CAPABILITY_ID, TEST_ENGINE.id]) {
      await registry.verify(providerId)
      await registry.setEnabled(providerId, true)
    }

    await assignments.assign('role', 'role-builder', 'engine', TEST_ENGINE.id)
    await assignments.assign('team', 'team-product', 'engine', ND_CODEX_CLI_CAPABILITY_ID)

    expect((await registry.resolve('engine', { id: 'agent-full', roleId: 'role-builder', teamId: 'team-product' })).id).toBe(TEST_ENGINE.id)
    expect((await registry.resolve('engine', { id: 'agent-roleless', teamId: 'team-product' })).id).toBe(ND_CODEX_CLI_CAPABILITY_ID)
    expect((await registry.resolve('engine', { id: 'agent-orphan' })).id).toBe(DEFAULT_CAPABILITY_PROVIDER.engine)
  })

  it('fails closed when a resolved provider is unavailable or disabled', async () => {
    const { registry, assignments, statuses } = await registryFixture({}, [TEST_ENGINE])

    await assignments.assign('agent', 'agent-viking', 'memory', OPENVIKING_MEMORY_ID)
    await expect(registry.resolve('memory', { id: 'agent-viking' })).rejects.toThrow(/OpenViking Memory/)

    await assignments.assign('agent', 'agent-cli', 'engine', ND_CODEX_CLI_CAPABILITY_ID)
    await statuses.setEnabled(ND_CODEX_CLI_CAPABILITY_ID, false)
    await expect(registry.resolve('engine', { id: 'agent-cli' })).rejects.toThrow(/disabled/i)

    await expect(registry.assertUsableForAgent({ id: 'agent-viking' })).rejects.toThrow(/cannot be used/)
  })

  it('asserts default agents are fully usable without configuration', async () => {
    const { registry } = await registryFixture()
    await expect(registry.assertUsableForAgent()).resolves.toBeUndefined()
    await expect(registry.assertUsableForAgent({ id: 'agent-new', roleId: 'role-new', teamId: 'team-new' })).resolves.toBeUndefined()
  })
})
