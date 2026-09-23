import { app, BrowserWindow, WebContentsView, safeStorage, session } from 'electron'
import { createServer } from 'node:http'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'

const output = process.argv[2]
if (!output) throw new Error('output path is required')

const root = process.cwd()
const userData = await mkdtemp(join(tmpdir(), 'nd-dsh-browser-runtime-spike-'))
app.setPath('userData', userData)

const failures = []
const observations = []
const temporary = [userData]
const recordFailure = (label, cause) => failures.push({
  label,
  message: cause instanceof Error ? cause.message : String(cause),
})

await app.whenReady()

const server = await startFixtureServer()
const origin = `http://127.0.0.1:${server.address().port}`
const partition = 'persist:nd-dsh-browser-runtime-spike'
const browserSession = session.fromPartition(partition)
const window = new BrowserWindow({
  show: false,
  width: 1280,
  height: 800,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
  },
})
const views = []

try {
  const capabilities = {
    runtime: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
    },
    session: await probeSession(browserSession, origin),
    extensions: await probeExtensions(browserSession, origin, window),
    tabs: await probeTabs(browserSession, origin, window, views),
    webMcp: await probeWebMcp(browserSession, origin, window),
  }

  const coreBrowserPass = Boolean(
    capabilities.session.cookies
    && capabilities.session.history
    && capabilities.session.storageClear
    && capabilities.session.download,
  )
  const extensionBaselinePass = Boolean(
    capabilities.extensions.mv2?.contentScript
      && capabilities.extensions.mv2?.runtimeMessaging
    || capabilities.extensions.mv3?.contentScript
      && capabilities.extensions.mv3?.runtimeMessaging,
  )
  const multiTabPass = capabilities.tabs.points.every((point) => point.loaded === point.count)

  let decision = 'B-candidate'
  if (!coreBrowserPass || !extensionBaselinePass || !multiTabPass) decision = 'C-candidate'
  else if (capabilities.extensions.mv3?.runtimeMessaging && capabilities.webMcp.navigatorPresent) decision = 'A-candidate'

  const result = {
    schemaVersion: 1,
    kind: 'nd-builtin-browser-runtime-spike',
    timestamp: new Date().toISOString(),
    status: failures.length ? 'completed-with-probe-errors' : 'pass',
    decision,
    decisionMeaning: {
      'A-candidate': 'Electron satisfied this automated baseline, including the MV3/runtime and WebMCP presence probes. Manual representative-extension and credential UX review is still required.',
      'B-candidate': 'Electron satisfied the core browser baseline and at least one extension execution path, but compatibility breadth remains limited or unproven.',
      'C-candidate': 'Electron failed at least one required baseline; evaluate a different Chromium-grade built-in runtime before continuing.',
    }[decision],
    requirements: {
      coreBrowserPass,
      extensionBaselinePass,
      multiTabPass,
      credentialVaultPrimitiveAvailable: capabilities.runtime.safeStorageAvailable,
      webMcpNavigatorPresent: capabilities.webMcp.navigatorPresent,
    },
    capabilities,
    observations,
    failures,
  }

  await writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8')
} catch (cause) {
  recordFailure('fatal', cause)
  await writeFile(output, JSON.stringify({
    schemaVersion: 1,
    kind: 'nd-builtin-browser-runtime-spike',
    timestamp: new Date().toISOString(),
    status: 'failed',
    failures,
  }, null, 2) + '\n', 'utf8')
  process.exitCode = 1
} finally {
  for (const view of views) {
    try {
      window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {}
  }
  if (!window.isDestroyed()) window.destroy()
  await new Promise((resolvePromise) => server.close(resolvePromise))
  await Promise.allSettled(temporary.map((path) => rm(path, { recursive: true, force: true })))
  app.quit()
}

async function probeSession(ses, origin) {
  const result = {
    cookies: false,
    storageClear: false,
    history: false,
    download: false,
    details: {},
  }

  try {
    await ses.cookies.set({ url: origin, name: 'nd_spike_cookie', value: 'present' })
    result.cookies = (await ses.cookies.get({ url: origin, name: 'nd_spike_cookie' })).some((cookie) => cookie.value === 'present')
    await ses.clearStorageData({ origin, storages: ['cookies'] })
    result.storageClear = (await ses.cookies.get({ url: origin, name: 'nd_spike_cookie' })).length === 0
  } catch (cause) {
    recordFailure('session.cookies-storage-clear', cause)
  }

  const view = createView(ses, window)
  try {
    await view.webContents.loadURL(origin + '/history/a')
    await view.webContents.loadURL(origin + '/history/b')
    result.history = view.webContents.navigationHistory.canGoBack()
    result.details.historyEntries = view.webContents.navigationHistory.getAllEntries().map((entry) => entry.url)
  } catch (cause) {
    recordFailure('session.history', cause)
  } finally {
    destroyView(view, window)
  }

  const downloadPath = join(userData, 'runtime-spike-download.txt')
  try {
    const done = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('download timed out')), 15_000)
      ses.once('will-download', (_event, item) => {
        item.setSavePath(downloadPath)
        item.once('done', (_doneEvent, state) => {
          clearTimeout(timer)
          if (state === 'completed') resolvePromise(state)
          else reject(new Error('download state: ' + state))
        })
      })
    })
    window.webContents.downloadURL(origin + '/download')
    await done
    await access(downloadPath)
    result.download = (await readFile(downloadPath, 'utf8')) === 'nd-browser-runtime-spike\n'
  } catch (cause) {
    recordFailure('session.download', cause)
  }

  return result
}

