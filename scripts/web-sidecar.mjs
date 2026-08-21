#!/usr/bin/env node
/**
 * ND-DSH web sidecar ("rush sidecar").
 *
 * A plain browser tab cannot reach the DeepSeek Harness gateway: it binds
 * loopback and sends no CORS headers. This tiny Node server fronts the same
 * gateway wire protocol with CORS enabled and adds the harness / workspace /
 * providers / theme / surface endpoints the renderer would otherwise get from
 * Electron. The renderer probes /api/health first and falls back to this
 * sidecar when it answers, or to the in-memory mocks otherwise.
 *
 * Protocol (mirrors @deepseek-ai/dsh-host-apiproxy as used by GatewayClient):
 *   - Unary RPC: POST /api/<method> with a `client-request` envelope
 *     `{ type, rpcId, method, payload }`; the response body is a
 *     `server-response` envelope whose `result` is `{ ok, value | error }`.
 *   - Answerable frames: POST /api/respond with a `client-response` envelope
 *     echoing the frame's rpcId; the body is a `{ accepted }` receipt.
 *   - Live events: GET /api/events.mux and /api/events.host as Server-Sent
 *     Events. Each `data:` line is one `server-request` frame the gateway
 *     pushed down its WebSocket; EventSource reconnects automatically.
 *   - Sidecar-only endpoints (not gateway methods): /api/health,
 *     /api/harness/*, /api/workspace/*, /api/providers/*, /api/theme/*,
 *     /api/surface/*.
 *
 * The gateway is resolved in this order:
 *   1. --mock            serve a tiny in-memory gateway (no harness needed)
 *   2. ND_DSH_GATEWAY_URL  proxy to an already-running harness gateway
 *   3. spawn the pinned deepseek-harness CLI (web profile) and proxy to it
 *
 * Run: node scripts/web-sidecar.mjs  (or `pnpm web:sidecar`)
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createServer as createNetServer } from 'node:net'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = root
const ownPaths = new Set([
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
])

const args = new Set(process.argv.slice(2))
const mockMode = args.has('--mock') || args.has('--stub')
const port = Number(process.env.ND_DSH_WEB_SIDECAR_PORT ?? process.env.PORT ?? 8788)
const host = process.env.ND_DSH_WEB_SIDECAR_HOST?.trim() || '127.0.0.1'
const workspaceRoot = resolve(process.env.ND_DSH_CWD?.trim() || process.cwd())
const harnessRoot = resolve(process.env.ND_DSH_HARNESS_ROOT?.trim() || join(repoRoot, 'vendor', 'deepseek-harness'))
const permissionMode = process.env.ND_DSH_PERMISSION_MODE?.trim() || 'workspace-write'
const provider = process.env.ND_DSH_PROVIDER?.trim() || 'deepseek-official'
const model = process.env.ND_DSH_MODEL?.trim() || 'deepseek-v4-flash'
const apiKeyPresent = Boolean((process.env.DEEPSEEK_API_KEY ?? '').trim())

const stateDir = process.env.ND_DSH_WEB_SIDECAR_STATE_DIR?.trim()
  ? resolve(process.env.ND_DSH_WEB_SIDECAR_STATE_DIR)
  : join(tmpdir(), 'nd-dsh-web-sidecar', String(port))
const statePath = join(stateDir, 'settings.json')

// ── gateway resolution ───────────────────────────────────────────────────────

/** Lazy proxy: front-gateway base URL, or null when unavailable. */
let gatewayUrl = process.env.ND_DSH_GATEWAY_URL?.trim() || ''
let gatewayReady = false
let relaysStarted = false
let harnessChild = null

