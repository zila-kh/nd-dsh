import type { HarnessStatus } from './contracts.js'

/**
 * Web-sidecar fallback contract.
 *
 * The desktop app reaches the DeepSeek Harness gateway through the main
 * process (loopback only, no CORS). A browser tab cannot reach that loopback
 * origin, so web mode falls back to a sidecar: a tiny HTTP + SSE server that
 * fronts the same gateway wire protocol with CORS enabled and adds the
 * harness/workspace/provider/theme/surface endpoints the renderer would
 * otherwise get from Electron.
 *
 * The sidecar is optional. The renderer probes {@link WEB_SIDECAR_HEALTH_PATH}
 * first and uses the sidecar when it answers, or the in-memory web mocks
 * otherwise.
 */

/** Environment variable that points the renderer at a web sidecar. */
export const WEB_SIDECAR_URL_ENV = 'ND_DSH_WEB_SIDECAR_URL'

/** Default sidecar address when ND_DSH_WEB_SIDECAR_URL is unset. */
export const WEB_SIDECAR_DEFAULT_URL = 'http://127.0.0.1:8788'

/** Probe endpoint the renderer uses to decide sidecar vs mocks. */
export const WEB_SIDECAR_HEALTH_PATH = '/api/health'

/** How long the renderer waits for the sidecar health probe before falling back to mocks. */
export const WEB_SIDECAR_PROBE_TIMEOUT_MS = 1_200

export interface WebSidecarHealth {
  ok: boolean
  gateway: boolean
  workspace?: { root: string; name: string }
}

/** Harness status the sidecar reports without the local DSH_HOME/gateway state. */
export interface WebSidecarHarnessStatus extends HarnessStatus {
  state: HarnessStatus['state']
}

/** Paths the sidecar serves itself; every other /api/* method proxies to the gateway. */
export const WEB_SIDECAR_OWN_PATHS = [
  '/api/health',
  '/api/respond',
  '/api/harness/status',
  '/api/harness/run',
  '/api/harness/stop',
  '/api/harness/permission/get',
  '/api/harness/permission/set',
  '/api/workspace/state',
  '/api/workspace/list',
  '/api/workspace/read',
  '/api/workspace/set-root',
  '/api/providers/list',
  '/api/providers/save',
  '/api/theme/state',
  '/api/theme/set',
  '/api/surface/state',
  '/api/surface/set',
  '/api/events.mux',
  '/api/events.host',
] as const
