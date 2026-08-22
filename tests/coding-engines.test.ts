import { describe, expect, it } from 'vitest'
import { buildCodingEngineCatalog, CODEX_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../src/shared/coding-engines.js'

describe('coding engine catalog', () => {
  it('keeps model providers separate from the product-owned coding engine registry', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true })
    expect(engines.map((engine) => engine.id)).toEqual([ND_HARNESS_ENGINE_ID, CODEX_ENGINE_ID])
    expect(engines.find((engine) => engine.id === ND_HARNESS_ENGINE_ID)?.integration).toBe('primary')
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.integration).toBe('delegated')
  })

  it('advertises only capabilities ND actually wires for the Codex adapter', () => {
    const codex = buildCodingEngineCatalog({ harnessReady: true, codexReady: true }).find((engine) => engine.id === CODEX_ENGINE_ID)!
    expect(codex.available).toBe(true)
    expect(codex.capabilities.workspace).toBe(true)
    expect(codex.capabilities.filesystem).toBe(true)
    expect(codex.capabilities.shell).toBe(true)
    expect(codex.capabilities.browser).toBe(false)
    expect(codex.capabilities.skills).toBe(false)
    expect(codex.capabilities.mcp).toBe(false)
    expect(codex.capabilities.humanApprovals).toBe(false)
    expect(codex.capabilities.persistentSessions).toBe(false)
  })

  it('reports bootstrap failures without pretending an engine is available', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: false, codexReady: false })
    expect(engines.every((engine) => !engine.available)).toBe(true)
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.unavailableReason).toMatch(/bootstrap/i)
  })
})
