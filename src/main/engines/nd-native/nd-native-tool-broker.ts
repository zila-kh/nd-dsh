import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { BrowserPlatformService } from '../../browser-platform/browser-platform-service.js'
import { BUILTIN_BROWSER_TARGET_ID } from '../../browser/browser-controller.js'
import type { CoreClient } from '../../core/core-client.js'
import type { WorkspaceService } from '../../workspace/workspace-service.js'
import { sessionInWorkspace } from '../../workspace/path-utils.js'
import type { NativeToolRequest, NdNativeEngine } from './nd-native-engine.js'

export interface NativeToolBrokerOptions {
  core: Pick<CoreClient, 'request'>
  browser: Pick<BrowserPlatformService, 'callAgent' | 'issueSessionAccess'>
  workspace: Pick<WorkspaceService, 'state'>
  ownsWorktree(cwd: string): boolean
  engine(): Pick<NdNativeEngine, 'listSessions'>
}

/** The Rust worker proposes actions; this trusted host resolves its session and
 * workspace binding before crossing any ND service boundary. */
export class NdNativeToolBroker {
  constructor(private readonly options: NativeToolBrokerOptions) {}

  /** An intent without a terminal receipt may already have reached the host.
   * Mark it uncertain at startup and never dispatch it again. */
  async reconcile(): Promise<number> {
    const latest = new Map<string, { state: string; sessionId: string | undefined; name: string | undefined }>()
    let afterSeq = 0
    for (;;) {
      const page = await this.options.core.request<{
        records: Array<{ seq: number; kind: string; state: string; resourceId?: string; idempotencyKey?: string; data?: { name?: string } }>
        truncated: boolean
      }>('effectJournal.replay', { afterSeq, limit: 1000 }, 15_000)
      for (const record of page.records) {
        afterSeq = record.seq
        if (record.kind === 'nd-agent.tool' && record.idempotencyKey) {
          latest.set(record.idempotencyKey, { state: record.state, sessionId: record.resourceId, name: record.data?.name })
        }
      }
      if (!page.truncated || page.records.length === 0) break
    }
    let reconciled = 0
    for (const [idempotencyKey, record] of latest) {
      if (record.state !== 'intent') continue
      await this.options.core.request('effectJournal.append', {
        kind: 'nd-agent.tool', state: 'uncertain', idempotencyKey,
        ...(record.sessionId ? { resourceId: record.sessionId } : {}),
        data: { ...(record.name ? { name: record.name } : {}), recovery: 'interrupted-before-receipt' },
      }, 5_000)
      reconciled += 1
    }
    return reconciled
  }

  async call(request: NativeToolRequest): Promise<unknown> {
    const session = this.options.engine().listSessions().find((item) => item.sessionId === request.sessionId)
    if (!session?.cwd || resolve(session.cwd) !== resolve(request.cwd)) {
      throw new Error('ND Agent tool request has no matching workspace-bound session')
    }
    const project = this.options.workspace.state().root
    if (!sessionInWorkspace(project, session.cwd) && !this.options.ownsWorktree(session.cwd)) {
      throw new Error('ND Agent session is outside the active project')
    }
    const args = request.arguments
    const receipt = randomUUID()
    await this.options.core.request('effectJournal.append', {
      kind: 'nd-agent.tool', state: 'intent', resourceId: request.sessionId,
      idempotencyKey: `nd-agent:${request.sessionId}:${receipt}`,
      data: { name: request.name, workspace: session.cwd },
    }, 5_000)
    try {
      let result: unknown
      switch (request.name) {
        case 'nd_workspace_read':
          result = await this.options.core.request('workspace.read', {
            root: session.cwd, path: stringArg(args, 'path'), maxBytes: 1024 * 1024,
          }, 15_000)
          break
        case 'nd_workspace_list':
          result = await this.options.core.request('workspace.list', {
            root: session.cwd, path: stringArg(args, 'path'), maxEntries: 500,
          }, 15_000)
          break
        case 'nd_browser_call': {
          const method = stringArg(args, 'method')
          if (!method.startsWith('browser.')) throw new Error('ND Agent browser method is invalid')
          const params = recordArg(args, 'params')
          result = await this.options.browser.callAgent(method, {
            ...params,
            targetId: BUILTIN_BROWSER_TARGET_ID,
            accessToken: this.options.browser.issueSessionAccess(request.sessionId),
          })
          break
        }
        case 'nd_workspace_write':
        case 'nd_shell':
        case 'nd_git':
        case 'nd_extension_call':
          throw new Error(`${request.name} is unavailable until the native workspace effect sandbox is verified`)
        default:
          throw new Error('Unknown ND Agent tool')
      }
      await this.finish(request, receipt, 'complete')
      return result
    } catch (error) {
      // A browser call can have taken effect before its transport fails. Keep
      // that outcome uncertain; the broker must never replay it implicitly.
      await this.finish(request, receipt, request.name === 'nd_browser_call' ? 'uncertain' : 'failed').catch(() => undefined)
      throw error
    }
  }

  private async finish(request: NativeToolRequest, receipt: string, state: 'complete' | 'failed' | 'uncertain'): Promise<void> {
    await this.options.core.request('effectJournal.append', {
      kind: 'nd-agent.tool', state, resourceId: request.sessionId,
      idempotencyKey: `nd-agent:${request.sessionId}:${receipt}`,
      data: { name: request.name },
    }, 5_000)
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`ND Agent ${key} must be a string`)
  return value
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`ND Agent ${key} must be an object`)
  return value as Record<string, unknown>
}
