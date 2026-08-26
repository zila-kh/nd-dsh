import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultTokenSaverSettings, type TokenSaverInstallerState } from '../src/shared/token-saver.js'
import { TokenSaverService, type TokenSaverExternalControl } from '../src/main/token-saver/token-saver-service.js'

function service(options: ConstructorParameters<typeof TokenSaverService>[1] = {}): TokenSaverService {
  const root = mkdtempSync(join(tmpdir(), 'nd-token-saver-'))
  return new TokenSaverService(join(root, 'token-saver.json'), options)
}

class FakeExternal implements TokenSaverExternalControl {
  enabled = false
  failEnable = false
  enableCalls = 0
  disableCalls = 0

  state(): TokenSaverInstallerState {
    return {
      supported: true,
      installed: this.enabled,
      version: 'test',
      codexManaged: this.enabled,
      detail: 'test helper',
    }
  }

  async enableCodex(): Promise<void> {
    this.enableCalls += 1
    if (this.failEnable) throw new Error('setup failed')
    this.enabled = true
  }

  async disableCodex(): Promise<void> {
    this.disableCalls += 1
    this.enabled = false
  }
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
    const result = saver.optimize('fix the login button', { kind: 'prompt' })
    expect(result.changed).toBe(false)
    expect(result.text).toBe('fix the login button')
  })

  it('never middle-clips a user prompt', () => {
    const saver = service()
    const input = `HEAD\n${'x'.repeat(80_000)}\nTAIL`
    const result = saver.optimize(input, { kind: 'prompt', maxChars: 8_000 })
    expect(result.text).toBe(input)
    expect(result.text).not.toContain('middle of oversized payload omitted')
    expect(result.recoveryRef).toBeUndefined()
  })

  it('collapses noisy repeated tool lines and stores a recoverable original', () => {
    const saver = service()
    const repeated = Array.from({ length: 250 }, () => 'PASS src/auth.test.ts').join('\n')
    const result = saver.optimize(repeated, { kind: 'tool-output' })
    expect(result.changed).toBe(true)
    expect(result.avoidedChars).toBeGreaterThan(0)
    expect(result.text).toContain('identical lines omitted')
    if (!result.recoveryRef) throw new Error('expected recovery ref')
    expect(saver.recover(result.recoveryRef)).toBe(repeated)
  })

  it('clips the middle of huge generic payloads while preserving head and tail', () => {
    const saver = service()
    const input = `HEAD\n${'x'.repeat(80_000)}\nTAIL`
    const result = saver.optimize(input, { kind: 'generic', maxChars: 8_000 })
    expect(result.changed).toBe(true)
    expect(result.text.startsWith('HEAD')).toBe(true)
    expect(result.text.endsWith('TAIL')).toBe(true)
    expect(result.text).toContain('middle of oversized payload omitted')
    if (!result.recoveryRef) throw new Error('expected recovery ref')
    expect(saver.recover(result.recoveryRef)).toBe(input)
  })

  it('can disable ND saving without enabling external integration', async () => {
    const saver = service()
    const current = saver.settings()
    await saver.updateSettings({ ...current, ndEnabled: false })
    const input = Array.from({ length: 250 }, () => 'same line').join('\n')
    expect(saver.optimize(input).text).toBe(input)
    expect(saver.state().settings.externalEnabled).toBe(false)
  })

  it('persists external opt-in separately from ND saving', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nd-token-saver-'))
    const path = join(root, 'token-saver.json')
    const saver = new TokenSaverService(path)
    const settings = defaultTokenSaverSettings()
    await saver.updateSettings({
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

  it('installs and removes external Codex only after explicit opt-in', async () => {
    const external = new FakeExternal()
    const saver = service({ external })
    const base = saver.settings()
    await saver.updateSettings({ ...base, externalEnabled: true, externalApps: { codex: true } })
    expect(external.enableCalls).toBe(1)
    expect(saver.state().externalApps.find((item) => item.id === 'codex')?.managed).toBe(true)

    await saver.updateSettings({ ...saver.settings(), externalEnabled: false })
    expect(external.disableCalls).toBe(1)
    expect(external.enabled).toBe(false)
  })

  it('reconciles a persisted external opt-in on startup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nd-token-saver-'))
    const path = join(root, 'token-saver.json')
    const seed = new TokenSaverService(path)
    await seed.updateSettings({ ...seed.settings(), externalEnabled: true, externalApps: { codex: true } })
    const external = new FakeExternal()
    const restored = new TokenSaverService(path, { external })
    await restored.initialize()
    expect(external.enableCalls).toBe(1)
    expect(external.enabled).toBe(true)
  })

  it('rolls external settings back when setup fails and keeps ND saving on', async () => {
    const external = new FakeExternal()
    external.failEnable = true
    const saver = service({ external })
    await expect(saver.updateSettings({
      ...saver.settings(),
      externalEnabled: true,
      externalApps: { codex: true },
    })).rejects.toThrow('setup failed')
    expect(saver.state().settings.externalEnabled).toBe(false)
    expect(saver.state().settings.ndEnabled).toBe(true)
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
