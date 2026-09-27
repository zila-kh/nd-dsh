import { describe, expect, it } from 'vitest'
import {
  CORE_RESTART_DELAY_MS,
  CORE_RESTART_MAX_ATTEMPTS,
  CORE_RESTART_STABLE_RESET_MS,
  coreRestartPolicy,
} from '../src/main/core/core-client.js'

describe('ND Core bounded restart policy', () => {
  it('allows exactly one automatic restart with a bounded delay', () => {
    expect(CORE_RESTART_MAX_ATTEMPTS).toBe(1)
    expect(CORE_RESTART_DELAY_MS).toBeGreaterThanOrEqual(0)
    expect(CORE_RESTART_DELAY_MS).toBeLessThanOrEqual(1_000)
    expect(coreRestartPolicy(0)).toEqual({ restart: true, delayMs: CORE_RESTART_DELAY_MS })
  })

  it('fails closed after the restart budget is exhausted', () => {
    expect(coreRestartPolicy(1)).toEqual({ restart: false })
    expect(coreRestartPolicy(99)).toEqual({ restart: false })
    expect(coreRestartPolicy(Number.NaN)).toEqual({ restart: false })
  })

  it('only resets the budget after a meaningful stable window', () => {
    expect(CORE_RESTART_STABLE_RESET_MS).toBeGreaterThanOrEqual(30_000)
  })
})
