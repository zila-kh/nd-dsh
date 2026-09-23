import { join } from 'node:path'
import type {
  BrowserCredentialSummary,
  BrowserExtensionRecord,
  BrowserPlatformState,
  BrowserSelection,
  BrowserTabDescriptor,
} from '../../shared/browser-platform.js'
import type { BrowserCompanionService } from '../browser-companion/browser-companion-service.js'
import type { BrowserController } from '../browser/browser-controller.js'
import { BUILTIN_BROWSER_TARGET_ID } from '../browser/browser-controller.js'
import { BrowserCredentialVault } from '../browser/browser-credential-vault.js'
import { BrowserExtensionManager } from '../browser/browser-extension-manager.js'
import type { OrganizationStore } from '../organization/store.js'
import { BrowserAccessTokenStore } from './browser-access-tokens.js'
import { BrowserPolicyService } from './browser-policy-service.js'
import { BrowserTargetRouter } from './browser-target-router.js'
import { UnifiedBrowserTabLeaseStore } from './browser-tab-leases.js'

export class BrowserPlatformService {
  private readonly leases = new UnifiedBrowserTabLeaseStore()
  private readonly accessTokens = new BrowserAccessTokenStore()
  private readonly credentials: BrowserCredentialVault
  private readonly extensions: BrowserExtensionManager
  private readonly policy: BrowserPolicyService
  private readonly router: BrowserTargetRouter
  private onChanged: ((state: BrowserPlatformState) => void) | undefined
  private closed = false

  constructor(
    private readonly browser: BrowserController,
    private readonly companion: BrowserCompanionService,
    organizationStore: OrganizationStore,
    dataPath: string,
  ) {
    this.credentials = new BrowserCredentialVault(join(dataPath, 'browser-credentials.json'))
    this.extensions = new BrowserExtensionManager(
      browser.browserSession(),
      join(dataPath, 'browser-extensions.json'),
      () => { void this.emit() },
    )
    this.policy = new BrowserPolicyService(organizationStore, join(dataPath, 'browser-action-receipts.json'))
    this.router = new BrowserTargetRouter(
      browser,
      companion,
      this.leases,
      this.policy,
      this.credentials,
      this.accessTokens,
    )
    this.policy.setOnChanged(() => { void this.emit() })
    this.router.setOnChanged(() => { void this.emit() })
    this.browser.setTabClosedListener((tabId) => {
      this.leases.releaseTab(BUILTIN_BROWSER_TARGET_ID, tabId)
      void this.emit()
    })
  }

  async initialize(): Promise<void> {
    await this.extensions.initialize()
    this.companion.setAgentDispatcher((method, params) => this.router.call(method, params, 'agent'))
    await this.emit()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.companion.setAgentDispatcher(undefined)
    this.browser.setTabClosedListener(undefined)
    this.policy.setOnChanged(undefined)
    this.router.setOnChanged(undefined)
    this.accessTokens.clear()
  }

  setListener(listener: ((state: BrowserPlatformState) => void) | undefined): void {
    this.onChanged = listener
    if (listener) void this.state().then(listener).catch(() => undefined)
  }

  notifyBrowserChanged(): void {
    void this.emit()
  }

  async notifyCompanionChanged(): Promise<void> {
    const connected = new Set((await this.companion.connectedConnections()).map((item) => `companion:${item.id}`))
    for (const lease of this.leases.list()) {
      if (lease.targetId.startsWith('companion:') && !connected.has(lease.targetId)) this.leases.release(lease.id)
    }
    await this.emit()
  }

  issueSessionAccess(sessionId: string): string {
    return this.accessTokens.issue(sessionId)
  }

  revokeSessionAccess(sessionId: string): void {
    this.accessTokens.revokeSession(sessionId)
    this.leases.releaseOwner(sessionId)
    void this.emit()
  }

  async callAgent(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.router.call(method, params, 'agent')
  }

