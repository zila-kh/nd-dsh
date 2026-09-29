import { describe, expect, it } from 'vitest'
import {
  ND_NATIVE_PRIVATE_SELECTION_ENV,
  nativePrivateSelectionEnabled,
} from '../src/main/engines/nd-native/native-selection-gate.js'

describe('ND Agent private selection gate', () => {
  it('fails closed unless the private operator flag is exactly 1', () => {
    expect(nativePrivateSelectionEnabled({})).toBe(false)
    expect(nativePrivateSelectionEnabled({ [ND_NATIVE_PRIVATE_SELECTION_ENV]: '0' })).toBe(false)
    expect(nativePrivateSelectionEnabled({ [ND_NATIVE_PRIVATE_SELECTION_ENV]: 'true' })).toBe(false)
    expect(nativePrivateSelectionEnabled({ [ND_NATIVE_PRIVATE_SELECTION_ENV]: ' 1 ' })).toBe(true)
  })
})
