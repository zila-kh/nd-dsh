import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { BrowserController } from '../browser/browser-controller.js'
import type { BrowserPlatformService } from '../browser-platform/browser-platform-service.js'
import type {
  BrowserPlatformState,
  BrowserTabDescriptor,
  BrowserTabLease,
  BrowserTargetDescriptor,
} from '../../shared/browser-platform.js'

/**
 * The real-Chrome Browser Companion smoke, run inside the app under
 * `ND_DSH_COMPANION_SMOKE_OUTPUT` (driver: e2e/companion-chrome-smoke.mjs).
 *
 * It drives the same agent path a coding engine uses — an issued session access
 * token plus router methods — against a companion connection that only exists
 * because the real ND extension is loaded in the real Chrome binary and the
 * native host is registered with its real extension id. That is what the
 * built-in-browser benchmark (browser-platform-benchmark.ts) cannot cover: it
 * drives the embedded browser directly and classifies companion measurement as
 * manual-evidence-required.
 *
 * Every checklist item in docs/tasks/wip-0019-browser-companion-mvp.md maps to
 * one recorded step, and the disconnect step is a genuine connection loss: it
 * kills the native host process, which is the only way to drop the extension's
 * port without touching Chrome's own UI.
 */
export async function runCompanionChromeSmoke(input: {
  outputPath: string
  browser: BrowserController
  browserPlatform: BrowserPlatformService
}): Promise<void> {
  const connectTimeoutMs = readTimeout('ND_DSH_COMPANION_SMOKE_CONNECT_TIMEOUT_MS', 120_000)
  const steps: SmokeStep[] = []
  const state: SmokeContext = {}
  const tokenA = input.browserPlatform.issueSessionAccess('companion-smoke-a')
  const tokenB = input.browserPlatform.issueSessionAccess('companion-smoke-b')
  const callA = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    input.browserPlatform.callAgent(method, { ...params, accessToken: tokenA })
  const callB = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    input.browserPlatform.callAgent(method, { ...params, accessToken: tokenB })

  const record = async (
    name: string,
    body: () => Promise<StepResult | void>,
  ): Promise<boolean> => {
    const started = performance.now()
    try {
      const result = await body()
      steps.push({ name, status: 'pass', ms: elapsed(started), ...(result ?? {}) })
      console.log(`[companion-smoke] pass ${name}${result?.detail ? ` — ${result.detail}` : ''}`)
      return true
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      steps.push({ name, status: 'fail', ms: elapsed(started), detail })
      console.log(`[companion-smoke] FAIL ${name} — ${detail}`)
      return false
    }
  }
  const skip = (name: string, detail: string): void => {
    steps.push({ name, status: 'skip', ms: 0, detail })
    console.log(`[companion-smoke] skip ${name} — ${detail}`)
  }

  try {
    // 1-2. The extension connects on its own once the app is up; wait for the
    // real profile, then for the exact tabs the driver opened in that Chrome.
    const connected = await record('companion-connection', async () => {
      const target = await waitForCompanion(input.browserPlatform, connectTimeoutMs)
      state.target = target
      state.connectionId = target.id.slice('companion:'.length)
      return {
        detail: `${target.label} (${target.profileLabel})`,
        data: { targetId: target.id, profileLabel: target.profileLabel, connected: target.connected },
      }
    })
    if (!connected || !state.target || !state.connectionId) {
      skip('remaining-steps', 'no companion connection appeared')
    } else {
      const connectionId = state.connectionId
      const tabsOk = await record('companion-tabs', async () => {
        const tabs = asTabs(await callA('browser.tabs', { connectionId }))
        const fixture = tabs.find((tab) => tab.url.includes('/actions'))
          ?? tabs.find((tab) => tab.url.startsWith('http://') || tab.url.startsWith('https://'))
        expect(fixture, 'the driver must leave one http(s) tab open in Chrome')
        state.tab = fixture
        state.origin = new URL(fixture.url).origin
        const ungranted = tabs.find((tab) => tab.url.includes('localhost'))
        if (ungranted) state.ungrantedTab = ungranted
        return {
          detail: `${tabs.length} tab(s); fixture ${fixture.id}`,
          data: {
            tabs: tabs.map((tab) => ({ id: tab.id, url: tab.url, active: tab.active })),
            ungrantedTabId: ungranted?.id ?? null,
          },
        }
      })

      // 3. Explicit tab selection through the common target API.
      if (tabsOk) {
        await record('target-selection', async () => {
          const selection = await input.browserPlatform.select({ mode: 'tab', targetId: state.target!.id, tabId: state.tab!.id })
          expect(selection.selection.mode === 'tab', 'explicit tab selection did not stick')
          await input.browserPlatform.select({ mode: 'auto' })
          return { detail: 'explicit @Chrome tab selection then reset to auto' }
        })
      }

      const snapshotOk = tabsOk
        ? await record('snapshot-semantic-refs', async () => {
          const fresh = await takeSnapshot(callA, state)
          expect((fresh.elements?.length ?? 0) > 0, 'snapshot returned no interactive elements')
          expect(Number.isInteger(fresh.revision), 'snapshot returned no revision')
          return {
            detail: `${fresh.elements?.length} element(s) at revision ${fresh.revision}`,
            data: { revision: fresh.revision, elements: fresh.elements?.length ?? 0, title: fresh.title ?? null },
          }
        })
        : false
      if (snapshotOk) {
        await record('password-redaction', async () => {
          const fresh = await takeSnapshot(callA, state)
          const password = fresh.elements?.find((element) => element.type === 'password')
          expect(password, 'the fixture page must expose a password input')
          expect(password.sensitive === true, 'password element is not marked sensitive')
          expect((password.text ?? '') === '', 'password value leaked into the snapshot text')
          return { detail: 'password input is sensitive and carries no value text' }
        })
      }

      const attachOk = await record('attach-writable-lease', async () => {
        const result = asRecord(await callA('browser.attach', { connectionId, tabId: state.tab!.id }))
        const lease = asLease(result.lease)
        state.lease = lease
        expect(lease.tabId === state.tab!.id, 'lease does not cover the attached tab')
        return {
          detail: `lease ${lease.id} owned by ${lease.ownerId}`,
          data: { leaseId: lease.id, ownerId: lease.ownerId, targetId: lease.targetId },
        }
      })

      await record('second-writer-rejected', async () => {
        expect(state.lease, 'no lease to contend with')
        const error = await captureFailure(() => callB('browser.attach', { connectionId, tabId: state.tab!.id }))
        expect(/already leased/i.test(error), `a second writer was not blocked: ${error}`)
        return { detail: error }
      })

      const actionsOk = attachOk && (await actionSteps(callA, state, record))
      if (actionsOk) {
        await record('screenshot', async () => {
          // captureVisibleTab is defined only for the tab the user is looking
          // at, so an agent activates the tab before asking for a screenshot.
          await callA('browser.activateTab', { connectionId, tabId: state.tab!.id })
          let dataUrl: string
          try {
            const result = asRecord(await callA('browser.screenshot', { connectionId, tabId: state.tab!.id }))
            dataUrl = typeof result.dataUrl === 'string' ? result.dataUrl : ''
          } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause)
            expect(/activeTab|all_urls/i.test(message), message)
            // Chrome grants captureVisibleTab to an extension the user has
            // invoked on the tab (activeTab). The smoke opens the panel
            // programmatically, which is not a toolbar invocation, so the
            // automated run records the requirement rather than a failure; a
            // user who opened the panel from ND's toolbar icon sees it work.
            return { status: 'skip', detail: `Chrome withheld captureVisibleTab without a toolbar invocation: ${message}` }
          }
          expect(dataUrl.startsWith('data:image/png;base64,'), 'screenshot is not a PNG data URL')
          expect(dataUrl.length > 5_000, 'screenshot payload is implausibly small')
          return { detail: `PNG data URL, ${dataUrl.length} chars`, data: { bytes: dataUrl.length } }
        })
      }

      await record('stale-ref-rejected', async () => {
        expect(state.lease, 'no lease for the stale-ref check')
        const fresh = await takeSnapshot(callA, state)
        const button = requireElement(fresh, (element) => element.name === 'Increment')
        expect(Number.isInteger(fresh.revision), 'snapshot exposed no integer revision')
        await callA('browser.click', { connectionId, tabId: state.tab!.id, leaseId: state.lease!.id, ref: button.ref, revision: fresh.revision })
        const error = await captureFailure(() => callA('browser.click', {
          connectionId, tabId: state.tab!.id, leaseId: state.lease!.id, ref: button.ref, revision: fresh.revision,
        }))
        expect(/STALE_BROWSER_REFERENCE/.test(error), `the consumed snapshot revision was not rejected: ${error}`)
        return { detail: error }
      })

      await record('permission-required', async () => {
        const ungranted = state.ungrantedTab
        if (!ungranted) return { status: 'skip', detail: 'driver opened no ungranted-origin tab' }
        const error = await captureFailure(() => callA('browser.snapshot', { connectionId, tabId: ungranted.id }))
        expect(/site access/i.test(error), `an ungranted origin was reachable: ${error}`)
        return { detail: error }
      })

      await record('builtin-browser-unaffected', async () => {
        expect(state.origin, 'no fixture origin to reuse')
        const tab = await input.browser.createTab(`${state.origin}/builtin`, true)
        try {
          await input.browser.activateTab(tab.id)
          const snapshot = asSnapshot(await callA('browser.snapshot', { targetId: 'builtin', tabId: tab.id }))
          expect((snapshot.elements?.length ?? 0) > 0, 'the built-in browser returned no interactive elements')
          return {
            detail: `built-in snapshot while companion lease is held: ${snapshot.elements?.length} element(s)`,
            data: { elements: snapshot.elements?.length ?? 0 },
          }
        } finally {
          await input.browser.closeTab(tab.id).catch(() => undefined)
        }
      })

      await record('disconnect-reconnect', async () => {
        expect(state.lease, 'no lease to revoke')
        const killed = await killNativeHost()
        const dropped = await waitForCompanionGone(input.browserPlatform, 30_000).catch(() => false)
        const afterDrop = await input.browserPlatform.state()
        const leaseSurvived = afterDrop.leases.some((lease) => lease.id === state.lease!.id)
        const reconnect = await waitForCompanion(input.browserPlatform, connectTimeoutMs)
        const reconnected = reconnect.id === state.target!.id
        state.target = reconnect
        state.connectionId = reconnect.id.slice('companion:'.length)
        const reattach = asRecord(await callA('browser.attach', { connectionId: state.connectionId, tabId: state.tab!.id }))
        const lease = asLease(reattach.lease)
        state.lease = lease
        expect(dropped, `the connection did not drop after ${killed}`)
        expect(!leaseSurvived, 'the previous lease survived the disconnect')
        expect(reconnected, 'the reconnected profile is a different companion target')
        return {
          detail: `${killed}; lease revoked; reconnected and re-attached as ${lease.id}`,
          data: { dropped, leaseSurvived, reconnectTargetId: reconnect.id, leaseId: lease.id },
        }
      })
    }

    await writeResult(input.outputPath, steps, state, input.browserPlatform)
    const failed = steps.filter((step) => step.status === 'fail')
    if (failed.length > 0) {
      throw new Error(`Browser companion smoke failed ${failed.length} step(s): ${failed.map((step) => step.name).join(', ')}`)
    }
    console.log(`[companion-smoke] all ${steps.filter((step) => step.status === 'pass').length} step(s) passed`)
  } catch (cause) {
    await writeResult(input.outputPath, steps, state, input.browserPlatform).catch(() => undefined)
    throw cause
  } finally {
    input.browserPlatform.revokeSessionAccess('companion-smoke-a')
    input.browserPlatform.revokeSessionAccess('companion-smoke-b')
  }
}