async function resolveGateway() {
  if (mockMode) return
  if (gatewayUrl) {
    gatewayReady = await probe(gatewayUrl)
    if (gatewayReady) startRelays()
    return
  }
  // Spawn the pinned harness CLI on the web profile (same flags HarnessService uses).
  const cliBin = join(harnessRoot, 'apps/cli/lib/bin.js')
  if (!existsSync(cliBin)) await fs.mkdir(dirname(cliBin), { recursive: true })
  const patch = join(repoRoot, 'configs/dsh/nd-dsh.patch.yml')
  if (!existsSync(cliBin) || !existsSync(patch)) return
  const gatewayPort = await pickFreePort()
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`
  harnessChild = spawn(process.env.ND_DSH_NODE_BIN?.trim() || 'node', [
    cliBin,
    '--profile', 'web',
    '--patch', patch,
    '--no-open',
    '--port', String(gatewayPort),
  ], {
    cwd: harnessRoot,
    env: {
      ...process.env,
      DSH_HOME: join(stateDir, 'dsh-home'),
      DSH_CWD: workspaceRoot,
      DSH_PERMISSION_MODE: permissionMode,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  harnessChild.stdout?.setEncoding('utf8')
  harnessChild.stderr?.setEncoding('utf8')
  harnessChild.stdout?.on('data', (chunk) => print(childLog('dsh', chunk)))
  harnessChild.stderr?.on('data', (chunk) => print(childLog('dsh', chunk)))
  harnessChild.on('exit', () => { harnessChild = null; gatewayReady = false })
  for (let i = 0; i < 80; i += 1) {
    if (harnessChild === null) return
    if (await probe(gatewayUrl)) { gatewayReady = true; startRelays(); return }
    await delay(250)
  }
}

/** One upstream WebSocket per event path; frames fan out to every SSE client. */
function startRelays() {
  if (relaysStarted || !gatewayUrl || !gatewayReady) return
  relaysStarted = true
  relayGatewayEvents('/api/events.mux')
  relayGatewayEvents('/api/events.host')
}

async function probe(baseUrl) {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_500) })
    return response.status < 500
  } catch {
    return false
  }
}

// ── event fan-out (relayed to SSE downlinks) ─────────────────────────────────

/** { 'session/event'|'host/...' : Set<write> } — actually just a global list. */
const eventDownlinks = new Set()

function pushFrame(frame) {
  const line = `data: ${JSON.stringify(frame)}\n\n`
  for (const write of eventDownlinks) {
    try { write(line) } catch { eventDownlinks.delete(write) }
  }
}

async function relayGatewayEvents(path) {
  if (!gatewayUrl || !gatewayReady) return
  const base = new URL(gatewayUrl)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${base.origin}${path}`)
  socket.addEventListener('open', () => {
    pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'host/connected', payload: { type: 'host/connected' } })
  })
  socket.addEventListener('message', (event) => {
    const text = dataText(event.data)
    if (!text) return
    pushFrame(text)
  })
  socket.addEventListener('close', () => {
    if (gatewayReady) setTimeout(() => relayGatewayEvents(path), 1_000)
  })
}

function dataText(data) {
  if (typeof data === 'string') return data
  if (data == null) return ''
  if (typeof data.text === 'function') {
    let out = ''
    data.text().then((text) => {
      pushFrame(text)
    })
    return ''
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return Buffer.from(data).toString('utf8')
  }
  return ''
}

// ── mock gateway (--mock) ────────────────────────────────────────────────────

const mock = mockMode ? createMockGateway() : null

function createMockGateway() {
  const sessions = new Map()
  const seq = { value: 0 }
  const currentModel = { provider: 'deepseek', model: 'deepseek-v4-flash' }
  return {
    currentModel,
    async rpc(method, payload) {
      switch (method) {        case 'session.list': {
          const items = [...sessions.values()].map((s) => ({
            sessionId: s.id,
            updatedAt: s.updatedAt,
            running: false,
            blank: s.events.length <= 1,
            ...(s.title ? { projections: { asOfSeq: s.events.length, values: { title: s.title } } } : {}),
          }))
          return { ok: true, value: { items } }
        }
        case 'session.create': {
          const id = payload?.sessionId ?? randomUUID()
          const session = { id, title: payload?.agentPreset ? `New ${payload.agentPreset} session` : 'New Chat Thread', events: [], updatedAt: Date.now() }
          sessions.set(id, session)
          pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'host/session-added', payload: { type: 'host/session-added', sessionId: id } })
          return { ok: true, value: { sessionId: id } }
        }
        case 'session.history': {
          const session = sessions.get(payload?.sessionId)
          return { ok: true, value: { events: (session?.events ?? []).map((event) => ({ event })) } }
        }
        case 'session.models':
          return { ok: true, value: { current: { ...currentModel }, routable: true, groups: mockModelGroups(), failures: [] } }
        case 'session.selectModel': {
          if (typeof payload?.provider === 'string') currentModel.provider = payload.provider
          if (typeof payload?.model === 'string') currentModel.model = payload.model
          return { ok: true, value: { ...currentModel } }
        }
        case 'session.prompt': {
          const text = String(payload?.content?.[0]?.text ?? '')
          const id = payload?.sessionId ?? randomUUID()
          if (!sessions.has(id)) sessions.set(id, { id, title: 'New Chat Thread', events: [], updatedAt: Date.now() })
          const session = sessions.get(id)
          session.updatedAt = Date.now()
          session.events.push(env('user/message', { message: { role: 'user', content: text } }))
          pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'host/session-status', payload: { type: 'host/session-status', sessionId: id, running: true } })
          const reply = mockReply(text)
          for (const part of splitForStreaming(reply)) {
            const event = env('assistant/chunk', { chunk: { role: 'assistant', content: part } })
            session.events.push(event)
            pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'session/event', payload: { type: 'session/event', sessionId: id, event } })
            await delay(160)
          }
          const final = env('assistant/message', { message: { role: 'assistant', content: reply } })
          session.events.push(final)
          pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'session/event', payload: { type: 'session/event', sessionId: id, event: final } })
          session.title = titleFor(text) ?? 'New Chat Thread'
          const titleEvent = env('session/title', { title: session.title })
          session.events.push(titleEvent)
          pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'session/event', payload: { type: 'session/event', sessionId: id, event: titleEvent } })
          pushFrame({ type: 'server-request', rpcId: randomUUID(), method: 'host/session-status', payload: { type: 'host/session-status', sessionId: id, running: false } })
          return { ok: true, value: { sessionId: id, messageId: randomUUID() } }
        }
        case 'session.cancel':
          return { ok: true, value: {} }
        case 'agentPreset.list':
          return { ok: true, value: { presets: [
            { id: 'cordis', name: 'Creator', description: 'Create and edit custom agent presets.', trust: 'system' },
            { id: 'code', name: 'Code', description: 'Plan-then-code workflow (PTC).', trust: 'system' },
            { id: 'minimal', name: 'Minimal', description: 'A single focused agent.', trust: 'system' },
          ] } }
        case 'settings.update':
          return { ok: true, value: {} }
        default:
          return { ok: false, error: { code: 'unknown-method', message: `Mock gateway has no handler for ${method}` } }
      }
      function env(type, data) { seq.value += 1; return { type, seq: seq.value, time: Date.now(), data } }
    },
  }
}

