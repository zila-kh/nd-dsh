import type { TokenSaverService } from './token-saver-service.js'

let active: TokenSaverService | undefined

/** Main-process seam shared by IPC and engine dispatch without importing Electron into pure tests. */
export function setTokenSaverRuntime(service: TokenSaverService | undefined): void {
  active = service
}

export function tokenSaverRuntime(): TokenSaverService | undefined {
  return active
}