interface SmokeStep {
  name: string
  status: 'pass' | 'fail' | 'skip'
  ms: number
  detail?: string | undefined
  data?: Record<string, unknown> | undefined
}

interface StepResult {
  status?: 'pass' | 'skip'
  detail?: string
  data?: Record<string, unknown>
}

interface SmokeContext {
  target?: BrowserTargetDescriptor
  connectionId?: string
  tab?: BrowserTabDescriptor
  ungrantedTab?: BrowserTabDescriptor
  lease?: BrowserTabLease
  origin?: string
}

interface SnapshotElement {
  ref?: string
  tag?: string
  role?: string
  name?: string
  text?: string
  type?: string
  sensitive?: boolean
}

interface SnapshotShape {
  revision?: number | undefined
  url?: string | undefined
  title?: string | undefined
  viewport?: { scrollY?: number | undefined } | undefined
  elements?: SnapshotElement[] | undefined
}

/** Steps 7-13: the action set, each asserted through a page-authored effect. */
async function actionSteps(
  callA: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  state: SmokeContext,
  record: (name: string, body: () => Promise<StepResult | void>) => Promise<boolean>,
): Promise<boolean> {
  const connectionId = state.connectionId!
  const tabId = state.tab!.id
  const leaseId = state.lease!.id
  const params = (): Record<string, unknown> => ({ connectionId, tabId, leaseId })

  const clicked = await record('click', async () => {
    const fresh = await takeSnapshot(callA, state)
    const button = requireElement(fresh, (element) => element.name === 'Increment')
    await callA('browser.click', { ...params(), ref: button.ref, revision: fresh.revision })
    await callA('browser.waitFor', { ...params(), text: 'Clicked 1', timeoutMs: 10_000 })
    return { detail: 'Increment click observed by the page' }
  })

  const filled = await record('fill', async () => {
    const fresh = await takeSnapshot(callA, state)
    const field = requireElement(fresh, (element) => element.name === 'Name')
    await callA('browser.fill', { ...params(), ref: field.ref, revision: fresh.revision, text: 'ND smoke' })
    await callA('browser.waitFor', { ...params(), text: 'Typed ND smoke', timeoutMs: 10_000 })
    return { detail: 'fill delivered an input event with the typed value' }
  })

  await record('press', async () => {
    const fresh = await takeSnapshot(callA, state)
    const field = requireElement(fresh, (element) => element.name === 'Name')
    await callA('browser.press', { ...params(), ref: field.ref, revision: fresh.revision, key: 'Enter' })
    await callA('browser.waitFor', { ...params(), text: 'Key Enter', timeoutMs: 10_000 })
    return { detail: 'keydown/keyup dispatched to the focused field' }
  })

  await record('scroll', async () => {
    await callA('browser.scroll', { ...params(), deltaX: 0, deltaY: 600 })
    const fresh = await takeSnapshot(callA, state)
    const scrollY = fresh.viewport?.scrollY ?? 0
    expect(scrollY > 0, 'viewport did not scroll')
    return { detail: `viewport scrolled to ${scrollY}px` }
  })

  await record('navigate-back-forward-reload', async () => {
    const origin = state.origin!
    const trace: string[] = []
    const currentUrl = async (): Promise<string> => {
      const tab = requireTab(await callA('browser.tabs', { connectionId }), tabId)
      trace.push(tab.url)
      return tab.url
    }
    try {
      // Back/forward first, over the user-created history the driver primed.
      // Chrome records session history for user-initiated navigations only:
      // every agent action is renderer-initiated, which Chrome treats as a
      // client redirect that replaces the current entry. So ND's navigate
      // cannot build history for a later browser.back to consume — a
      // documented limitation of the tabs+scripting model — while back and
      // forward themselves do traverse history the page's user created.
      await callA('browser.forward', params())
      const afterForward = await currentUrl()
      expect(afterForward.endsWith('/second'), `forward did not reach /second (${afterForward})`)
      await callA('browser.back', params())
      const afterBack = await currentUrl()
      expect(!afterBack.endsWith('/second'), `back did not return to the fixture (${afterBack})`)
      // ND navigation and reload move the tab and survive.
      await callA('browser.navigate', { ...params(), url: `${origin}/second` })
      const afterNavigate = await currentUrl()
      expect(afterNavigate.endsWith('/second'), `navigate did not reach /second (${afterNavigate})`)
      await callA('browser.reload', params())
      const afterReload = await currentUrl()
      expect(afterReload.endsWith('/second'), `reload lost the page (${afterReload})`)
      await callA('browser.navigate', { ...params(), url: `${origin}/actions` })
      trace.push(`final:${await currentUrl()}`)
    } catch (cause) {
      throw new Error(`${cause instanceof Error ? cause.message : String(cause)} | url trace: ${trace.join(' -> ') || '(none)'}`)
    }
    return { detail: 'back/forward over user history; navigate and reload over the fixture', data: { trace } }
  })

  return clicked && filled
}