async function probeExtensions(ses, origin, hostWindow) {
  const result = {
    mv2: await loadAndExerciseExtension('mv2', resolve(root, 'tests/fixtures/browser-runtime-spike/extensions/mv2-baseline'), ses, origin, hostWindow),
    mv3: await loadAndExerciseExtension('mv3', resolve(root, 'tests/fixtures/browser-runtime-spike/extensions/mv3-service-worker'), ses, origin, hostWindow),
  }
  result.loadedExtensionsAfterCleanup = ses.getAllExtensions().map((extension) => ({
    id: extension.id,
    name: extension.name,
    version: extension.version,
  }))
  return result
}

async function loadAndExerciseExtension(label, extensionPath, ses, origin, hostWindow) {
  const result = {
    loaded: false,
    id: null,
    manifestVersion: label === 'mv2' ? 2 : 3,
    contentScript: false,
    runtimeMessaging: false,
    removed: false,
    loadMs: null,
    error: null,
  }
  let extension
  try {
    const started = performance.now()
    extension = await ses.loadExtension(extensionPath, { allowFileAccess: false })
    result.loadMs = performance.now() - started
    result.loaded = true
    result.id = extension.id

    const view = createView(ses, hostWindow)
    try {
      await view.webContents.loadURL(origin + '/extension/' + label)
      await wait(500)
      const dataset = await view.webContents.executeJavaScript(`({
        content: document.documentElement.dataset.ndSpike${label === 'mv2' ? 'Mv2' : 'Mv3'}Content || '',
        runtime: document.documentElement.dataset.ndSpike${label === 'mv2' ? 'Mv2' : 'Mv3'}Runtime || ''
      })`)
      result.contentScript = dataset.content === 'ok'
      result.runtimeMessaging = dataset.runtime === 'ok'
    } finally {
      destroyView(view, hostWindow)
    }
  } catch (cause) {
    result.error = cause instanceof Error ? cause.message : String(cause)
    observations.push({ label: 'extension-' + label, outcome: 'unsupported-or-failed', detail: result.error })
  } finally {
    if (extension?.id) {
      try {
        ses.removeExtension(extension.id)
        result.removed = !ses.getAllExtensions().some((item) => item.id === extension.id)
      } catch (cause) {
        recordFailure('extension.' + label + '.remove', cause)
      }
    }
  }
  return result
}

async function probeTabs(ses, origin, hostWindow, retainedViews) {
  const points = []
  for (const count of [1, 2, 4, 8]) {
    while (retainedViews.length < count) {
      const view = createView(ses, hostWindow)
      retainedViews.push(view)
      await view.webContents.loadURL(origin + '/tab/' + retainedViews.length)
    }
    await wait(150)
    const metrics = app.getAppMetrics()
    const renderers = metrics.filter((item) => item.type === 'Tab' || item.type === 'Utility' || item.type === 'Other')
    points.push({
      count,
      loaded: retainedViews.slice(0, count).filter((view) => !view.webContents.isDestroyed() && view.webContents.getURL().startsWith(origin)).length,
      electronProcessCount: metrics.length,
      rendererLikeProcessCount: renderers.length,
      workingSetKiB: sumFinite(metrics.map((item) => item.memory?.workingSetSize)),
      privateBytesKiB: sumFinite(metrics.map((item) => item.memory?.privateBytes)),
    })
  }
  return { points }
}

async function probeWebMcp(ses, origin, hostWindow) {
  const view = createView(ses, hostWindow)
  try {
    await view.webContents.loadURL(origin + '/webmcp')
    const state = await view.webContents.executeJavaScript(`({
      navigatorPresent: 'modelContext' in navigator,
      type: typeof navigator.modelContext
    })`)
    return {
      navigatorPresent: state.navigatorPresent === true,
      type: state.type,
      note: state.navigatorPresent
        ? 'A WebMCP-like navigator surface is visible in the current Chromium runtime; protocol behavior still needs a fixture/manual validation.'
        : 'No WebMCP navigator surface is enabled by default in this runtime. Treat WebMCP as capability-gated/experimental until task 0027 validates the chosen runtime path.',
    }
  } catch (cause) {
    recordFailure('webmcp.presence', cause)
    return { navigatorPresent: false, type: 'unknown', error: cause instanceof Error ? cause.message : String(cause) }
  } finally {
    destroyView(view, hostWindow)
  }
}

function createView(ses, hostWindow) {
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  view.setBounds({ x: 0, y: 0, width: 640, height: 480 })
  view.setVisible(false)
  hostWindow.contentView.addChildView(view)
  return view
}

function destroyView(view, hostWindow) {
  try { hostWindow.contentView.removeChildView(view) } catch {}
  if (!view.webContents.isDestroyed()) view.webContents.close()
}

function sumFinite(values) {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) : null
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function startFixtureServer() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      if (url.pathname === '/download') {
        response.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': 'attachment; filename="runtime-spike-download.txt"',
        })
        response.end('nd-browser-runtime-spike\n')
        return
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>ND Browser Runtime Spike</title></head>
<body>
  <h1>ND Browser Runtime Spike</h1>
  <button id="action">Action</button>
  <input aria-label="Fixture input">
  <p id="path">${escapeHtml(url.pathname)}</p>
</body>
</html>`)
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise(server))
  })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]))
}
