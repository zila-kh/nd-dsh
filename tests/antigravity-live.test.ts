import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AntigravityEngine } from '../src/main/engines/antigravity/antigravity-engine.js'
import { antigravityBinPath } from '../src/main/app-paths.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

/**
 * Live round trip against the REAL user-installed Antigravity CLI (agy).
 * Opt-in only:
 *   ND_DSH_LIVE_ANTIGRAVITY=1 pnpm vitest run tests/antigravity-live.test.ts
 * Uses the developer's native Antigravity authentication; never runs in CI or
 * pnpm test.
 */
const enabled = process.env.ND_DSH_LIVE_ANTIGRAVITY === '1'

const originalOverride = process.env.ND_DSH_ANTIGRAVITY_BINARY
afterAll(() => {
  if (originalOverride === undefined) delete process.env.ND_DSH_ANTIGRAVITY_BINARY
  else process.env.ND_DSH_ANTIGRAVITY_BINARY = originalOverride
})

function assistantTexts(frames: DshEventFrame[]): string[] {
  return frames.flatMap((frame) => {
    if (frame.kind !== 'session-event' || frame.event?.type !== 'assistant/message') return []
    const data = frame.event.data as { message?: { content?: Array<{ type?: string; text?: string }> } } | undefined
    return (data?.message?.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
  })
}

describe.skipIf(!enabled)('live Antigravity CLI', () => {
  it('round-trips a ping/pong prompt with the current native configuration', async () => {
    const bin = antigravityBinPath()
    expect(bin, 'Antigravity CLI (agy) must be installed for the live test').toBeTruthy()
    process.env.ND_DSH_ANTIGRAVITY_BINARY = bin
    const cwd = await mkdtemp(join(tmpdir(), 'nd-dsh-antigravity-live-'))
    const engine = new AntigravityEngine({ log: (line) => console.log(`[agy] ${line}`) })
    const frames: DshEventFrame[] = []
    engine.setEmitter((frame) => frames.push(frame))
    try {
      const { sessionId } = await engine.createSession({ cwd })
      expect(sessionId).toMatch(/^antigravity-/)
      await engine.run('Ping test. Reply with exactly the single word: pong', { sessionId })
      const replies = assistantTexts(frames)
      console.log('[agy] assistant replies:', JSON.stringify(replies))
      expect(replies.length).toBeGreaterThan(0)
      expect(replies.join(' ').toLowerCase()).toContain('pong')
      expect(engine.listSessions()[0]?.running).toBe(false)
    } finally {
      await engine.close()
    }
  }, 240_000)
})
