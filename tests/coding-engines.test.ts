import { describe, expect, it } from 'vitest'
import { buildCodingEngineCatalog, CODEX_CLI_ENGINE_ID, CODEX_ENGINE_ID, ND_HARNESS_ENGINE_ID } from '../src/shared/coding-engines.js'

describe('coding engine catalog', () => {
  it('keeps model providers separate from the product-owned coding engine registry', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true })
    expect(engines.map((engine) => engine.id)).toEqual([ND_HARNESS_ENGINE_ID, CODEX_ENGINE_ID, CODEX_CLI_ENGINE_ID])
    expect(engines.find((engine) => engine.id === ND_HARNESS_ENGINE_ID)?.integration).toBe('primary')
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.integration).toBe('delegated')
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.integration).toBe('primary')
  })

  it('advertises only capabilities ND actually wires for the delegated Codex adapter', () => {
    const codex = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: false }).find((engine) => engine.id === CODEX_ENGINE_ID)!
    expect(codex.available).toBe(true)
    expect(codex.name).toBe('Codex (delegated)')
    expect(codex.capabilities.workspace).toBe(true)
    expect(codex.capabilities.filesystem).toBe(true)
    expect(codex.capabilities.shell).toBe(true)
    expect(codex.capabilities.browser).toBe(false)
    expect(codex.capabilities.skills).toBe(false)
    expect(codex.capabilities.mcp).toBe(false)
    expect(codex.capabilities.humanApprovals).toBe(false)
    expect(codex.capabilities.persistentSessions).toBe(false)
  })

  it('advertises direct Codex CLI capabilities honestly', () => {
    const codexCli = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: true }).find((engine) => engine.id === CODEX_CLI_ENGINE_ID)!
    expect(codexCli.available).toBe(true)
    expect(codexCli.capabilities.workspace).toBe(true)
    expect(codexCli.capabilities.filesystem).toBe(true)
    expect(codexCli.capabilities.shell).toBe(true)
    expect(codexCli.capabilities.humanApprovals).toBe(true)
    expect(codexCli.capabilities.streaming).toBe(true)
    // Not wired yet: no ND browser/skills/MCP compilation, and threads are not
    // restored across restarts.
    expect(codexCli.capabilities.browser).toBe(false)
    expect(codexCli.capabilities.skills).toBe(false)
    expect(codexCli.capabilities.mcp).toBe(false)
    expect(codexCli.capabilities.modelProviderRouting).toBe(false)
    expect(codexCli.capabilities.persistentSessions).toBe(false)
  })

  it('carries engine-owned worker instructions so workflow code never branches on engines', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true })
    for (const engine of engines) {
      expect(engine.workerInstructions).toMatch(/Execution engine:/)
    }
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.workerInstructions).toContain('subagent_codex')
  })

  it('reports bootstrap failures without pretending an engine is available', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: false })
    expect(engines.every((engine) => !engine.available)).toBe(true)
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.unavailableReason).toMatch(/bootstrap/i)
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.unavailableReason).toMatch(/bootstrap/i)
  })

  it('keeps the direct Codex CLI available independently from the ND runtime bootstrap', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: true })
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.available).toBe(true)
    expect(engines.find((engine) => engine.id === ND_HARNESS_ENGINE_ID)?.available).toBe(false)
  })
})
