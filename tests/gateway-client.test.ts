import { describe, expect, it } from 'vitest'
import { pickFreePort } from '../src/main/dsh/gateway-client.js'

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
