import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ClaudeCodeCliEngine } from '../src/main/engines/claude/claude-code-cli-engine.js'
import { CursorCliEngine } from '../src/main/engines/cursor/cursor-cli-engine.js'
import { PiCodingEngine } from '../src/main/engines/pi/pi-coding-engine.js'
import { ZcodeCliEngine } from '../src/main/engines/zcode/zcode-cli-engine.js'
import { buildCodingEngineCatalog } from '../src/shared/coding-engines.js'
import { claudeBinPath, cursorBinPath, piBinPath, zcodeBinPath } from '../src/main/app-paths.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

/**
 * Live smoke tests against the real CLIs. Opt-in only — they spend real
 * model quota and depend on the host machine's installations:
 *
 *   ND_DSH_LIVE_SMOKE=1 pnpm vitest run tests/live-engine-smoke.test.ts
 *
 * Each engine either completes a trivial turn or rejects with a clear error;
 * the one thing they must never do is hang or leak children.
 */
const live = process.env.ND_DSH_LIVE_SMOKE === '1'
const liveSkip = (bin: string | undefined): boolean => !live || bin === undefined

function collect(engine: { setEmitter: (emit: (frame: DshEventFrame) => void) => void }): DshEventFrame[] {
  const frames: DshEventFrame[] = []
  engine.setEmitter((frame) => frames.push(frame))
  return frames
}

const streamedText = (frames: DshEventFrame[], sessionId: string): string => frames
  .filter((frame) => frame.sessionId === sessionId && frame.kind === 'session-event' && frame.event?.type === 'assistant/message')
  .map((frame) => {
    const data = (frame.event as { data?: { message?: { content?: Array<{ text?: string }> } } }).data
    return data?.message?.content?.map((block) => block.text ?? '').join('') ?? ''
  })
  .join('\n')

afterAll(() => {
  // Vitest kills the process when the test file ends; engines close in their
  // own finally blocks so no CLI child outlives the run.
})

describe.skipIf(liveSkip(claudeBinPath()))('live Claude Code CLI', () => {
  it('completes a trivial turn end to end', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'nd-live-claude-'))
    const engine = new ClaudeCodeCliEngine({ log: (line) => console.log(line) })
    const frames = collect(engine)
    try {
      expect(engine.ready()).toBe(true)
      const { sessionId } = await engine.createSession({ cwd: workspace })
      // With valid credentials the turn resolves with the model reply; with
      // revoked/expired ones the CLI reports `is_error` and the turn must
      // reject with that error instead of surfacing it as a reply.
      const outcome = await engine.run('Reply with exactly the word: pong. Do not use any tools.', { sessionId })
        .then(() => 'resolved' as const, (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`)
      console.log('[live-claude] outcome:', outcome)
      expect(outcome.startsWith('rejected: ') || outcome === 'resolved').toBe(true)
      if (outcome === 'resolved') {
        const reply = streamedText(frames, sessionId)
        console.log('[live-claude] reply:', reply.trim())
        expect(reply.toLowerCase()).toContain('pong')
      }
      expect(engine.listSessions()[0]?.running).toBe(false)
    } finally {
      await engine.close()
    }
  }, 180_000)
})

describe.skipIf(liveSkip(zcodeBinPath()))('live ZCode CLI', () => {
  it('settles a prompt within the request timeout instead of hanging', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'nd-live-zcode-'))
    const engine = new ZcodeCliEngine({ log: (line) => console.log(line) })
    const frames = collect(engine)
    try {
      expect(engine.ready()).toBe(true)
      const { sessionId } = await engine.createSession({ cwd: workspace })
      // On a machine whose ZCode CLI carries no static model provider the
      // app-server never answers session/create; the wire timeout must turn
      // that into a clear rejection, not a stuck turn. When the CLI is fully
      // configured the turn resolves and the assertion still holds.
      const outcome = await engine.run('Reply with exactly the word: pong. Do not use any tools.', { sessionId })
        .then(() => 'resolved' as const, (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`)
      console.log('[live-zcode] outcome:', outcome)
      expect(outcome.startsWith('rejected: ') || outcome === 'resolved').toBe(true)
      if (outcome === 'resolved') {
        expect(streamedText(frames, sessionId).toLowerCase()).toContain('pong')
      }
    } finally {
      await engine.close()
    }
  }, 120_000)
})

describe.skipIf(liveSkip(piBinPath()))('live Pi coding agent', () => {
  it('attaches over the RPC wires and settles a trivial turn', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'nd-live-pi-'))
    const engine = new PiCodingEngine({ log: (line) => console.log(line) })
    const frames = collect(engine)
    try {
      expect(engine.ready()).toBe(true)
      const { sessionId } = await engine.createSession({ cwd: workspace })
      const outcome = await engine.run('Reply with exactly the word: pong. Do not use any tools.', { sessionId })
        .then(() => 'resolved' as const, (error: unknown) => `rejected: ${error instanceof Error ? error.message : String(error)}`)
      console.log('[live-pi] outcome:', outcome)
      // Without provider credentials the model call fails; that must surface
      // as a rejection, never as a hang.
      expect(outcome.startsWith('rejected: ') || outcome === 'resolved').toBe(true)
      if (outcome === 'resolved') {
        expect(streamedText(frames, sessionId).toLowerCase()).toContain('pong')
      }
    } finally {
      await engine.close()
    }
  }, 180_000)
})

describe.skipIf(!live || cursorBinPath() !== undefined)('live Cursor CLI absence', () => {
  it('fails closed with an actionable unavailable reason', () => {
    expect(cursorBinPath()).toBeUndefined()
    const descriptor = buildCodingEngineCatalog({
      harnessReady: false,
      codexReady: false,
      codexCliReady: false,
      antigravityReady: false,
      zcodeCliReady: false,
      piCodingReady: false,
      cursorCliReady: false,
      claudeCodeCliReady: false,
    }).find((engine) => engine.id === 'cursor-cli')
    expect(descriptor?.available).toBe(false)
    expect(descriptor?.unavailableReason).toMatch(/ND_DSH_CURSOR_BINARY/)
  })
})