function mockModelGroups() {
  return [
    { id: 'deepseek', name: 'DeepSeek', models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-reasoner-v4', name: 'DeepSeek Reasoner V4', reasoning: { efforts: [
        { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' },
      ], defaultEffort: 'medium' } },
    ] },
    { id: 'pi-ai', name: 'Pi AI', models: [{ id: 'pi-ai-3.5', name: 'Pi AI 3.5' }] },
  ]
}

function mockReply(prompt) {
  const trimmed = prompt.trim()
  const topics = new Set()
  for (const match of trimmed.matchAll(/\b([A-Za-z][A-Za-z0-9_-]{3,})\b/g)) {
    topics.add(match[1].toLowerCase())
    if (topics.size >= 4) break
  }
  const list = [...topics].slice(0, 3).join(', ') || 'the objective at hand'
  return [
    `I read the workspace in the context of “${clamp(trimmed, 80)}”.`,
    `The key threads I would pull on cover ${list}.`,
    'You can iterate on this in the Company tab, or ask me to open the built-in browser and work through it live.',
  ].join('\n\n')
}

function splitForStreaming(text) {
  const parts = text.match(/\S+\s*/g) ?? []
  const chunks = []
  let buffer = ''
  for (const part of parts) {
    buffer += part
    if (buffer.length >= 48) { chunks.push(buffer); buffer = '' }
  }
  if (buffer) chunks.push(buffer)
  return chunks.length ? chunks : [text]
}

function titleFor(prompt) {
  const words = prompt.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return undefined
  const head = words.slice(0, 6).join(' ')
  return head.length > 60 ? `${head.slice(0, 60)}…` : head
}

function clamp(text, length) {
  return text.length > length ? `${text.slice(0, length)}…` : text
}

// ── settings + harness status ────────────────────────────────────────────────

const settings = {
  providers: defaultProviders(),
  theme: { mode: 'system', effective: 'dark' },
  surface: 'workbench',
  permissionMode,
}
let loadedSettings = false

function defaultProviders() {
  return [{ id: 'deepseek', name: 'deepseek', enabled: true, baseUrl: 'https://api.deepseek.com', apiFormat: 'Chat completions (/chat/completions)', apiKey: '', models: [{ id: 'deepseek-v4-flash', context: '1M' }] }]
}

function effectiveTheme() {
  const mode = settings.theme.mode
  if (mode !== 'system') return mode
  // Sidecar has no nativeTheme; follow the requesting browser via /api/theme/set is the caller's own choice.
  return 'dark'
}

async function loadSettings() {
  if (loadedSettings) return
  loadedSettings = true
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'))
    settings.providers = parsed.providers ?? settings.providers
    settings.theme = parsed.theme ?? settings.theme
    settings.surface = parsed.surface ?? settings.surface
    settings.permissionMode = parsed.permissionMode ?? settings.permissionMode
  } catch { /* first run */ }
}

