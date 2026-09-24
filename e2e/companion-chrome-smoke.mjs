#!/usr/bin/env node
// Real-Chrome Browser Companion smoke driver (docs/tasks/wip-0019-browser-companion-mvp.md).
//
// The counterpart of e2e/real-user-prod.mjs for the companion target. It runs
// the real Chrome binary with the unpacked extensions/browser-companion
// extension, registers the native host under that Chrome profile's real
// extension id, grants one test origin through the extension's own side-panel
// button (a real user gesture, so no permission is pre-seeded), and then starts
// the built ND app with ND_DSH_COMPANION_SMOKE_OUTPUT so the in-app harness
// (src/main/perf/companion-chrome-smoke.ts) can drive the token-guarded agent
// path against that live connection. The harness writes the step-by-step
// evidence; this driver prints it and owns every process it started.
//
// Requires: `corepack pnpm build` output, `corepack pnpm browser:host:build`,
// and a real Google Chrome install (ND_DSH_CHROME_BINARY overrides the path).
// Chrome 137+ removed --load-extension, so the extension is loaded through the
// CDP Extensions.loadUnpacked command the browser exposes for automation.
import { chromium, _electron as electron } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extensionPath = join(root, 'extensions', 'browser-companion')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const resultsRoot = resolve(process.env.ND_DSH_COMPANION_SMOKE_RESULTS ?? join(root, 'e2e-results', `companion-chrome-${stamp}`))
const evidencePath = join(resultsRoot, 'companion-chrome-smoke.json')
const chromePath = process.env.ND_DSH_CHROME_BINARY?.trim() || defaultChromePath()
const appUserData = mkdtempSync(join(tmpdir(), 'nd-dsh-companion-smoke-app-'))
const chromeUserData = mkdtempSync(join(tmpdir(), 'nd-dsh-companion-smoke-chrome-'))
const server = createServer(serveFixture)
let chromeChild
let browser
let app
let extensionId

