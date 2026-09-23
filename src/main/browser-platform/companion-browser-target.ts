import type { BrowserCompanionConnection, BrowserCompanionTab } from '../../shared/browser-companion.js'
import type { BrowserTabDescriptor, BrowserTargetDescriptor } from '../../shared/browser-platform.js'
import type { BrowserCompanionService } from '../browser-companion/browser-companion-service.js'
import type { BrowserTarget } from './browser-target.js'

export function companionTargetId(connectionId: string): string {
  return `companion:${connectionId}`
}

export function companionProfileId(connectionId: string): string {
  return `companion-profile:${connectionId}`
}

export class CompanionBrowserTarget implements BrowserTarget {
  constructor(
    private readonly service: BrowserCompanionService,
    private readonly connection: BrowserCompanionConnection,
  ) {}

  descriptor(): BrowserTargetDescriptor {
    return {
      id: companionTargetId(this.connection.id),
      kind: 'companion',
      label: this.connection.profileLabel,
      profileId: companionProfileId(this.connection.id),
      profileLabel: this.connection.profileLabel,
      connected: this.connection.connected,
      visible: false,
      capabilities: {
        tabs: true,
        semanticDom: true,
        screenshots: true,
        downloads: false,
        uploads: false,
        history: false,
        credentials: false,
        extensions: false,
        siteTools: false,
        backgroundControl: true,
      },
    }
  }

  async listTabs(): Promise<BrowserTabDescriptor[]> {
    const tabs = await this.service.command(this.connection.id, 'tabs.list', {}) as BrowserCompanionTab[]
    return tabs.map((tab) => this.mapTab(tab))
  }

  async openTab(url = 'about:blank'): Promise<BrowserTabDescriptor> {
    const tab = await this.service.command(this.connection.id, 'tabs.create', { url, active: true }) as BrowserCompanionTab
    return this.mapTab(tab)
  }

  async activateTab(tabId: string): Promise<BrowserTabDescriptor> {
    const tab = await this.service.command(this.connection.id, 'tabs.activate', { tabId: nativeTabId(tabId) }) as BrowserCompanionTab
    return this.mapTab(tab)
  }

  async closeTab(tabId: string): Promise<boolean> {
    await this.service.command(this.connection.id, 'tabs.close', { tabId: nativeTabId(tabId) })
    return true
  }

  async snapshot(tabId: string): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.snapshot', { tabId: nativeTabId(tabId) })
  }

  async navigate(tabId: string, url: string): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.navigate', { tabId: nativeTabId(tabId), url })
  }

  async click(tabId: string, ref: string, revision: number): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.click', { tabId: nativeTabId(tabId), ref, revision })
  }

  async fill(tabId: string, ref: string, revision: number, text: string): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.fill', { tabId: nativeTabId(tabId), ref, revision, text })
  }

  async press(tabId: string, ref: string, revision: number, key: string): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.press', { tabId: nativeTabId(tabId), ref, revision, key })
  }

  async scroll(tabId: string, deltaX: number, deltaY: number): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.scroll', { tabId: nativeTabId(tabId), deltaX, deltaY })
  }

  async waitFor(tabId: string, input: { text?: string; urlIncludes?: string; timeoutMs?: number }): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.waitFor', { tabId: nativeTabId(tabId), ...input })
  }

  async screenshot(tabId: string): Promise<unknown> {
    return this.service.command(this.connection.id, 'page.screenshot', { tabId: nativeTabId(tabId) })
  }

  async discoverSiteTools(): Promise<[]> {
    return []
  }

  async callSiteTool(): Promise<never> {
    throw new Error('WebMCP site tools are currently exposed only by the ND built-in browser target')
  }

  private mapTab(tab: BrowserCompanionTab): BrowserTabDescriptor {
    const id = String(tab.id)
    return {
      id,
      nativeTabId: tab.id,
      targetId: companionTargetId(this.connection.id),
      profileId: companionProfileId(this.connection.id),
      title: tab.title,
      url: tab.url,
      ...(origin(tab.url) ? { origin: origin(tab.url) } : {}),
      active: tab.active,
      visible: tab.active,
    }
  }
}

function nativeTabId(value: string): number {
  const tabId = Number(value)
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Companion tab id is invalid')
  return tabId
}

function origin(value: string): string | undefined {
  try {
    const parsed = new URL(value)
    return parsed.origin === 'null' ? undefined : parsed.origin
  } catch {
    return undefined
  }
}
