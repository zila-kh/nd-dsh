import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EngineAssignmentStore } from '../src/main/engines/engine-assignment-store.js'
import { CODEX_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../src/shared/coding-engines.js'

describe('EngineAssignmentStore', () => {
  it('defaults employees to ND Harness and persists explicit engine assignments atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nd-dsh-engines-'))
    const path = join(dir, 'engine-assignments.json')
    const store = new EngineAssignmentStore(path)

    expect(await store.engineFor('agent-builder')).toBe(ND_HARNESS_ENGINE_ID)
    expect(await store.assign('agent-builder', CODEX_ENGINE_ID)).toEqual({ 'agent-builder': CODEX_ENGINE_ID })

    const reloaded = new EngineAssignmentStore(path)
    expect(await reloaded.engineFor('agent-builder')).toBe(CODEX_ENGINE_ID)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, agents: { 'agent-builder': CODEX_ENGINE_ID } })

    expect(await reloaded.assign('agent-builder', ND_HARNESS_ENGINE_ID)).toEqual({})
    expect(await reloaded.engineFor('agent-builder')).toBe(ND_HARNESS_ENGINE_ID)
  })
})
