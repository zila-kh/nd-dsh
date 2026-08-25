import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_EXTENSION_SURFACES, cloneBuiltinExtensionDemos } from '../src/shared/extensions.js'

const root = resolve('examples/extension-counter')

async function text(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

describe('Counter Agent Capabilities demo pack', () => {
  it('keeps one built-in UI demo for every surface', () => {
    const demos = cloneBuiltinExtensionDemos()
    expect(new Set(demos.map((demo) => demo.surface))).toEqual(new Set(AGENT_EXTENSION_SURFACES))
  })

  it('ships tangible repository fixtures for every surface', async () => {
    const fixtures = await Promise.all([
      text('demo-pack/memory.json'),
      text('demo-pack/subagent.md'),
      text('demo-pack/plugin.json'),
      text('mcp-server.mjs'),
      text('demo-pack/skill/SKILL.md'),
      text('demo-pack/command.md'),
      text('demo-pack/hooks.json'),
    ])
    expect(fixtures).toHaveLength(7)
    for (const fixture of fixtures) expect(fixture.length).toBeGreaterThan(80)
  })

  it('uses the same expected Counter value across fixtures', async () => {
    const memory = JSON.parse(await text('demo-pack/memory.json')) as { expectedRecall: number }
    const plugin = JSON.parse(await text('demo-pack/plugin.json')) as { smoke: string[] }
    const hooks = JSON.parse(await text('demo-pack/hooks.json')) as { events: { postRun: { expected: number } } }
    expect(memory.expectedRecall).toBe(7)
    expect(plugin.smoke.at(-1)).toContain('7')
    expect(hooks.events.postRun.expected).toBe(7)
    expect(await text('demo-pack/command.md')).toContain('7')
    expect(await text('demo-pack/skill/SKILL.md')).toContain('7')
    expect(await text('demo-pack/subagent.md')).toContain('7')
  })
})
