import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const serviceWorkerPath = new URL('../extensions/browser-companion/service-worker.js', import.meta.url)

interface FakePort {
  host: string
  messages: Record<string, unknown>[]
  onMessage: { addListener(listener: (message: unknown) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
  postMessage(message: unknown): void
  disconnect(): void
}

interface FakeWorker {
  ports: FakePort[]
  installationIdsWritten: string[]
  uuidCalls(): number
  fireInstalled(): void
  fireStartup(): void
  pendingTimers(): number
  runNextTimer(): Promise<void>
}

async function flush(turns = 10): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

async function loadServiceWorker(): Promise<FakeWorker> {
  const source = await readFile(serviceWorkerPath, 'utf8')
  const ports: FakePort[] = []
  const installed: (() => void)[] = []
  const startup: (() => void)[] = []
  const timers: (() => void)[] = []
  const storage = new Map<string, unknown>()
  const installationIdsWritten: string[] = []
  let uuidCount = 0

  function createPort(host: string): FakePort {
    const messages: Record<string, unknown>[] = []
    const disconnectListeners: (() => void)[] = []
    return {
      host,
      messages,
      onMessage: { addListener: () => undefined },
      onDisconnect: { addListener: (listener) => { disconnectListeners.push(listener) } },
      postMessage: (message) => { messages.push(message as Record<string, unknown>) },
      disconnect: () => { for (const listener of disconnectListeners) listener() },
    }
  }

  const sandbox: Record<string, unknown> = {
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.0.0 Safari/537.36' },
    crypto: {
      randomUUID: () => {
        uuidCount += 1
        return `uuid-${uuidCount}`
      },
    },
    setTimeout: (callback: () => void) => {
      timers.push(callback)
      return timers.length
    },
    clearTimeout: () => undefined,
    chrome: {
      runtime: {
        getManifest: () => ({ version: '0.1.0' }),
        connectNative: (host: string) => {
          const port = createPort(host)
          ports.push(port)
          return port
        },
        onInstalled: { addListener: (listener: () => void) => { installed.push(listener) } },
        onStartup: { addListener: (listener: () => void) => { startup.push(listener) } },
        onConnect: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
      },
      sidePanel: { setPanelBehavior: async () => undefined },
      storage: {
        local: {
          get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) {
              storage.set(key, value)
              if (key === 'installationId') installationIdsWritten.push(String(value))
            }
          },
        },
      },
      tabs: {
        onRemoved: { addListener: () => undefined },
        onUpdated: { addListener: () => undefined, removeListener: () => undefined },
      },
    },
  }

  runInContext(source, createContext(sandbox))

  return {
    ports,
    installationIdsWritten,
    uuidCalls: () => uuidCount,
    fireInstalled: () => { for (const listener of installed) listener() },
    fireStartup: () => { for (const listener of startup) listener() },
    pendingTimers: () => timers.length,
    runNextTimer: async () => {
      const callback = timers.shift()
      if (callback) callback()
      await flush()
    },
  }
}

describe('browser companion service worker', () => {
  it('keeps one native port when onInstalled fires during the first connection', async () => {
    const worker = await loadServiceWorker()
    worker.fireInstalled()
    worker.fireStartup()
    await flush()

    expect(worker.ports).toHaveLength(1)
    expect(worker.installationIdsWritten).toEqual(['uuid-1'])
    expect(worker.ports[0]!.messages).toEqual([
      expect.objectContaining({ kind: 'browser.hello', installationId: 'uuid-1' }),
    ])
  })

  it('reuses the stored installation id and reconnects once after a host exit', async () => {
    const worker = await loadServiceWorker()
    await flush()
    expect(worker.ports).toHaveLength(1)

    worker.ports[0]!.disconnect()
    expect(worker.pendingTimers()).toBe(1)
    await worker.runNextTimer()

    expect(worker.ports).toHaveLength(2)
    expect(worker.uuidCalls()).toBe(1)
    expect(worker.installationIdsWritten).toEqual(['uuid-1'])
    expect(worker.ports[1]!.messages).toEqual([
      expect.objectContaining({ kind: 'browser.hello', installationId: 'uuid-1' }),
    ])
  })
})
