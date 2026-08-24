import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CodingEngineRegistry } from '../src/main/engines/coding-engine-registry.js'
import { CapabilityAssignmentStore } from '../src/main/capabilities/capability-assignment-store.js'
import { CapabilityRegistry, type CapabilityBuiltinProbes } from '../src/main/capabilities/capability-registry.js'
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
}

async function registryFixture(builtinProbes: CapabilityBuiltinProbes = {}, extraEngines: CodingEngineDescriptor[] = []): Promise<RegistryFixture> {
  const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-registry-'))
  const assignments = new CapabilityAssignmentStore(join(dir, 'capability-assignments.json'))
  const statuses = new CapabilityStatusStore(join(dir, 'capability-statuses.json'))
  const catalog = [
    ...buildCodingEngineCatalog({ harnessReady: true, codexReady: false, codexCliReady: true }),
    ...extraEngines,
  ]
  const engines: Pick<CodingEngineRegistry, 'list' | 'assign'> = {
    list: () => catalog,
    assign: async () => ({}),
  }
  return { registry: new CapabilityRegistry(assignments, engines, statuses, builtinProbes), assignments, statuses }
}

describe('CapabilityRegistry', () => {
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