  async state(): Promise<BrowserPlatformState> {
    const [targets, tabs, credentials, receipts] = await Promise.all([
      this.router.targets(),
      this.router.tabs().catch(() => []),
      this.credentials.list(),
      this.policy.recentReceipts(),
    ])
    return {
      targets,
      tabs,
      selection: this.router.selection(),
      leases: this.leases.list(),
      downloads: this.browser.listDownloads(),
      extensions: this.extensions.list(),
      credentials,
      approvals: this.policy.approvals(),
      receipts,
    }
  }

  async select(selection: BrowserSelection): Promise<BrowserPlatformState> {
    await this.router.select(selection)
    await this.emit()
    return this.state()
  }

  async createTab(targetId?: string, url?: string): Promise<BrowserTabDescriptor> {
    const result = await this.router.call('browser.openTab', {
      ...(targetId ? { targetId } : {}),
      ...(url ? { url } : {}),
    }, 'renderer') as { tab?: BrowserTabDescriptor }
    await this.emit()
    if (!result?.tab) throw new Error('Browser target did not create a tab')
    return result.tab
  }

  async activateTab(targetId: string, tabId: string): Promise<BrowserTabDescriptor> {
    const result = await this.router.call('browser.activateTab', { targetId, tabId }, 'renderer') as BrowserTabDescriptor
    await this.emit()
    return result
  }

  async closeTab(targetId: string, tabId: string): Promise<boolean> {
    // A direct user close is authoritative: revoke any agent writer before
    // closing so an in-flight lane cannot keep ownership of a tab the user
    // explicitly removed.
    this.leases.releaseTab(targetId, tabId)
    const result = await this.router.call('browser.closeTab', {
      targetId,
      tabId,
      leaseId: this.manualLease(targetId, tabId),
    }, 'renderer')
    await this.emit()
    return result === true
  }

  async history(targetId?: string) {
    return this.router.call('browser.history', { ...(targetId ? { targetId } : {}) }, 'renderer')
  }

  async clearBrowserData(input: { targetId?: string; origin?: string; history?: boolean }): Promise<void> {
    const targetId = input.targetId ?? BUILTIN_BROWSER_TARGET_ID
    if (targetId !== BUILTIN_BROWSER_TARGET_ID) throw new Error('Browser-data clearing is available only for the ND built-in profile')
    await this.browser.clearBrowserData(input.origin, input.history !== false)
    await this.emit()
  }

  cancelDownload(downloadId: string): boolean {
    const canceled = this.browser.cancelDownload(downloadId)
    if (canceled) void this.emit()
    return canceled
  }

  async installExtension(path: string): Promise<BrowserExtensionRecord> {
    const record = await this.extensions.install(path)
    await this.emit()
    return record
  }

  async setExtensionEnabled(extensionId: string, enabled: boolean): Promise<BrowserExtensionRecord[]> {
    const records = await this.extensions.setEnabled(extensionId, enabled)
    await this.emit()
    return records
  }

  async removeExtension(extensionId: string): Promise<BrowserExtensionRecord[]> {
    const records = await this.extensions.remove(extensionId)
    await this.emit()
    return records
  }

  async saveCredential(input: { origin: string; username: string; password: string; label?: string }): Promise<BrowserCredentialSummary> {
    const summary = await this.credentials.save(input)
    await this.emit()
    return summary
  }

  async removeCredential(credentialId: string): Promise<boolean> {
    const removed = await this.credentials.remove(credentialId)
    if (removed) await this.emit()
    return removed
  }

  resolveApproval(approvalId: string, allowed: boolean): boolean {
    const resolved = this.policy.resolveApproval(approvalId, allowed)
    if (resolved) void this.emit()
    return resolved
  }

  private manualLease(targetId: string, tabId: string): string {
    const target = this.leases.list().find((lease) =>
      lease.targetId === targetId && lease.tabId === tabId && lease.ownerId === 'renderer')
    if (target) return target.id

    const profileId = targetId === BUILTIN_BROWSER_TARGET_ID
      ? this.browser.profileId()
      : `companion-profile:${targetId.replace(/^companion:/, '')}`
    return this.leases.acquire({
      ownerId: 'renderer',
      targetId,
      profileId,
      tabId,
    }).id
  }

  private async emit(): Promise<void> {
    if (this.closed || !this.onChanged) return
    this.onChanged(await this.state())
  }
}
