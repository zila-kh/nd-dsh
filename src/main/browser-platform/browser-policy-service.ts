import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type {
  BrowserActionEnvelope,
  BrowserActionReceipt,
  BrowserApprovalRequest,
  BrowserExecutionScope,
  BrowserNormalizedAction,
} from '../../shared/browser-platform.js'
import type { OrganizationStore } from '../organization/store.js'

const MAX_RECEIPTS = 2_000
const APPROVAL_TIMEOUT_MS = 5 * 60_000

interface ReceiptSnapshot {
  version: 1
  receipts: BrowserActionReceipt[]
}

interface PendingApproval {
  request: BrowserApprovalRequest
  resolve(value: boolean): void
  timer: ReturnType<typeof setTimeout>
}

export interface BrowserActionContext {
  source: 'agent' | 'renderer'
  sessionId?: string
}

export class BrowserPolicyService {
  private readonly pending = new Map<string, PendingApproval>()
  private receiptsLoaded = false
  private receipts: BrowserActionReceipt[] = []
  private saveChain: Promise<void> = Promise.resolve()
  private onChanged: (() => void) | undefined

  constructor(
    private readonly store: Pick<OrganizationStore, 'runBySession' | 'policy'>,
    private readonly receiptPath: string,
  ) {}

  setOnChanged(listener: (() => void) | undefined): void {
    this.onChanged = listener
  }

  approvals(): BrowserApprovalRequest[] {
    return [...this.pending.values()].map((item) => structuredClone(item.request))
  }

  async recentReceipts(): Promise<BrowserActionReceipt[]> {
    await this.loadReceipts()
    return structuredClone(this.receipts.slice(0, 100))
  }

  async trustedScope(context: BrowserActionContext): Promise<BrowserExecutionScope | undefined> {
    if (!context.sessionId) return undefined
    const run = await this.store.runBySession(context.sessionId)
    if (!run) return { sessionId: context.sessionId }
    return {
      sessionId: run.sessionId,
      companyId: run.companyId,
      projectId: run.projectId,
      ...(run.taskId ? { taskId: run.taskId } : {}),
      runId: run.id,
    }
  }

