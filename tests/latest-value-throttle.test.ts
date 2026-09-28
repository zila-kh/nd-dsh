import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttleLatest } from '../src/main/latest-value-throttle.js'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('throttleLatest', () => {
  it('delivers the first value immediately and only the latest value per window', () => {
    const seen: number[] = []
    const push = throttleLatest<number>(100, (value) => seen.push(value))
    push(1)
    push(2)
    push(3)
    expect(seen).toEqual([1])
    vi.advanceTimersByTime(100)
    expect(seen).toEqual([1, 3])
    vi.advanceTimersByTime(500)
    push(4)
    expect(seen).toEqual([1, 3, 4])
  })

  it('drops a pending value on cancel', () => {
    const seen: number[] = []
    const push = throttleLatest<number>(100, (value) => seen.push(value))
    push(1)
    push(2)
    push.cancel()
    vi.advanceTimersByTime(200)
    expect(seen).toEqual([1])
  })
})
