import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CodexAppServerWire, type JsonObject } from '../src/main/engines/codex/codex-wire.js'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async (): Promise<void> => { await tick(); await tick() }

describe('Codex OAuth framing race', () => {
  it('does not miss login completion when it shares a stdout chunk with login/start response', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const sent: JsonObject[] = []
    const opened: string[] = []
    let buffer = ''
    output.on('data', (chunk: string) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) sent.push(JSON.parse(line) as JsonObject)
        newline = buffer.indexOf('\n')
      }
    })

    const wire = new CodexAppServerWire(input, output, {
      onNotification: () => {},
      onServerRequest: async () => ({}),
      onProtocolError: (error) => { throw error },
      onAuthUrl: async (url) => { opened.push(url) },
    })

    const started = wire.start()
    await flush()
    const initialize = sent.find((frame) => frame.method === 'initialize')!
    input.write(`${JSON.stringify({ id: initialize.id, result: {} })}\n`)
    await flush()

    const firstAccountRead = sent.find((frame) => frame.method === 'account/read')!
    input.write(`${JSON.stringify({ id: firstAccountRead.id, result: { account: null, requiresOpenaiAuth: true } })}\n`)
    await flush()

    const login = sent.find((frame) => frame.method === 'account/login/start')!
    const loginResponse = {
      id: login.id,
      result: {
        type: 'chatgpt',
        loginId: 'race-login',
        authUrl: 'https://auth.openai.com/oauth/authorize?race=1',
      },
    }
    const completion = {
      method: 'account/login/completed',
      params: { loginId: 'race-login', success: true },
    }
    // One stream write deliberately forces dispatch(response) then
    // dispatch(notification) before the awaiting continuation can run.
    input.write(`${JSON.stringify(loginResponse)}\n${JSON.stringify(completion)}\n`)
    await flush()

    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?race=1'])
    const accountReads = sent.filter((frame) => frame.method === 'account/read')
    expect(accountReads).toHaveLength(2)
    const secondAccountRead = accountReads[1]!
    input.write(`${JSON.stringify({
      id: secondAccountRead.id,
      result: {
        account: { type: 'chatgpt', email: 'race@example.com', planType: 'plus' },
        requiresOpenaiAuth: true,
      },
    })}\n`)

    await expect(started).resolves.toBeUndefined()
    wire.close()
  })
})
