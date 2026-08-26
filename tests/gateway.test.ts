import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderStore } from '../src/main/providers.js'
import type { TokenSaverService } from '../src/main/token-saver/token-saver-service.js'
import { NdGatewayService } from '../src/main/gateway/gateway-service.js'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

describe('ND Gateway', () => {
  it('requires a provider API key before a local binding can start', async () => {
    const service = new NdGatewayService(() => provider(false), tokenSaver())
    closers.push(() => service.close())
    await expect(service.prepareLocalBinding('chatgpt', 'llm-only', 'deepseek')).rejects.toThrow(/API key is required/i)
  })

  it('binds only to loopback and requires its generated per-app credential', async () => {
    const service = new NdGatewayService(() => provider(true), tokenSaver())
    closers.push(() => service.close())
    const binding = await service.prepareLocalBinding('chatgpt', 'nd-enhanced', 'deepseek')
    expect(binding.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(binding.token).toMatch(/^nd_local_/)

    const port = Number(new URL(binding.endpoint).port)
    const unauthorized = await fetch(`http://127.0.0.1:${port}/health`)
    expect(unauthorized.status).toBe(401)
    const authorized = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${binding.token}` },
    })
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({ ok: true })
  })

  it('does not pretend ChatGPT Desktop supports a custom model endpoint', () => {
    const service = new NdGatewayService(() => provider(true), tokenSaver())
    closers.push(() => service.close())
    const chatgpt = service.state().apps.find((app) => app.id === 'chatgpt')
    expect(chatgpt?.supported).toBe(false)
    expect(chatgpt?.connected).toBe(false)
  })
})

function provider(hasApiKey: boolean): ProviderStore {
  return {
    list: () => [{
      id: 'deepseek', name: 'DeepSeek', enabled: true, baseUrl: 'https://api.deepseek.com',
      apiFormat: 'Chat completions (/chat/completions)', apiKey: '', hasApiKey, models: [{ id: 'deepseek-chat', context: '128K' }],
    }],
    runtimeConfig: () => ({
      profiles: {},
      environment: hasApiKey ? { DEEPSEEK_API_KEY: 'secret', DEEPSEEK_BASE_URL: 'https://api.deepseek.com' } : {},
      defaultProvider: 'deepseek-official',
      defaultModel: 'deepseek-chat',
    }),
  } as unknown as ProviderStore
}

function tokenSaver(): TokenSaverService {
  return {
    optimize: (text: string) => ({ text, changed: false, originalChars: text.length, optimizedChars: text.length, avoidedChars: 0 }),
  } as unknown as TokenSaverService
}