  async authorize(
    context: BrowserActionContext,
    input: Omit<BrowserActionEnvelope, 'id' | 'createdAt' | 'scope'> & { action?: BrowserNormalizedAction; detail?: string },
  ): Promise<{ envelope: BrowserActionEnvelope; decision: BrowserActionReceipt['decision'] }> {
    const scope = await this.trustedScope(context)
    const action = input.action ?? classifyBrowserAction(input.operation, input.detail)
    const envelope: BrowserActionEnvelope = {
      id: randomUUID(),
      action,
      operation: input.operation,
      targetId: input.targetId,
      profileId: input.profileId,
      ...(input.tabId ? { tabId: input.tabId } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(scope ? { scope } : {}),
      ...(input.destructive !== undefined ? { destructive: input.destructive } : {}),
      ...(input.externality ? { externality: input.externality } : {}),
      createdAt: Date.now(),
    }

    if (context.source === 'renderer' || !scope?.companyId || !scope.projectId || !scope.runId || !scope.sessionId) {
      return { envelope, decision: 'manual' }
    }

    const effect = await this.store.policy(scope.companyId, action)
    if (effect === 'allow') return { envelope, decision: 'allow' }
    if (effect === 'deny') {
      await this.record(envelope, 'deny', false, `${action} is denied by company policy`)
      throw new Error(`${action} is denied by company policy`)
    }

    const request: BrowserApprovalRequest = {
      id: randomUUID(),
      action,
      operation: input.operation,
      targetId: input.targetId,
      ...(input.tabId ? { tabId: input.tabId } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      companyId: scope.companyId,
      projectId: scope.projectId,
      ...(scope.taskId ? { taskId: scope.taskId } : {}),
      runId: scope.runId,
      sessionId: scope.sessionId,
      createdAt: Date.now(),
      expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
    }
    const allowed = await this.waitForApproval(request)
    if (!allowed) {
      await this.record(envelope, 'ask-rejected', false, `${action} was rejected by the user`)
      throw new Error(`${action} was rejected by the user`)
    }
    return { envelope, decision: 'ask-allowed' }
  }

  async complete(
    envelope: BrowserActionEnvelope,
    decision: BrowserActionReceipt['decision'],
    success: boolean,
    error?: string,
  ): Promise<void> {
    await this.record(envelope, decision, success, error)
  }

  resolveApproval(id: string, allowed: boolean): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(allowed)
    this.onChanged?.()
    return true
  }

  private waitForApproval(request: BrowserApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        resolve(false)
        this.onChanged?.()
      }, APPROVAL_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set(request.id, { request, resolve, timer })
      this.onChanged?.()
    })
  }

  private async record(
    envelope: BrowserActionEnvelope,
    decision: BrowserActionReceipt['decision'],
    success: boolean,
    error?: string,
  ): Promise<void> {
    await this.loadReceipts()
    const receipt: BrowserActionReceipt = {
      id: randomUUID(),
      actionId: envelope.id,
      action: envelope.action,
      operation: envelope.operation,
      targetId: envelope.targetId,
      profileId: envelope.profileId,
      ...(envelope.tabId ? { tabId: envelope.tabId } : {}),
      ...(envelope.origin ? { origin: envelope.origin } : {}),
      ...(envelope.scope ? { scope: envelope.scope } : {}),
      decision,
      success,
      ...(error ? { error: error.slice(0, 2_000) } : {}),
      createdAt: envelope.createdAt,
      completedAt: Date.now(),
    }
    this.receipts.unshift(receipt)
    if (this.receipts.length > MAX_RECEIPTS) this.receipts.length = MAX_RECEIPTS
    await this.persistReceipts()
    this.onChanged?.()
  }

  private async loadReceipts(): Promise<void> {
    if (this.receiptsLoaded) return
    try {
      const parsed = JSON.parse(await fs.readFile(this.receiptPath, 'utf8')) as Partial<ReceiptSnapshot>
      if (parsed?.version === 1 && Array.isArray(parsed.receipts)) {
        this.receipts = parsed.receipts.filter(validReceipt).slice(0, MAX_RECEIPTS)
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    this.receiptsLoaded = true
  }

  private async persistReceipts(): Promise<void> {
    const payload = `${JSON.stringify({ version: 1, receipts: this.receipts }, null, 2)}\n`
    const operation = this.saveChain.catch(() => undefined).then(async () => {
      await fs.mkdir(dirname(this.receiptPath), { recursive: true, mode: 0o700 })
      const temp = `${this.receiptPath}.${process.pid}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temp, payload, { encoding: 'utf8', mode: 0o600 })
        await fs.rename(temp, this.receiptPath)
      } catch (cause) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw cause
      }
    })
    this.saveChain = operation
    await operation
  }
}

export function classifyBrowserAction(operation: string, detail = ''): BrowserNormalizedAction {
  const text = `${operation} ${detail}`.toLowerCase()

  if (/\b(terraform\s+destroy|drop\s+(?:database|schema|table)|truncate\s+table|delete\s+from|delete\s+(?:account|production|prod)|destroy\s+(?:production|prod))\b/.test(text)) {
    return 'data.destructive'
  }
  if (/\b(?:prod|production)\b[\s\S]{0,80}\b(?:deploy|release|publish|push|apply)\b/.test(text)
    || /\b(?:deploy|release)\b[\s\S]{0,80}\b(?:prod|production)\b/.test(text)) {
    return 'production.deploy'
  }
  if (/\b(?:purchase|buy|checkout|payment|charge|spend|paid)\b/.test(text)) return 'money.spend'
  if (/\b(?:send|publish|post|submit|create\s+pr|git\s+push)\b/.test(text)) return 'external.publish'
  if (operation.includes('credential') || operation.includes('autofill')) return 'credential.use'
  if (operation.includes('download')) return 'file.download'
  if (operation.includes('upload')) return 'file.upload'
  if (operation.includes('history')) return 'browser.history'
  if (operation.includes('extension')) return 'browser.extension.manage'
  if (operation.includes('navigate') || operation.includes('openTab')) return 'browser.navigate'
  if (operation.includes('snapshot') || operation.includes('screenshot') || operation.includes('tabs') || operation.includes('siteTools.list')) {
    return 'browser.read'
  }
  return 'browser.interact'
}

function validReceipt(value: unknown): value is BrowserActionReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as BrowserActionReceipt
  return typeof receipt.id === 'string'
    && typeof receipt.actionId === 'string'
    && typeof receipt.action === 'string'
    && typeof receipt.operation === 'string'
    && typeof receipt.targetId === 'string'
    && typeof receipt.profileId === 'string'
    && typeof receipt.success === 'boolean'
    && typeof receipt.createdAt === 'number'
    && typeof receipt.completedAt === 'number'
}
