import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CodexAppServerWire, type JsonObject } from '../src/main/engines/codex/codex-wire.js'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async (): Promise<void> => { await tick(); await tick() }

function setup() {
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
  return { input, sent, opened, wire }
}

async function reachLogin(input: PassThrough, sent: JsonObject[], wire: CodexAppServerWire) {
  const started = wire.start()
  await flush()
  const initialize = sent.find((frame) => frame.method === 'initialize')!
  input.write(`${JSON.stringify({ id: initialize.id, result: {} })}\n`)
  await flush()
  const firstAccountRead = sent.find((frame) => frame.method === 'account/read')!
  input.write(`${JSON.stringify({ id: firstAccountRead.id, result: { account: null, requiresOpenaiAuth: true } })}\n`)
  await flush()
  const login = sent.find((frame) => frame.method === 'account/login/start')!
  return { started, login }
}

async function finishAuthenticated(input: PassThrough, sent: JsonObject[]) {
  await flush()
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
}

describe('Codex OAuth framing race', () => {
  it('does not miss login completion when it shares a stdout chunk with login/start response', async () => {
    const { input, sent, opened, wire } = setup()
    const { started, login } = await reachLogin(input, sent, wire)
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
    await finishAuthenticated(input, sent)
    await expect(started).resolves.toBeUndefined()
    wire.close()
  })

  it('does not let a stale id-less completion satisfy a later login attempt', async () => {
    const { input, sent, opened, wire } = setup()
    // This can be produced by a prior canceled native login. With no login/start
    // response being dispatched, it must be ignored rather than cached.
    input.write(`${JSON.stringify({ method: 'account/login/completed', params: { success: true } })}\n`)
    await flush()

    const { started, login } = await reachLogin(input, sent, wire)
    input.write(`${JSON.stringify({
      id: login.id,
      result: {
        type: 'chatgpt',
        loginId: 'fresh-login',
        authUrl: 'https://auth.openai.com/oauth/authorize?race=2',
      },
    })}\n`)
    await flush()

    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?race=2'])
    // The stale completion must not advance to the post-login account read.
    expect(sent.filter((frame) => frame.method === 'account/read')).toHaveLength(1)

    // A live completion without loginId is still accepted when exactly one
    // login is actually pending, matching the v0.147 optional loginId schema.
    input.write(`${JSON.stringify({ method: 'account/login/completed', params: { success: true } })}\n`)
    await finishAuthenticated(input, sent)
    await expect(started).resolves.toBeUndefined()
    wire.close()
  })
})