async function saveSettings() {
  await fs.mkdir(stateDir, { recursive: true })
  const temp = `${statePath}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await fs.rename(temp, statePath)
}

function harnessStatus() {
  const cliBin = join(harnessRoot, 'apps/cli/lib/bin.js')
  const patch = join(repoRoot, 'configs/dsh/nd-dsh.patch.yml')
  const sourceReady = existsSync(cliBin) && existsSync(patch)
  const state = mockMode ? 'ready' : gatewayReady ? 'ready' : sourceReady ? 'starting' : 'stopped'
  const status = {
    state,
    sourceReady,
    apiKeyPresent,
    provider,
    model,
  }
  if (gatewayUrl) {
    status.url = gatewayUrl
    try { status.port = Number(new URL(gatewayUrl).port) } catch { /* ignore */ }
  }
  return status
}

// ── workspace fs (root-scoped) ───────────────────────────────────────────────

function resolveWorkspacePath(relativePath) {
  const candidate = resolve(workspaceRoot, relativePath || '.')
  if (candidate !== workspaceRoot && !candidate.startsWith(workspaceRoot + sep)) {
    throw new Error('Path escapes the workspace root')
  }
  return candidate
}

async function listWorkspace(relativePath) {
  const dir = resolveWorkspacePath(relativePath || '.')
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .map((entry) => ({ name: entry.name, relativePath: (relativePath && relativePath !== '.' ? `${relativePath}/` : '') + entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }))
    .sort((left, right) => left.kind === right.kind ? left.name.localeCompare(right.name) : left.kind === 'directory' ? -1 : 1)
}

async function readWorkspaceFile(relativePath) {
  const file = resolveWorkspacePath(relativePath)
  const stat = await fs.stat(file)
  const buffer = await fs.readFile(file)
  const trimmed = buffer.subarray(0, 600_000)
  return { relativePath, content: trimmed.toString('utf8'), truncated: buffer.length > trimmed.length }
}

// ── gateway proxy helpers ────────────────────────────────────────────────────

async function proxyToGateway(method, body) {
  if (mock) {
    const result = await mock.rpc(method, body?.payload)
    return { type: 'server-response', rpcId: body?.rpcId ?? randomUUID(), result }
  }
  if (!gatewayUrl || !gatewayReady) {
    return { type: 'server-response', rpcId: body?.rpcId ?? randomUUID(), result: { ok: false, error: { code: 'gateway-unavailable', message: 'Harness gateway is not ready' } } }
  }
  const response = await fetch(`${gatewayUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  return response.json()
}

async function proxyRespond(body) {
  if (mock) return { accepted: true }
  if (!gatewayUrl || !gatewayReady) return { accepted: false, reason: 'gateway not ready' }
  const response = await fetch(`${gatewayUrl}/api/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  return response.json()
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = createServer(async (request, response) => {
  const method = request.method ?? 'GET'
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const path = url.pathname

  setCors(response)
  if (method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  try {
    // SSE event downlinks (the gateway pushes server-request frames over WS).
    if (method === 'GET' && (path === '/api/events.mux' || path === '/api/events.host')) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.write(`data: ${JSON.stringify({ type: 'server-request', rpcId: randomUUID(), method: 'host/connected', payload: { type: 'host/connected' } })}\n\n`)
      const write = (line) => response.write(line)
      eventDownlinks.add(write)
      request.on('close', () => {
        eventDownlinks.delete(write)
        try { response.end() } catch { /* already closed */ }
      })
      return
    }

    // Health probe (renderer decides sidecar vs mocks).
    if (method === 'GET' && path === '/api/health') {
      await resolveGateway()
      respondJson(response, { ok: true, gateway: mockMode || gatewayReady, workspace: { root: workspaceRoot, name: basename(workspaceRoot) } })
      return
    }

    if (method === 'GET' && path === '/api/harness/status') {
      respondJson(response, harnessStatus())
      return
    }
    if (method === 'GET' && path === '/api/harness/permission/get') {
      respondJson(response, { mode: settings.permissionMode })
      return
    }
    if (method === 'GET' && path === '/api/workspace/state') {
      respondJson(response, { root: workspaceRoot, name: basename(workspaceRoot) })
      return
    }
    if (method === 'GET' && path === '/api/workspace/list') {
      respondJson(response, await listWorkspace(url.searchParams.get('path') ?? '.'))
      return
    }
    if (method === 'GET' && path === '/api/workspace/read') {
      respondJson(response, await readWorkspaceFile(url.searchParams.get('path') ?? ''))
      return
    }
    if (method === 'GET' && path === '/api/providers/list') {
      await loadSettings()
      respondJson(response, settings.providers)
      return
    }
    if (method === 'GET' && path === '/api/theme/state') {
      await loadSettings()
      respondJson(response, settings.theme)
      return
    }
    if (method === 'GET' && path === '/api/surface/state') {
      await loadSettings()
      respondJson(response, { surface: settings.surface, view: { ready: Boolean(gatewayUrl), loading: false, title: 'DeepSeek', visible: false, ...(gatewayUrl ? { url: gatewayUrl } : {}) } })
      return
    }

    if (method === 'POST') {
      const body = await readBody(request)
      if (path === '/api/respond') {
        respondJson(response, await proxyRespond(body))
        return
      }
      if (path === '/api/harness/run') {
        await resolveGateway()
        const sessionId = body?.sessionId
        let target = sessionId
        if (!target) {
          const created = await proxyToGateway('session.create', { type: 'client-request', rpcId: randomUUID(), method: 'session.create', payload: { cwd: workspaceRoot } })
          target = created?.result?.value?.sessionId
          if (typeof target !== 'string') { respondJson(response, { ok: false, error: { code: 'session-create-failed', message: 'Could not create a session' } }); return }
        }
        const prompted = await proxyToGateway('session.prompt', {
          type: 'client-request',
          rpcId: randomUUID(),
          method: 'session.prompt',
          payload: { sessionId: target, content: [{ type: 'text', text: String(body?.prompt ?? '') }] },
        })
        respondJson(response, { sessionId: target, ...(prompted?.result?.value?.messageId ? { messageId: prompted.result.value.messageId } : {}) })
        return
      }
      if (path === '/api/harness/stop') {
        await proxyToGateway('session.cancel', { type: 'client-request', rpcId: randomUUID(), method: 'session.cancel', payload: { sessionId: body?.sessionId ?? '' } })
        respondJson(response, harnessStatus())
        return
      }
      if (path === '/api/harness/permission/set') {
        settings.permissionMode = String(body?.mode ?? 'workspace-write')
        await saveSettings()
        respondJson(response, { mode: settings.permissionMode })
        return
      }
      if (path === '/api/workspace/set-root') {
        throw new Error('Change workspace is not supported by the web sidecar; set ND_DSH_CWD at launch instead.')
      }
      if (path === '/api/providers/save') {
        await loadSettings()
        settings.providers = Array.isArray(body?.providers) ? body.providers : settings.providers
        await saveSettings()
        respondJson(response, settings.providers)
        return
      }
      if (path === '/api/theme/set') {
        await loadSettings()
        settings.theme.mode = String(body?.mode ?? 'system')
        settings.theme.effective = settings.theme.mode === 'system' ? 'dark' : settings.theme.mode
        await saveSettings()
        respondJson(response, settings.theme)
        return
      }
      if (path === '/api/surface/set') {
        await loadSettings()
        settings.surface = body?.surface === 'dsh' ? 'dsh' : 'workbench'
        await saveSettings()
        respondJson(response, { surface: settings.surface, view: { ready: Boolean(gatewayUrl), loading: false, title: 'DeepSeek', visible: false } })
        return
      }

      // Anything else under /api/ is a gateway method → proxy.
      if (path.startsWith('/api/') && !ownPaths.has(path)) {
        respondJson(response, await proxyToGateway(path.slice('/api/'.length), body))
        return
      }
    }

    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: `No route for ${method} ${path}` }))
  } catch (error) {
    respondJson(response, { type: 'server-response', rpcId: 'server-error', result: { ok: false, error: { code: 'sidecar-error', message: error instanceof Error ? error.message : String(error) } } }, 500)
  }
})

server.listen(port, host, () => {
  print(`ND-DSH web sidecar listening on http://${host}:${port}`)
  print(`  workspace : ${workspaceRoot}`)
  print(`  gateway   : ${mockMode ? 'mock (--mock)' : gatewayUrl || 'spawn on demand'}`)
  if (mockMode) print('  Tip: run `pnpm web:sidecar` (no --mock) to back the UI with the real DeepSeek Harness.')
})

// ── helpers ──────────────────────────────────────────────────────────────────

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'content-type,accept')
  response.setHeader('Access-Control-Max-Age', '600')
}

function respondJson(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => { if (port > 0) resolve(port); else reject(new Error('No free port')) })
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

function basename(value) {
  const parts = value.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) ?? value
}

function print(line) {
  console.log(line)
}

function childLog(label, chunk) {
  return chunk.split('\n').filter(Boolean).map((line) => `[${label}] ${line}`).join('\n')
}
