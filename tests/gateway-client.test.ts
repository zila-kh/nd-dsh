import { describe, expect, it } from 'vitest'
import { GatewayClient, pickFreePort } from '../src/main/dsh/gateway-client.js'

describe('pickFreePort', () => {
  it('returns a valid, bindable loopback port', async () => {
    const port = await pickFreePort()
    expect(Number.isInteger(port)).toBe(true)
    expect(port).toBeGreaterThanOrEqual(1_024)
    expect(port).toBeLessThanOrEqual(65_535)
  })

  it('returns distinct ports across calls', async () => {
    const first = await pickFreePort()
    const second = await pickFreePort()
    expect(first).not.toBe(second)
  })
})

describe('GatewayClient.rpc', () => {
  it('returns a structured unreachable result instead of throwing when the runtime is down', async () => {
    // A reserved-then-released port has nothing listening on it.
    const port = await pickFreePort()
    const client = new GatewayClient(`http://127.0.0.1:${port}`)
    const result = await client.rpc('session.list', {})
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('gateway-unreachable')
    expect(result.error?.message).toContain('session.list')
  })
})