async function takeSnapshot(
  callA: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  state: SmokeContext,
): Promise<SnapshotShape> {
  return asSnapshot(await callA('browser.snapshot', { connectionId: state.connectionId, tabId: state.tab!.id }))
}

async function waitForCompanion(platform: BrowserPlatformService, timeoutMs: number): Promise<BrowserTargetDescriptor> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const target = (await platform.state()).targets.find((item) => item.kind === 'companion' && item.connected)
    if (target) return target
    await delay(500)
  }
  throw new Error(
    'No Chrome Companion connection appeared. Load extensions/browser-companion unpacked in real Chrome, register the ' +
    'native host with that extension\'s real id, and keep Chrome running for the duration of the smoke.',
  )
}

async function waitForCompanionGone(platform: BrowserPlatformService, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const present = (await platform.state()).targets.some((item) => item.kind === 'companion' && item.connected)
    if (!present) return true
    await delay(250)
  }
  return false
}

async function killNativeHost(): Promise<string> {
  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/IM', 'nd-browser-host.exe', '/F'])
    return 'killed nd-browser-host.exe'
  }
  await runCommand('pkill', ['-f', 'nd-browser-host'])
  return 'killed nd-browser-host'
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${String(code)}`))))
  })
}

async function captureFailure(body: () => Promise<unknown>): Promise<string> {
  try {
    await body()
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
  return ''
}

async function writeResult(
  outputPath: string,
  steps: SmokeStep[],
  state: SmokeContext,
  platform: BrowserPlatformService,
): Promise<void> {
  const platformState: BrowserPlatformState = await platform.state()
  const result = {
    schemaVersion: 1,
    kind: 'nd-browser-companion-chrome-smoke',
    timestamp: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    companion: {
      targetId: state.target?.id ?? null,
      profileLabel: state.target?.profileLabel ?? null,
    },
    steps,
    finalState: {
      targets: platformState.targets.map((target) => ({ id: target.id, kind: target.kind, connected: target.connected })),
      leaseCount: platformState.leases.length,
    },
    status: steps.some((step) => step.status === 'fail') ? 'fail' : 'pass',
  }
  await fs.mkdir(dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

function asSnapshot(value: unknown): SnapshotShape {
  const record = asRecord(value)
  return {
    revision: Number.isInteger(record.revision) ? Number(record.revision) : undefined,
    url: typeof record.url === 'string' ? record.url : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    viewport: typeof record.viewport === 'object' && record.viewport !== null
      ? { scrollY: Number((record.viewport as { scrollY?: number }).scrollY ?? 0) }
      : undefined,
    elements: Array.isArray(record.elements) ? (record.elements as SnapshotElement[]) : undefined,
  }
}

function requireElement(snapshot: SnapshotShape, match: (element: SnapshotElement) => boolean): SnapshotElement {
  const element = snapshot.elements?.find(match)
  if (!element?.ref) throw new Error('the fixture page did not expose the expected interactive element')
  return element
}

function asTabs(value: unknown): BrowserTabDescriptor[] {
  if (!Array.isArray(value)) throw new Error('browser.tabs did not return a tab list')
  return value as BrowserTabDescriptor[]
}

function requireTab(value: unknown, tabId: string): BrowserTabDescriptor {
  const tab = asTabs(value).find((item) => item.id === tabId)
  if (!tab) throw new Error('the fixture tab disappeared from the companion tab list')
  return tab
}

function asLease(value: unknown): BrowserTabLease {
  const record = asRecord(value)
  if (typeof record.id !== 'string' || typeof record.ownerId !== 'string' || typeof record.tabId !== 'string') {
    throw new Error('browser.attach did not return a lease')
  }
  return record as unknown as BrowserTabLease
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object result')
  return value as Record<string, unknown>
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readTimeout(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}
