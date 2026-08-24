import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CapabilityAssignmentStore } from '../src/main/capabilities/capability-assignment-store.js'
import {
  DEFAULT_CAPABILITY_PROVIDER,
  GRAPHIFY_CONTEXT_ID,
  ND_CODEX_CLI_CAPABILITY_ID,
  ND_HARNESS_CAPABILITY_ID,
  ND_ORG_MEMORY_ID,
  OPENVIKING_MEMORY_ID,
} from '../src/shared/capabilities.js'

describe('CapabilityAssignmentStore', () => {
  it('adopts non-default engine entries from the legacy engine-only file and leaves that file untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-assignments-'))
    const legacyPath = join(dir, 'engine-assignments.json')
    await writeFile(legacyPath, `${JSON.stringify({
      version: 1,
      agents: {
        'agent-pm': ND_CODEX_CLI_CAPABILITY_ID,
        'agent-on-default': ND_HARNESS_CAPABILITY_ID,
        ' ': ND_CODEX_CLI_CAPABILITY_ID,
        'agent-blank': '   ',
      },
    }, null, 2)}\n`, 'utf8')

    const store = new CapabilityAssignmentStore(join(dir, 'capability-assignments.json'))
    expect(await store.all()).toEqual({
      version: 1,
      agents: { 'agent-pm': { engine: ND_CODEX_CLI_CAPABILITY_ID } },
      roles: {},
      teams: {},
    })

    const legacy = JSON.parse(await readFile(legacyPath, 'utf8')) as { agents: Record<string, string> }
    expect(legacy.agents['agent-on-default']).toBe(ND_HARNESS_CAPABILITY_ID)
  })

  it('resolves with agent over role over team over the kind default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-assignments-'))
    const store = new CapabilityAssignmentStore(join(dir, 'capability-assignments.json'))
    await store.assign('role', 'role-builder', 'engine', ND_CODEX_CLI_CAPABILITY_ID)
    await store.assign('team', 'team-product', 'engine', 'test-engine')
    await store.assign('agent', 'agent-full', 'engine', 'test-engine')

    expect(await store.resolve('engine', { type: 'agent', id: 'agent-full', role: 'role-builder', team: 'team-product' })).toBe('test-engine')
    expect(await store.resolve('engine', { type: 'agent', id: 'agent-roleless', role: 'role-builder', team: 'team-product' })).toBe(ND_CODEX_CLI_CAPABILITY_ID)
    expect(await store.resolve('engine', { type: 'agent', id: 'agent-orphan', team: 'team-product' })).toBe('test-engine')
    expect(await store.resolve('engine', { type: 'agent', id: 'agent-fresh' })).toBe(DEFAULT_CAPABILITY_PROVIDER.engine)
    expect(await store.resolve('memory', { type: 'agent', id: 'agent-fresh' })).toBe(ND_ORG_MEMORY_ID)
  })

  it('deletes the key when the default is assigned and drops subjects left empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-assignments-'))
    const path = join(dir, 'capability-assignments.json')
    const store = new CapabilityAssignmentStore(path)
    await store.assign('agent', 'agent-solo', 'engine', ND_CODEX_CLI_CAPABILITY_ID)
    await store.assign('agent', 'agent-multi', 'engine', ND_CODEX_CLI_CAPABILITY_ID)
    await store.assign('agent', 'agent-multi', 'context', GRAPHIFY_CONTEXT_ID)
    await store.assign('agent', 'agent-multi', 'memory', OPENVIKING_MEMORY_ID)

    expect(await store.assign('agent', 'agent-solo', 'engine', ND_HARNESS_CAPABILITY_ID)).toEqual({
      version: 1,
      agents: { 'agent-multi': { engine: ND_CODEX_CLI_CAPABILITY_ID, context: GRAPHIFY_CONTEXT_ID, memory: OPENVIKING_MEMORY_ID } },
      roles: {},
      teams: {},
    })
    await store.assign('agent', 'agent-multi', 'engine', ND_HARNESS_CAPABILITY_ID)
    await store.assign('agent', 'agent-multi', 'context', DEFAULT_CAPABILITY_PROVIDER.context)
    const final = await store.assign('agent', 'agent-multi', 'memory', ND_ORG_MEMORY_ID)
    expect(final.agents).toEqual({})
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(final)
  })

  it('persists assignments for the next store instance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-assignments-'))
    const path = join(dir, 'capability-assignments.json')
    const store = new CapabilityAssignmentStore(path)
    await store.assign('agent', 'agent-persist', 'engine', ND_CODEX_CLI_CAPABILITY_ID)

    const reloaded = new CapabilityAssignmentStore(path)
    expect(await reloaded.resolve('engine', { type: 'agent', id: 'agent-persist' })).toBe(ND_CODEX_CLI_CAPABILITY_ID)
  })

  it('falls back to defaults when the file is unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-capability-assignments-'))
    const path = join(dir, 'capability-assignments.json')
    await writeFile(path, '{ this is not valid json', 'utf8')

    const store = new CapabilityAssignmentStore(path)
    expect(await store.all()).toEqual({ version: 1, agents: {}, roles: {}, teams: {} })
    expect(await store.resolve('engine', { type: 'agent', id: 'agent-any' })).toBe(DEFAULT_CAPABILITY_PROVIDER.engine)
  })
})
