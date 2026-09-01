import { describe, expect, it } from 'vitest'
import { shouldShowDshNativeView } from './DshCodingSurface'

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
