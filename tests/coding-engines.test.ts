import { describe, expect, it } from 'vitest'
import {
  ANTIGRAVITY_ENGINE_ID,
  CHATGPT_WEB_ENGINE_ID,
  CODEX_CLI_ENGINE_ID,
  CODEX_ENGINE_ID,
  ND_HARNESS_ENGINE_ID,
  buildCodingEngineCatalog,
  chatGptWebEngineDescriptor,
  workerAssignableCodingEngines,
} from '../src/shared/coding-engines.js'

describe('coding engine catalog', () => {
  it('keeps model providers separate from the product-owned coding engine registry', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true, antigravityReady: true })
    expect(engines.map((engine) => engine.id)).toEqual([ND_HARNESS_ENGINE_ID, CODEX_ENGINE_ID, CODEX_CLI_ENGINE_ID, ANTIGRAVITY_ENGINE_ID])
    expect(engines.find((engine) => engine.id === ND_HARNESS_ENGINE_ID)?.integration).toBe('primary')
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.integration).toBe('delegated')
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.integration).toBe('primary')
    expect(engines.find((engine) => engine.id === ANTIGRAVITY_ENGINE_ID)?.integration).toBe('primary')
  })

  it('keeps browser-only ChatGPT Web interactive instead of worker-assignable', () => {
    const chatGpt = chatGptWebEngineDescriptor()
    expect(chatGpt.id).toBe(CHATGPT_WEB_ENGINE_ID)
    expect(chatGpt.available).toBe(true)
    expect(chatGpt.capabilities.browser).toBe(true)
    expect(chatGpt.capabilities.workspace).toBe(false)

    const workers = workerAssignableCodingEngines([
      ...buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true, antigravityReady: true }),
      chatGpt,
    ])
    expect(workers.map((engine) => engine.id)).not.toContain(CHATGPT_WEB_ENGINE_ID)
    expect(workers.map((engine) => engine.id)).toContain(ND_HARNESS_ENGINE_ID)
  })

  it('advertises only capabilities ND actually wires for the delegated Codex adapter', () => {
    const codex = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: false, antigravityReady: false }).find((engine) => engine.id === CODEX_ENGINE_ID)!
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
    const codexCli = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: true, antigravityReady: false }).find((engine) => engine.id === CODEX_CLI_ENGINE_ID)!
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

  it('advertises Antigravity CLI capabilities honestly', () => {
    const antigravity = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: false, antigravityReady: true }).find((engine) => engine.id === ANTIGRAVITY_ENGINE_ID)!
    expect(antigravity.available).toBe(true)
    expect(antigravity.capabilities.workspace).toBe(true)
    expect(antigravity.capabilities.filesystem).toBe(true)
    expect(antigravity.capabilities.shell).toBe(true)
    expect(antigravity.capabilities.streaming).toBe(true)
    // Headless `agy` auto-denies ungranted tools instead of prompting, and
    // conversations are not restored across ND restarts.
    expect(antigravity.capabilities.humanApprovals).toBe(false)
    expect(antigravity.capabilities.persistentSessions).toBe(false)
    expect(antigravity.capabilities.browser).toBe(false)
    expect(antigravity.capabilities.skills).toBe(false)
    expect(antigravity.capabilities.mcp).toBe(false)
    expect(antigravity.capabilities.modelProviderRouting).toBe(false)
  })

  it('carries engine-owned worker instructions so workflow code never branches on engines', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: true, codexReady: true, codexCliReady: true, antigravityReady: true })
    for (const engine of engines) {
      expect(engine.workerInstructions).toMatch(/Execution engine:/)
    }
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.workerInstructions).toContain('subagent_codex')
    expect(engines.find((engine) => engine.id === ANTIGRAVITY_ENGINE_ID)?.workerInstructions).toContain('headless')
  })

  it('reports bootstrap failures without pretending an engine is available', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: false, antigravityReady: false })
    expect(engines.every((engine) => !engine.available)).toBe(true)
    expect(engines.find((engine) => engine.id === CODEX_ENGINE_ID)?.unavailableReason).toMatch(/bootstrap/i)
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.unavailableReason).toMatch(/bootstrap/i)
    expect(engines.find((engine) => engine.id === ANTIGRAVITY_ENGINE_ID)?.unavailableReason).toMatch(/agy/i)
  })

  it('keeps the direct Codex CLI available independently from the ND runtime bootstrap', () => {
    const engines = buildCodingEngineCatalog({ harnessReady: false, codexReady: false, codexCliReady: true, antigravityReady: false })
    expect(engines.find((engine) => engine.id === CODEX_CLI_ENGINE_ID)?.available).toBe(true)
    expect(engines.find((engine) => engine.id === ND_HARNESS_ENGINE_ID)?.available).toBe(false)
  })
})
