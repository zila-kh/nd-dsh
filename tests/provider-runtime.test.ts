import { describe, expect, it } from 'vitest'
import type { ModelProvider } from '../src/shared/contracts.js'
import {
  buildProviderRuntime,
  parseContextWindow,
  protocolFromApiFormat,
  providerCredentialEnvName,
} from '../src/main/provider-runtime.js'

function provider(patch: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'custom',
    name: 'Custom',
    enabled: true,
    baseUrl: 'https://example.test/v1',
    apiFormat: 'OpenAI compatible (/v1/chat/completions)',
    apiKey: 'secret-key',
    models: [{ id: 'model-1', context: '128K' }],
    ...patch,
  }
}

describe('provider runtime compiler', () => {
  it('keeps DeepSeek on the native compatibility route while compiling other vendors through pi-ai', () => {
    const runtime = buildProviderRuntime([
      provider({ id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'ds-key', models: [{ id: 'deepseek-v4-flash', context: '1M' }] }),
      provider({ id: 'openai', name: 'OpenAI', apiKey: 'oa-key', models: [{ id: 'gpt-next', context: '256K' }] }),
    ])

    expect(runtime.defaultProvider).toBe('deepseek-official')
    expect(runtime.defaultModel).toBe('deepseek-v4-flash')
    expect(runtime.environment.DEEPSEEK_API_KEY).toBe('ds-key')
    expect(runtime.profiles.deepseek).toBeUndefined()
    expect(runtime.profiles.openai?.api).toBe('openai-completions')
    expect(runtime.profiles.openai?.models).toEqual([{ id: 'gpt-next', contextWindow: 256_000 }])
    expect(runtime.profiles.openai?.apiKeyEnv).toMatch(/^ND_DSH_LLM_KEY_[0-9A-F]{16}$/)
    expect(JSON.stringify(runtime.profiles)).not.toContain('oa-key')
    expect(runtime.environment[runtime.profiles.openai!.apiKeyEnv!]).toBe('oa-key')
  })

  it('supports native catalog routing and Anthropic/OpenAI protocol families without vendor-specific code', () => {
    const runtime = buildProviderRuntime([
      provider({ id: 'catalog-route', apiFormat: 'Provider native / catalog default', baseUrl: '', apiKey: '', models: [{ id: 'catalog-model', context: '' }] }),
      provider({ id: 'anthropic-proxy', apiFormat: 'Anthropic Messages (/v1/messages)', apiKey: '', models: [{ id: 'claude-custom', context: '200K' }] }),
      provider({ id: 'responses-proxy', apiFormat: 'Responses (/responses)', apiKey: '', models: [{ id: 'response-model', context: '64K' }] }),
    ])

    expect(runtime.profiles['catalog-route']?.api).toBeUndefined()
    expect(runtime.profiles['catalog-route']?.baseURL).toBeUndefined()
    expect(runtime.profiles['anthropic-proxy']?.api).toBe('anthropic-messages')
    expect(runtime.profiles['responses-proxy']?.api).toBe('openai-responses')
  })

  it('excludes disabled providers and uses the first enabled provider with a model as the new-session default', () => {
    const runtime = buildProviderRuntime([
      provider({ id: 'off', enabled: false }),
      provider({ id: 'first', apiKey: '', models: [{ id: 'first-model', context: '32K' }] }),
      provider({ id: 'second', apiKey: '', models: [{ id: 'second-model', context: '32K' }] }),
    ])

    expect(runtime.profiles.off).toBeUndefined()
    expect(runtime.defaultProvider).toBe('first')
    expect(runtime.defaultModel).toBe('first-model')
  })

  it('normalizes context labels, protocols, and stable credential references', () => {
    expect(parseContextWindow('1M')).toBe(1_000_000)
    expect(parseContextWindow('128K')).toBe(128_000)
    expect(parseContextWindow('65536')).toBe(65_536)
    expect(parseContextWindow('unknown')).toBeUndefined()
    expect(protocolFromApiFormat('openai-completions')).toBe('openai-completions')
    expect(protocolFromApiFormat('Anthropic Messages (/v1/messages)')).toBe('anthropic-messages')
    expect(protocolFromApiFormat('Provider native / catalog default')).toBeUndefined()
    expect(providerCredentialEnvName('openai')).toBe(providerCredentialEnvName('openai'))
    expect(providerCredentialEnvName('openai')).not.toBe(providerCredentialEnvName('anthropic'))
  })

  it('rejects unsupported protocols and unsafe provider URLs before runtime launch', () => {
    expect(() => protocolFromApiFormat('mystery-wire-protocol')).toThrow(/unsupported provider api format/i)
    expect(() => buildProviderRuntime([provider({ id: 'broken', baseUrl: 'file:///tmp/model' })])).toThrow(/http or https/i)
  })
})
