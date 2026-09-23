import type {
  BrowserSiteToolDescriptor,
  BrowserTabDescriptor,
  BrowserTargetDescriptor,
} from '../../shared/browser-platform.js'

export interface BrowserTarget {
  descriptor(): Promise<BrowserTargetDescriptor> | BrowserTargetDescriptor
  listTabs(): Promise<BrowserTabDescriptor[]>
  openTab(url?: string): Promise<BrowserTabDescriptor>
  activateTab(tabId: string): Promise<BrowserTabDescriptor>
  closeTab(tabId: string): Promise<boolean>
  snapshot(tabId: string): Promise<unknown>
  navigate(tabId: string, url: string): Promise<unknown>
  click(tabId: string, ref: string, revision: number): Promise<unknown>
  fill(tabId: string, ref: string, revision: number, text: string): Promise<unknown>
  press(tabId: string, ref: string, revision: number, key: string): Promise<unknown>
  scroll(tabId: string, deltaX: number, deltaY: number): Promise<unknown>
  waitFor(tabId: string, input: { text?: string; urlIncludes?: string; timeoutMs?: number }): Promise<unknown>
  screenshot(tabId: string): Promise<unknown>
  discoverSiteTools(tabId: string): Promise<BrowserSiteToolDescriptor[]>
  callSiteTool(tabId: string, name: string, input: unknown): Promise<unknown>
}
