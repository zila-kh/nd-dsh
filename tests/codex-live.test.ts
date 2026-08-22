import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CodexCliEngine } from '../src/main/engines/codex/codex-cli-engine.js'
import type { DshEventFrame } from '../src/shared/contracts.js'

/**
 * Live round trip against the REAL pinned app-server. Opt-in only:
 *   ND_DSH_LIVE_CODEX=1 pnpm vitest run tests/codex-live.test.ts
 * Uses the developer's native Codex auth; never runs in CI or pnpm test.
 */
const enabled = process.env.ND_DSH_LIVE_CODEX === '1'

// Resolve the pinned wrapper exactly like production's codexBinPath(), but
// without Electron's app.isPackaged (unavailable under plain vitest).
function resolvePinnedCodexBin(): string {
  const requireFromSubagent = createRequire(join(
    process.cwd(),
    'vendor/deepseek-harness/packages/subagent/subagent-codex/lib/index.js',
  ))
  const manifestPath = requireFromSubagent.resolve('@openai/codex/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: { codex?: string } }
  const bin = manifest.bin?.codex
  if (!bin) throw new Error('pinned @openai/codex manifest has no codex bin')
  return join(dirname(manifestPath), bin)
}

// The dev override keeps this runner out of Electron-only path resolution
// while exercising the same pinned payload production uses.
const originalOverride = process.env.ND_DSH_CODEX_BINARY
afterAll(() => {
  if (originalOverride === undefined) delete process.env.ND_DSH_CODEX_BINARY
  else process.env.ND_DSH_CODEX_BINARY = originalOverride
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

async function runPong(label: string): Promise<void> {
  process.env.ND_DSH_CODEX_BINARY = resolvePinnedCodexBin()
  const cwd = await mkdtemp(join(tmpdir(), 'nd-dsh-codex-live-'))
  const engine = new CodexCliEngine({ log: (line) => console.log(`[${label}] ${line}`) })
  const frames: DshEventFrame[] = []
  engine.setEmitter((frame) => frames.push(frame))
  try {
    const { sessionId } = await engine.createSession({ cwd })
    await engine.run('Reply with exactly the single word: pong', { sessionId })
    const replies = assistantTexts(frames)
    console.log(`[${label}] assistant replies:`, JSON.stringify(replies))
    expect(replies.length).toBeGreaterThan(0)
    expect(replies.join(' ').toLowerCase()).toContain('pong')
  } finally {
    await engine.close()
  }
}

describe.skipIf(!enabled)('live codex app-server', () => {
  it('round-trips a tiny prompt with the current native configuration', async () => {
    await runPong('as-is')
  }, 240_000)

  it('round-trips a tiny prompt with a clean CODEX_HOME (real auth.json, no overrides)', async () => {
    const originalCodexHome = process.env.CODEX_HOME
    const cleanHome = await mkdtemp(join(tmpdir(), 'nd-dsh-codex-home-'))
    // Real ChatGPT credentials, but none of the machine's config.toml
    // (dead local base_url, MCP servers, notify hooks).
    await copyFile(join(process.env.USERPROFILE ?? '', '.codex', 'auth.json'), join(cleanHome, 'auth.json'))
    process.env.CODEX_HOME = cleanHome
    try {
      await runPong('clean-home')
    } finally {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = originalCodexHome
      // Windows can still hold sqlite handles briefly after child teardown;
      // leftover OS-temp files are not worth failing the test over.
      await rm(cleanHome, { recursive: true, force: true }).catch(() => {})
    }
  }, 240_000)
})
