import type { NdHostMethod } from '../../shared/extension-package.js'
import type { NdContext } from '../../shared/nd-context.js'
import type { NdCallerKind } from '../../shared/nd-invocations.js'

export interface NdHostCallContext {
  extensionId: string
  contributionId: string
  host: NdHostMethod
  context: NdContext
  caller: NdCallerKind
  runId?: string
  settings: Record<string, unknown>
}

export type NdHostHandler = (input: Record<string, unknown>, context: NdHostCallContext) => Promise<unknown>

/**
 * Allowlisted native host methods. Handlers live in the trusted main process
 * and are registered behind narrow closures, so extension contributions can
 * only reach the exact operations ND exposes — never arbitrary IPC, shell
 * strings, or renderer code.
 */
export class NativeHostRegistry {
  private handlers = new Map<NdHostMethod, NdHostHandler>()

  register(host: NdHostMethod, handler: NdHostHandler): void {
    if (this.handlers.has(host)) throw new Error(`Native host method already registered: ${host}`)
    this.handlers.set(host, handler)
  }

  has(host: NdHostMethod): boolean {
    return this.handlers.has(host)
  }

  missing(methods: readonly NdHostMethod[]): NdHostMethod[] {
    return methods.filter((method) => !this.handlers.has(method))
  }

  async call(host: NdHostMethod, input: Record<string, unknown>, context: NdHostCallContext): Promise<unknown> {
    const handler = this.handlers.get(host)
    if (!handler) throw new Error(`Native host method is not available: ${host}`)
    return handler(input, context)
  }
}
