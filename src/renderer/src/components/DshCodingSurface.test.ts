import { describe, expect, it } from 'vitest'
import { isDshViewFailureTitle, shouldShowDshNativeView } from './DshCodingSurface'

describe('shouldShowDshNativeView', () => {
  it('keeps the native DSH view visible during normal use', () => {
    expect(shouldShowDshNativeView(true, false)).toBe(true)
  })

  it('yields native view layering while an inspect dialog is open', () => {
    expect(shouldShowDshNativeView(true, true)).toBe(false)
  })

  it('keeps an inactive DSH surface hidden', () => {
    expect(shouldShowDshNativeView(false, false)).toBe(false)
    expect(shouldShowDshNativeView(false, true)).toBe(false)
  })
})

describe('isDshViewFailureTitle', () => {
  it('surfaces view load failures', () => {
    expect(isDshViewFailureTitle('Load failed: ERR_CONNECTION_REFUSED')).toBe(true)
  })

  it('surfaces renderer crashes', () => {
    expect(isDshViewFailureTitle('UI renderer exited: crashed')).toBe(true)
  })

  it('treats product names and the idle fallback as branding rather than a failure', () => {
    expect(isDshViewFailureTitle('DeepSeek Harness')).toBe(false)
    expect(isDshViewFailureTitle('ND Harness')).toBe(false)
    expect(isDshViewFailureTitle(undefined)).toBe(false)
  })
})
