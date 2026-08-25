import { describe, expect, it } from 'vitest'
import { classifyCompletionStatus, classifyPingStatus, pingProvider, providerCompletionUrl, probeProviderCompletion, providerPingUrl } from '../src/main/provider-ping.js'

function fakeFetch(status: number, delayMs = 0): typeof fetch {
  return (async () => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return new Response(null, { status })
  }) as unknown as typeof fetch
}

describe('providerPingUrl', () => {
  it('appends the models path and strips trailing slashes', () => {
    expect(providerPingUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/models')
    expect(providerPingUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/models')
  })
})

describe('classifyPingStatus', () => {
  it('treats any HTTP answer as reachable', () => {
    expect(classifyPingStatus(200)).toBe('ok')
    expect(classifyPingStatus(404)).toBe('ok')
    expect(classifyPingStatus(500)).toBe('ok')
  })

  it('marks credential rejections separately', () => {
    expect(classifyPingStatus(401)).toBe('auth')
    expect(classifyPingStatus(403)).toBe('auth')
  })
})

describe('pingProvider', () => {
  it('reports ok with measured latency for a healthy route', async () => {
    let ticks = 0
    const now = () => (ticks += 40)
    const outcome = await pingProvider(
      { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' },
      { fetchImpl: fakeFetch(200), now },
    )
    expect(outcome).toEqual({
      state: 'ok',
      latencyMs: 40,
      status: 200,
      probedUrl: 'https://api.deepseek.com/models',
    })
  })

  it('reports auth when the credential is rejected', async () => {
    const outcome = await pingProvider({ baseUrl: 'https://api.example.com', apiKey: 'bad' }, { fetchImpl: fakeFetch(401) })
    expect(outcome.state).toBe('auth')
    expect(outcome.status).toBe(401)
  })

  it('reports unreachable when the server never answers', async () => {
    const outcome = await pingProvider({ baseUrl: 'https://down.example.com' }, { fetchImpl: fakeFetch(503) })
    expect(outcome.state).toBe('ok')
    const failing = (async () => { throw new Error('ENOTFOUND') }) as unknown as typeof fetch
    const dead = await pingProvider({ baseUrl: 'https://down.example.com' }, { fetchImpl: failing })
    expect(dead.state).toBe('unreachable')
    expect(dead.status).toBeUndefined()
  })

  it('skips the network entirely without a base URL', async () => {
    let called = false
    const outcome = await pingProvider({ baseUrl: '  ' }, {
      fetchImpl: (async () => { called = true; return new Response() }) as unknown as typeof fetch,
    })
    expect(outcome).toEqual({ state: 'unreachable' })
    expect(called).toBe(false)
  })
})

describe('providerCompletionUrl', () => {
  it('appends the chat completions path and strips trailing slashes', () => {
    expect(providerCompletionUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(providerCompletionUrl('http://127.0.0.1:20128/v1/')).toBe('http://127.0.0.1:20128/v1/chat/completions')
  })
})

describe('classifyCompletionStatus', () => {
  it('treats a 200 without an error envelope as ok', () => {
    expect(classifyCompletionStatus(200, false)).toBe('ok')
  })

  it('treats a 200 carrying an error envelope as unreachable', () => {
    expect(classifyCompletionStatus(200, true)).toBe('unreachable')
  })

  it('marks credential rejections and upstream statuses', () => {
    expect(classifyCompletionStatus(401, false)).toBe('auth')
    expect(classifyCompletionStatus(403, false)).toBe('auth')
    expect(classifyCompletionStatus(502, false)).toBe('unreachable')
  })
})

function fakeJsonFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

describe('probeProviderCompletion', () => {
  const target = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test', model: 'stealth/ox-alpha' }

  it('reports ok for a real generated choice', async () => {
    const outcome = await probeProviderCompletion(target, {
      fetchImpl: fakeJsonFetch(200, { choices: [{ message: { role: 'assistant', content: 'OK.' } }] }),
      now: () => 5,
    })
    expect(outcome.state).toBe('ok')
    expect(outcome.status).toBe(200)
    expect(outcome.detail).toBeUndefined()
  })

  it('surfaces the provider error message when a 200 hides an upstream failure', async () => {
    const outcome = await probeProviderCompletion(target, {
      fetchImpl: fakeJsonFetch(200, { error: { message: 'Provider returned error', code: 502 } }),
      now: () => 5,
    })
    expect(outcome.state).toBe('unreachable')
    expect(outcome.detail).toBe('Provider returned error')
  })

  it('classifies auth rejections and keeps the provider message as detail', async () => {
    const outcome = await probeProviderCompletion(target, {
      fetchImpl: fakeJsonFetch(401, { error: { message: 'Invalid key' } }),
      now: () => 5,
    })
    expect(outcome.state).toBe('auth')
    expect(outcome.detail).toBe('Invalid key')
  })

  it('fails closed on transport errors', async () => {
    const failing = (async () => { throw new Error('boom') }) as unknown as typeof fetch
    const outcome = await probeProviderCompletion(target, { fetchImpl: failing, now: () => 5 })
    expect(outcome.state).toBe('unreachable')
  })
})
