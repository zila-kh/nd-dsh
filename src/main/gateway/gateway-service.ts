import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { NdGatewayAppId, NdGatewayConnectInput, NdGatewayMode, NdGatewayState } from '../../shared/gateway.js'
import type { ProviderStore } from '../providers.js'
import type { TokenSaverService } from '../token-saver/token-saver-service.js'

const MAX_BODY_BYTES = 8 * 1024 * 1024

interface GatewayBinding {
  appId: NdGatewayAppId
  mode: NdGatewayMode
  providerId: string
  token: string
}

export class NdGatewayService {
  private server: Server | undefined
  private port: number | undefined
  private binding: GatewayBinding | undefined
  private onChanged: ((state: NdGatewayState) => void) | undefined

  constructor(
    private readonly providers: () => ProviderStore,
    private readonly tokenSaver: TokenSaverService,
  ) {}

  setOnChanged(listener: ((state: NdGatewayState) => void) | undefined): void {
    this.onChanged = listener
  }

  state(): NdGatewayState {
    const chatgptDetected = detectChatGptDesktop()
    return {
      enabled: Boolean(this.binding),
      running: Boolean(this.server?.listening),
      ...(this.port ? { port: this.port, endpoint: `http://127.0.0.1:${this.port}/v1` } : {}),
      apps: [{
        id: 'chatgpt',
        name: 'ChatGPT Desktop',
        detected: chatgptDetected,
        supported: false,
        connected: false,
        mode: this.binding?.mode ?? 'nd-enhanced',
        ...(this.binding?.providerId ? { providerId: this.binding.providerId } : {}),
        detail: chatgptDetected
          ? 'Detected. ChatGPT does not currently expose a safe custom model endpoint, so ND will not intercept its private traffic.'
          : 'Not detected. ND will only connect ChatGPT through a supported app integration; no terminal or OS proxy setup is used.',
      }],
    }
  }

  async connect(input: NdGatewayConnectInput): Promise<NdGatewayState> {
    if (input.appId !== 'chatgpt') throw new Error('Unsupported external app')
    const providerId = input.providerId.trim()
    if (!providerId) throw new Error('Choose a model provider first')
    const provider = this.providers().list().find((item) => item.id === providerId)
    if (!provider) throw new Error('Selected model provider was not found')
    if (!provider.hasApiKey) throw new Error(`Add the ${provider.name} API key in ND before connecting an external app`)
    throw new Error('ChatGPT Desktop does not currently support a custom LLM base URL. ND will not weaken your machine security to force the connection.')
  }

  async disconnect(_appId: NdGatewayAppId): Promise<NdGatewayState> {
    this.binding = undefined
    await this.stop()
    return this.emit()
  }

  /**
   * Internal seam for a supported zero-click app connector. The connector gets
   * only an ND-local credential; real provider credentials stay in trusted main.
   */
  async prepareLocalBinding(appId: NdGatewayAppId, mode: NdGatewayMode, providerId: string): Promise<{ endpoint: string; token: string }> {
    const provider = this.providers().list().find((item) => item.id === providerId)
    if (!provider?.hasApiKey) throw new Error('A provider API key is required before starting ND Gateway')
    this.binding = { appId, mode, providerId, token: `nd_local_${randomBytes(32).toString('base64url')}` }
    await this.start()
    this.emit()
    return { endpoint: `http://127.0.0.1:${this.port}/v1`, token: this.binding.token }
  }

  async close(): Promise<void> {
    this.binding = undefined
    await this.stop()
  }

  private async start(): Promise<void> {
    if (this.server?.listening) return
    this.server = createServer((request, response) => { void this.handle(request, response) })
    await new Promise<void>((resolve, reject) => {
      const server = this.server!
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject)
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('ND Gateway could not allocate a loopback port'))
        this.port = address.port
        resolve()
      })
    })
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.port = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const binding = this.binding
      if (!binding) return json(response, 503, { error: { message: 'ND Gateway is not configured' } })
      if (!authorized(request, binding.token)) return json(response, 401, { error: { message: 'Invalid ND Gateway credential' } })
      if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true })
      if (request.method !== 'POST' || (request.url !== '/v1/chat/completions' && request.url !== '/v1/responses')) {
        return json(response, 404, { error: { message: 'Unsupported ND Gateway endpoint' } })
      }

      const raw = await readBody(request)
      const body = JSON.parse(raw) as unknown
      const optimized = binding.mode === 'llm-only' ? body : optimizePayload(body, this.tokenSaver)
      const upstream = resolveUpstream(this.providers(), binding.providerId, request.url)
      const result = await fetch(upstream.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${upstream.apiKey}`,
        },
        body: JSON.stringify(optimized),
        signal: AbortSignal.timeout(120_000),
      })
      response.statusCode = result.status
      response.setHeader('content-type', result.headers.get('content-type') ?? 'application/json')
      if (!result.body) return response.end()
      for await (const chunk of result.body) response.write(Buffer.from(chunk))
      response.end()
    } catch (error) {
      if (!response.headersSent) json(response, 502, { error: { message: error instanceof Error ? error.message : String(error) } })
      else response.end()
    }
  }

  private emit(): NdGatewayState {
    const state = this.state()
    this.onChanged?.(state)
    return state
  }
}

function resolveUpstream(providers: ProviderStore, providerId: string, path: string): { url: string; apiKey: string } {
  const metadata = providers.list().find((item) => item.id === providerId)
  if (!metadata) throw new Error('Selected provider no longer exists')
  const runtime = providers.runtimeConfig()
  let baseUrl = metadata.baseUrl.trim().replace(/\/$/, '')
  let apiKey = ''
  if (providerId === 'deepseek') {
    baseUrl = (runtime.environment.DEEPSEEK_BASE_URL || baseUrl).replace(/\/$/, '')
    apiKey = runtime.environment.DEEPSEEK_API_KEY ?? ''
  } else {
    const profile = runtime.profiles[providerId]
    if (profile?.baseURL) baseUrl = profile.baseURL.replace(/\/$/, '')
    if (profile?.apiKeyEnv) apiKey = runtime.environment[profile.apiKeyEnv] ?? ''
  }
  if (!apiKey) throw new Error(`${metadata.name} API key is required`)
  if (!baseUrl) throw new Error(`${metadata.name} base URL is not configured`)
  return { url: `${baseUrl}${path}`, apiKey }
}

function optimizePayload(value: unknown, tokenSaver: TokenSaverService): unknown {
  if (!value || typeof value !== 'object') return value
  const clone = structuredClone(value) as Record<string, unknown>
  if (Array.isArray(clone.messages)) {
    clone.messages = clone.messages.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry
      const message = { ...(entry as Record<string, unknown>) }
      if (typeof message.content === 'string') message.content = tokenSaver.optimize(message.content, { kind: 'prompt' }).text
      return message
    })
  }
  if (typeof clone.input === 'string') clone.input = tokenSaver.optimize(clone.input, { kind: 'prompt' }).text
  return clone
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const value = request.headers.authorization
  if (!value?.startsWith('Bearer ')) return false
  const actual = Buffer.from(value.slice(7))
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Gateway request is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function detectChatGptDesktop(): boolean {
  const home = homedir()
  const candidates = process.platform === 'darwin'
    ? ['/Applications/ChatGPT.app', join(home, 'Applications/ChatGPT.app')]
    : process.platform === 'win32'
      ? [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ChatGPT'), join(process.env.LOCALAPPDATA ?? '', 'Packages', 'OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0')]
      : [join(home, '.local', 'share', 'applications', 'chatgpt.desktop')]
  return candidates.some((path) => path && existsSync(path))
}