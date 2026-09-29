/**
 * ND Agent remains a private milestone. Source/dev builds may opt in explicitly
 * after running the milestone validation matrix; packaged/public builds stay
 * fail-closed unless the operator deliberately enables the private gate.
 */
export const ND_NATIVE_PRIVATE_SELECTION_ENV = 'ND_DSH_NATIVE_PRIVATE_SELECTION'

export function nativePrivateSelectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ND_NATIVE_PRIVATE_SELECTION_ENV]?.trim() === '1'
}
