import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderStore } from '../src/main/providers.js'
import type { TokenSaverService } from '../src/main/token-saver/token-saver-service.js'
import { NdGatewayService } from '../src/main/gateway/gateway-service.js'
import { CodexGatewayConfigManager } from '../src/main/gateway/codex-config-manager.js'

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

  it('requires a real app connector for Full ND mode', async () => {
    const service = new NdGatewayService(() => provider(true), tokenSaver())
    closers.push(() => service.close())
    await expect(service.prepareLocalBinding('chatgpt', 'full-nd', 'deepseek')).rejects.toThrow(/supported ND app connector/i)
    expect(service.state().running).toBe(false)
  })

  it('does not pretend ChatGPT Desktop supports a custom model endpoint', () => {
    const service = new NdGatewayService(() => provider(true), tokenSaver())
    closers.push(() => service.close())
    const chatgpt = service.state().apps.find((app) => app.id === 'chatgpt')
    expect(chatgpt?.supported).toBe(false)
    expect(chatgpt?.connected).toBe(false)
  })

  it('exposes Codex as a supported Responses API client', () => {
    const service = new NdGatewayService(() => provider(true, 'Responses (/responses)'), tokenSaver())
    closers.push(() => service.close())
    const codex = service.state().apps.find((app) => app.id === 'codex')
    expect(codex?.supported).toBe(true)
    expect(codex?.connected).toBe(false)
  })

  it('rejects a Codex connection when the selected route is not Responses-compatible', async () => {
    const service = new NdGatewayService(() => provider(true), tokenSaver())
    closers.push(() => service.close())
    await expect(service.connect({ appId: 'codex', mode: 'llm-only', providerId: 'deepseek' }))
      .rejects.toThrow(/must use the Responses/i)
    expect(service.state().running).toBe(false)
  })

  it('adds ND rows to the native Codex catalog and routes only those rows through ND', async () => {
    const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (url === 'https://chatgpt.com/backend-api/codex/models') {
        return new Response(JSON.stringify({ models: [{
          slug: 'gpt-5.6', display_name: 'GPT-5.6', description: 'Native', visibility: 'list',
          supported_in_api: true, supported_reasoning_levels: [], tool_mode: 'native',
        }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url === 'https://api.deepseek.com/v1/responses') {
        return new Response(JSON.stringify({ id: 'response_1', output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === 'https://chatgpt.com/backend-api/codex/responses') {
        return new Response(JSON.stringify({ id: 'native_1', output: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`Unexpected upstream ${url} ${init?.method ?? ''}`)
    })
    const service = new NdGatewayService(
      () => provider(true, 'Responses (/responses)'),
      optimizingTokenSaver(),
      upstream,
    )
    closers.push(() => service.close())

    const state = await service.connect({ appId: 'codex', mode: 'nd-enhanced', providerId: 'deepseek' })
    expect(state.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(state.apps.find((app) => app.id === 'codex')?.connected).toBe(true)

    const models = await fetch(`${state.endpoint}/models`, { headers: { authorization: 'Bearer native-token' } })
    expect(models.status).toBe(200)
    expect(await models.json()).toMatchObject({
      models: expect.arrayContaining([
        expect.objectContaining({ slug: 'gpt-5.6' }),
        expect.objectContaining({ slug: 'nd/deepseek/deepseek-chat', display_name: 'ND — DeepSeek — deepseek-chat' }),
      ]),
    })

    const result = await fetch(`${state.endpoint}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer native-token',
      },
      body: JSON.stringify({
        model: 'nd/deepseek/deepseek-chat',
        instructions: 'be concise',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      }),
    })

    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ id: 'response_1', output: [] })
    expect(upstream).toHaveBeenCalledTimes(2)
    const [url, init] = upstream.mock.calls[1]!
    expect(url).toBe('https://api.deepseek.com/v1/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'deepseek-chat',
      instructions: 'optimized:be concise',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'optimized:hello' }] }],
    })

    const native = await fetch(`${state.endpoint}/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer native-token' },
      body: JSON.stringify({ model: 'gpt-5.6', input: 'native request' }),
    })
    expect(native.status).toBe(200)
    expect(await native.json()).toEqual({ id: 'native_1', output: [] })
    const [nativeUrl, nativeInit] = upstream.mock.calls[2]!
    expect(nativeUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(new Headers(nativeInit?.headers).get('authorization')).toBe('Bearer native-token')
    expect(nativeInit?.body).toBe(JSON.stringify({ model: 'gpt-5.6', input: 'native request' }))
  })

  it('restores the prior Codex route and refuses to overwrite a user edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-gateway-'))
    const config = join(root, 'config.toml')
    const journal = join(root, 'gateway-route.json')
    const manager = new CodexGatewayConfigManager(config, journal)
    try {
      await writeFile(config, 'model = "gpt-5.6"\nopenai_base_url = "https://existing.example/v1"\n[features]\n', 'utf8')
      await manager.install('http://127.0.0.1:32100/v1')
      expect(await readFile(config, 'utf8')).toContain('# ND Gateway managed model catalog\nopenai_base_url = "http://127.0.0.1:32100/v1"')
      await manager.uninstall()
      expect(await readFile(config, 'utf8')).toContain('openai_base_url = "https://existing.example/v1"')

      await manager.install('http://127.0.0.1:32100/v1')
      await writeFile(config, 'openai_base_url = "https://user-changed.example/v1"\n', 'utf8')
      await expect(manager.uninstall()).rejects.toThrow(/refusing to overwrite/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('replaces its own stale loopback route after an ND restart, but never a user edit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nd-gateway-'))
    const config = join(root, 'config.toml')
    const journal = join(root, 'gateway-route.json')
    const manager = new CodexGatewayConfigManager(config, journal)
    try {
      await writeFile(config, 'openai_base_url = "https://original.example/v1"\nmodel = "gpt-5.6"\n', 'utf8')
      await manager.install('http://127.0.0.1:32100/v1')
      // ND was force-quit, so the previous managed route is still installed; the
      // restart allocates a new loopback port and reconnects.
      await manager.install('http://127.0.0.1:32200/v1')
      expect(await readFile(config, 'utf8')).toContain('openai_base_url = "http://127.0.0.1:32200/v1"')
      await manager.uninstall()
      expect(await readFile(config, 'utf8')).toContain('openai_base_url = "https://original.example/v1"')

      // Connecting again mixes ND's route with a user edit, which is still refused.
      await manager.install('http://127.0.0.1:32200/v1')
      const edited = (await readFile(config, 'utf8')).replace(
        'openai_base_url = "http://127.0.0.1:32200/v1"',
        'openai_base_url = "https://user-changed.example/v1"',
      )
      await writeFile(config, edited, 'utf8')
      await expect(manager.install('http://127.0.0.1:32200/v1')).rejects.toThrow(/refusing to overwrite/i)

      // Without the journal the changed route is unknown, so it stays fail-closed.
      await writeFile(config, '# ND Gateway managed model catalog\nopenai_base_url = "https://stale.example/v1"\n', 'utf8')
      await rm(journal)
      await expect(manager.install('http://127.0.0.1:32200/v1')).rejects.toThrow(/refusing to overwrite/i)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function provider(hasApiKey: boolean, apiFormat = 'Chat completions (/chat/completions)'): ProviderStore {
  return {
    list: () => [{
      id: 'deepseek', name: 'DeepSeek', enabled: true, baseUrl: 'https://api.deepseek.com',
      apiFormat, apiKey: '', hasApiKey, models: [{ id: 'deepseek-chat', context: '128K' }],
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

function optimizingTokenSaver(): TokenSaverService {
  return {
    optimize: (text: string) => ({ text: `optimized:${text}`, changed: true, originalChars: text.length, optimizedChars: text.length + 10, avoidedChars: 0 }),
  } as unknown as TokenSaverService
}
