import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultTokenSaverSettings } from '../src/shared/token-saver.js'
import { TokenSaverService } from '../src/main/token-saver/token-saver-service.js'

function service(): TokenSaverService {
  const root = mkdtempSync(join(tmpdir(), 'nd-token-saver-'))
  return new TokenSaverService(join(root, 'token-saver.json'))
}

describe('TokenSaverService', () => {
  it('defaults to ND built-in saving with external integration off', () => {
    const state = service().state()
    expect(state.settings.ndEnabled).toBe(true)
    expect(state.settings.mode).toBe('automatic')
    expect(state.settings.externalEnabled).toBe(false)
    expect(state.optimizers.find((item) => item.id === 'nd-native')?.available).toBe(true)
  })

  it('leaves short prompts unchanged', () => {
    const saver = service()
    const result = saver.optimize('fix the login button')
    expect(result.changed).toBe(false)
    expect(result.text).toBe('fix the login button')
  })

  it('collapses noisy repeated lines', () => {
    const saver = service()
    const repeated = Array.from({ length: 250 }, () => 'PASS src/auth.test.ts').join('\n')
    const result = saver.optimize(repeated)
    expect(result.changed).toBe(true)
    expect(result.avoidedChars).toBeGreaterThan(0)
    expect(result.text).toContain('identical lines omitted')
  })

  it('clips the middle of huge payloads while preserving head and tail', () => {
    const saver = service()
    const input = `HEAD\n${'x'.repeat(80_000)}\nTAIL`
    const result = saver.optimize(input, { maxChars: 8_000 })
    expect(result.changed).toBe(true)
    expect(result.text.startsWith('HEAD')).toBe(true)
    expect(result.text.endsWith('TAIL')).toBe(true)
    expect(result.text).toContain('middle of oversized payload omitted')
  })

  it('can disable ND saving without enabling external integration', () => {
    const saver = service()
    const current = saver.settings()
    saver.updateSettings({ ...current, ndEnabled: false })
    const input = Array.from({ length: 250 }, () => 'same line').join('\n')
    expect(saver.optimize(input).text).toBe(input)
    expect(saver.state().settings.externalEnabled).toBe(false)
  })

  it('persists external opt-in separately from ND saving', () => {
    const root = mkdtempSync(join(tmpdir(), 'nd-token-saver-'))
    const path = join(root, 'token-saver.json')
    const saver = new TokenSaverService(path)
    const settings = defaultTokenSaverSettings()
    saver.updateSettings({
      ...settings,
      externalEnabled: true,
      externalApps: { codex: true },
    })

    const restored = new TokenSaverService(path).state()
    expect(restored.settings.ndEnabled).toBe(true)
    expect(restored.settings.externalEnabled).toBe(true)
    expect(restored.settings.externalApps.codex).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8')).settings.externalEnabled).toBe(true)
  })

  it('tracks avoided characters without exposing original payloads in telemetry', () => {
    const saver = service()
    const input = Array.from({ length: 400 }, () => 'duplicate diagnostic').join('\n')
    saver.optimize(input)
    const counters = saver.state().counters
    expect(counters.operations).toBe(1)
    expect(counters.originalChars).toBe(input.length)
    expect(counters.avoidedChars).toBeGreaterThan(0)
    expect(Object.keys(counters)).toEqual([
      'originalChars',
      'optimizedChars',
      'avoidedChars',
      'operations',
      'fallbacks',
    ])
  })
})