try {
  await fs.mkdir(resultsRoot, { recursive: true })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  const ungrantedUrl = `http://localhost:${address.port}/ungranted`
  console.log(`fixture origin: ${origin}`)

  chromeChild = spawn(chromePath, [
    `--user-data-dir=${chromeUserData}`,
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    `${origin}/actions`,
  ], { stdio: 'ignore', windowsHide: false })

  const port = await waitForDevToolsPort(chromeUserData)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  // Every browser interaction must be bounded: Playwright's library defaults
  // can wait forever on a background tab's actionability checks.
  browser.contexts()[0]?.setDefaultTimeout(15_000)
  const cdp = await browser.newBrowserCDPSession()
  const loaded = await withTimeout(cdp.send('Extensions.loadUnpacked', { path: extensionPath }), 20_000, 'Extensions.loadUnpacked')
  extensionId = loaded.id
  console.log(`extension loaded: ${extensionId}`)

  await run('node', [join(root, 'scripts', 'register-browser-native-host.mjs'), `--extension-id=${extensionId}`])
  console.log('native host registered')

  const context = browser.contexts()[0]
  await waitForPage(context, (url) => url.endsWith('/actions'))
  console.log('fixture tab present')
  await withTimeout(openBackgroundTab(cdp, `chrome-extension://${extensionId}/sidepanel.html`), 20_000, 'side panel tab')
  const sidepanel = await waitForPage(context, (url) => url.includes('sidepanel.html'))
  console.log('side panel ready')
  const fixturePage = context.pages().find((page) => page.url().endsWith('/actions'))
  if (!fixturePage) throw new Error('the fixture tab disappeared before the permission grant')
  // The panel must stay a background tab so the fixture page remains the
  // window's active http(s) origin — that is the origin the panel grants.
  await fixturePage.bringToFront()
  await delay(1_000)
  const grant = await grantSiteAccess(sidepanel, `${origin}/*`)
  console.log(grant.granted
    ? `site access granted through ${grant.via}`
    : 'site access was NOT granted — the action steps will record the real failure')
  // Chrome answers an optional-host-permission request with a native dialog a
  // human answers, and the grant lands only when that happens. Wait for the
  // granted state (however it arrives) before starting the app: starting the
  // harness first would race the dialog and record the real site-access
  // failure for every page step.
  if (!grant.granted) {
    const grantTimeout = Number(process.env.ND_DSH_COMPANION_SMOKE_GRANT_TIMEOUT_MS ?? 120_000)
    console.log(`waiting up to ${Math.round(grantTimeout / 1000)}s for the Chrome permission dialog to be answered…`)
    const grantedLate = await waitForGrant(sidepanel, `${origin}/*`, grantTimeout)
    console.log(grantedLate ? 'site access granted (dialog answered)' : 'site access still not granted')
  }
  await openBackgroundTab(cdp, ungrantedUrl)
  console.log(`ungranted-origin tab open: ${ungrantedUrl}`)
  // Clicking the panel makes it the active tab; hand the active-tab role back
  // to the fixture page so the smoke starts from the state the browser is in
  // when a user hands a page to ND.
  await fixturePage.bringToFront()
  await delay(1_000)
  // Prime genuine session history with real input: Chrome records only
  // user-initiated navigations, so an agent's own actions can never create a
  // history entry to go back to. The harness then drives browser.forward and
  // browser.back over this entry.
  await fixturePage.click('a')
  await fixturePage.waitForURL('**/second', { timeout: 10_000 })
  await fixturePage.goBack({ timeout: 10_000, waitUntil: 'domcontentloaded' })
  console.log('fixture history primed: a forward entry is available for the back/forward check')

  app = await electron.launch({
    args: ['.', `--user-data-dir=${appUserData}`],
    env: {
      ...process.env,
      ND_DSH_COMPANION_SMOKE_OUTPUT: evidencePath,
      ND_DSH_COMPANION_SMOKE_CONNECT_TIMEOUT_MS: process.env.ND_DSH_COMPANION_SMOKE_CONNECT_TIMEOUT_MS ?? '120000',
    },
  })
  app.process().stdout?.setEncoding('utf8')
  app.process().stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  app.process().stderr?.setEncoding('utf8')
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[app] ${chunk}`))

  const result = await waitForEvidence(evidencePath, Number(process.env.ND_DSH_COMPANION_SMOKE_DRIVER_TIMEOUT_MS ?? 420_000))
  printSummary(result, extensionId, origin)
  process.exitCode = result.status === 'pass' && result.steps.every((step) => step.status !== 'fail') ? 0 : 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  // Bounded teardown: the app quits itself when the harness finishes, so
  // Playwright's own close handshake can wait on a process that is already
  // gone. Nothing in cleanup may block the driver from reporting.
  await settle(app?.close(), 8_000)
  await run('taskkill', ['/IM', 'nd-browser-host.exe', '/F'], { allowFailure: true })
  await settle(browser?.close(), 8_000)
  if (chromeChild && chromeChild.exitCode === null) chromeChild.kill()
  server.closeAllConnections?.()
  await settle(new Promise((resolvePromise) => server.close(() => resolvePromise())), 3_000)
  console.log(`evidence: ${evidencePath}`)
}

function settle(promise, timeoutMs) {
  if (!promise) return Promise.resolve()
  return Promise.race([
    promise.catch(() => undefined),
    new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs)),
  ])
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)),
  ])
}

function defaultChromePath() {
  if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return 'google-chrome'
}

async function waitForDevToolsPort(userDataDir) {
  const portFile = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (port) return port
    }
    await delay(250)
  }
  throw new Error('Chrome did not publish a DevTools port')
}

function waitForPage(context, match) {
  const deadline = Date.now() + 20_000
  return (async () => {
    while (Date.now() < deadline) {
      const page = context.pages().find((candidate) => match(candidate.url()))
      if (page) return page
      await delay(200)
    }
    throw new Error('expected Chrome page never appeared')
  })()
}

async function openBackgroundTab(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url, background: true })
  return targetId
}
/**
 * The side panel is the product's real grant surface: its button runs
 * chrome.permissions.request for the window's active http(s) origin. Chrome
 * can refuse a request made from a background tab, and while a permission
 * bubble is unanswered the request promise stays pending forever, so every
 * path here is bounded and the outcome is decided by chrome.permissions
 * .contains rather than by the request promise.
 */
async function grantSiteAccess(sidepanel, originPattern) {
  // 'Grant this site before an agent can inspect or act on it' is the panel's
  // own enabled-state copy: it appears only once activeOrigin is the fixture.
  await sidepanel.waitForFunction(
    () => (document.querySelector('#permissionText')?.textContent ?? '').startsWith('Grant this site'),
    undefined,
    { timeout: 20_000 },
  )
  try {
    await sidepanel.click('#allowSite', { timeout: 8_000 })
  } catch (error) {
    console.log(`grant: panel click did not land (${error instanceof Error ? error.message.split('\n')[0] : String(error)})`)
  }
  if (await waitForGrant(sidepanel, originPattern, 6_000)) return { granted: true, via: 'the side-panel button' }
  // Same button, same handler, but triggered with an explicit CDP gesture so
  // the click lands even though the panel is a background tab.
  const client = await sidepanel.context().newCDPSession(sidepanel)
  try {
    await withTimeout(client.send('Runtime.evaluate', {
      expression: "document.querySelector('#allowSite').click()",
      userGesture: true,
    }), 10_000, 'panel button trigger')
  } catch (error) {
    console.log(`grant: CDP button trigger failed (${error instanceof Error ? error.message : String(error)})`)
  }
  if (await waitForGrant(sidepanel, originPattern, 6_000)) {
    return { granted: true, via: 'the side-panel button triggered with a CDP user gesture' }
  }
  // Last resort: the same permission API the button calls, for the same origin.
  try {
    await withTimeout(client.send('Runtime.evaluate', {
      expression: `void chrome.permissions.request({ origins: ['${originPattern}'] })`,
      userGesture: true,
    }), 10_000, 'permissions request')
  } catch (error) {
    console.log(`grant: direct permissions request failed (${error instanceof Error ? error.message : String(error)})`)
  }
  if (await waitForGrant(sidepanel, originPattern, 6_000)) {
    return { granted: true, via: 'a direct chrome.permissions.request' }
  }
  const state = await sidepanel.evaluate(() => ({
    text: document.querySelector('#permissionText')?.textContent ?? '',
    disabled: document.querySelector('#allowSite')?.disabled ?? true,
  })).catch(() => null)
  console.log(`grant: panel state after attempts: ${JSON.stringify(state)}`)
  return { granted: false, via: 'no path' }
}

async function waitForGrant(sidepanel, originPattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const granted = await sidepanel
      .evaluate((pattern) => chrome.permissions.contains({ origins: [pattern] }), originPattern)
      .catch(() => false)
    if (granted) return true
    await delay(250)
  }
  return false
}

async function waitForEvidence(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf8')
      try {
        const parsed = JSON.parse(raw)
        if (parsed?.status) return parsed
      } catch {
        // The harness writes once; a partial read means it is still writing.
      }
    }
    await delay(500)
  }
  throw new Error('the in-app companion smoke did not write evidence in time')
}

function printSummary(result, extId, origin) {
  console.log(`\ncompanion smoke: ${result.status} (extension ${extId}, origin ${origin})`)
  for (const step of result.steps) {
    const suffix = step.detail ? ` — ${step.detail}` : ''
    console.log(`  ${step.status === 'pass' ? 'PASS' : step.status === 'fail' ? 'FAIL' : 'skip'} ${step.name} (${step.ms}ms)${suffix}`)
  }
}

function serveFixture(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(fixtureHtml(url.pathname))
}

function fixtureHtml(pathname) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ND Companion Smoke ${pathname}</title></head>
<body style="margin:0">
  <h1>ND Companion Smoke</h1>
  <p id="path">${pathname}</p>
  <button aria-label="Increment">Increment</button>
  <p id="counter">Clicked 0</p>
  <input aria-label="Name" placeholder="Name">
  <p id="echo">No input yet</p>
  <p id="keys">No key yet</p>
  <input type="password" aria-label="Password" value="fixture-secret">
  <a href="/second">Second page</a>
  <div style="height:3000px">tall page for scroll checks</div>
  <script>
    const counter = document.getElementById('counter');
    let clicks = 0;
    document.querySelector('button').addEventListener('click', () => {
      clicks += 1;
      counter.textContent = 'Clicked ' + clicks;
    });
    document.querySelector('input[aria-label="Name"]').addEventListener('input', (event) => {
      document.getElementById('echo').textContent = 'Typed ' + event.target.value;
    });
    document.querySelector('input[aria-label="Name"]').addEventListener('keydown', (event) => {
      document.getElementById('keys').textContent = 'Key ' + event.key;
    });
  </script>
</body>
</html>`
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', (error) => (options.allowFailure ? resolvePromise() : reject(error)))
    child.once('close', (code) => {
      if (code === 0 || options.allowFailure) return resolvePromise()
      reject(new Error(`${command} exited with code ${String(code)}: ${stderr.trim()}`))
    })
  })
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
