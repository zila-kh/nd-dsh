import { describe, expect, it } from 'vitest'
import { createExtraCliEngines } from '../src/main/engines/agent-cli/extra-cli-engines.js'
import {
  buildExtraCodingEngineCatalog,
  GOOSE_CLI_ENGINE_ID,
  HERMES_CLI_ENGINE_ID,
  JCODE_CLI_ENGINE_ID,
  MINIMAX_CLI_ENGINE_ID,
  OPENCODE_CLI_ENGINE_ID,
} from '../src/shared/extra-coding-engines.js'

describe('extra coding engines', () => {
  it('keeps coding harnesses workspace-capable while MiniMax stays chat-only', () => {
    const catalog = buildExtraCodingEngineCatalog({
      opencodeCliReady: true,
      gooseCliReady: true,
      jcodeCliReady: true,
      hermesCliReady: true,
      minimaxCliReady: true,
    })
    const byId = new Map(catalog.map((engine) => [engine.id, engine]))

    for (const id of [OPENCODE_CLI_ENGINE_ID, GOOSE_CLI_ENGINE_ID, JCODE_CLI_ENGINE_ID, HERMES_CLI_ENGINE_ID]) {
      expect(byId.get(id)?.available).toBe(true)
      expect(byId.get(id)?.capabilities.workspace).toBe(true)
      expect(byId.get(id)?.capabilities.filesystem).toBe(true)
      expect(byId.get(id)?.capabilities.shell).toBe(true)
      expect(byId.get(id)?.capabilities.browser).toBe(false)
      expect(byId.get(id)?.capabilities.humanApprovals).toBe(false)
    }

    expect(byId.get(MINIMAX_CLI_ENGINE_ID)?.available).toBe(true)
    expect(byId.get(MINIMAX_CLI_ENGINE_ID)?.capabilities.workspace).toBe(false)
    expect(byId.get(MINIMAX_CLI_ENGINE_ID)?.capabilities.filesystem).toBe(false)
    expect(byId.get(MINIMAX_CLI_ENGINE_ID)?.capabilities.shell).toBe(false)
  })

  it('registers a runtime adapter for every requested CLI id', () => {
    const engines = new Map(createExtraCliEngines())
    expect([...engines.keys()]).toEqual([
      OPENCODE_CLI_ENGINE_ID,
      GOOSE_CLI_ENGINE_ID,
      JCODE_CLI_ENGINE_ID,
      HERMES_CLI_ENGINE_ID,
      MINIMAX_CLI_ENGINE_ID,
    ])
    for (const engine of engines.values()) {
      expect(typeof engine.run).toBe('function')
      expect(typeof engine.createSession).toBe('function')
      expect(typeof engine.stop).toBe('function')
    }
  })
})
