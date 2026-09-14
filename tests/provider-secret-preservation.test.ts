import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderStore } from '../src/main/providers.js'

const electronState = vi.hoisted(() => ({
  userData: '',
  encryptionAvailable: true,
}))

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    getPath: () => electronState.userData,
  },
  safeStorage: {
    isEncryptionAvailable: () => electronState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('OS keyring is unavailable')
      return text.slice('enc:'.length)
    },
    getSelectedStorageBackend: () => 'kwallet',
  },
}))

const PROVIDER = {
  id: 'deepseek',
  name: 'DeepSeek',
  enabled: true,
  baseUrl: 'https://api.deepseek.com',
  apiFormat: 'Chat completions (/chat/completions)',
  models: [{ id: 'deepseek-v4-flash', context: '1M' }],
}

/** Ciphertext this process cannot decrypt, as after an OS keyring reset. */
const UNREADABLE_CIPHERTEXT = Buffer.from('legacy-ciphertext-from-another-keyring', 'utf8').toString('base64')

async function writeProvidersFile(): Promise<void> {
  await writeFile(join(electronState.userData, 'providers.json'), `${JSON.stringify([PROVIDER], null, 2)}\n`, 'utf8')
}

async function writeSecretsFile(ciphertext: string): Promise<void> {
  await writeFile(
    join(electronState.userData, 'provider-secrets.json'),
    `${JSON.stringify({ version: 1, keys: { deepseek: ciphertext } }, null, 2)}\n`,
    'utf8',
  )
}

async function readStoredKeys(): Promise<Record<string, string>> {
  const raw = JSON.parse(await readFile(join(electronState.userData, 'provider-secrets.json'), 'utf8')) as { keys?: Record<string, string> }
  return raw.keys ?? {}
}

beforeEach(async () => {
  electronState.userData = await mkdtemp(join(tmpdir(), 'nd-provider-secrets-'))
  electronState.encryptionAvailable = true
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await writeProvidersFile()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(electronState.userData, { recursive: true, force: true })
})

describe('provider secret preservation', () => {
  it('keeps an undecryptable credential on disk through an unrelated save', async () => {
    await writeSecretsFile(UNREADABLE_CIPHERTEXT)
    const store = new ProviderStore()
    expect(store.list()[0]?.hasApiKey).toBe(false)

    store.save([PROVIDER])

    expect(await readStoredKeys()).toEqual({ deepseek: UNREADABLE_CIPHERTEXT })
  })

  it('keeps it across repeated saves', async () => {
    await writeProvidersFile()
    await writeSecretsFile(UNREADABLE_CIPHERTEXT)
    const store = new ProviderStore()
    store.save([{ ...PROVIDER, enabled: false }])
    store.save([{ ...PROVIDER, enabled: true }])
    expect(await readStoredKeys()).toEqual({ deepseek: UNREADABLE_CIPHERTEXT })
  })

  it('replaces the preserved ciphertext when a new key is set', async () => {
    await writeSecretsFile(UNREADABLE_CIPHERTEXT)
    const store = new ProviderStore()
    store.setApiKey('deepseek', 'sk-fresh')

    expect(await readStoredKeys()).toEqual({ deepseek: Buffer.from('enc:sk-fresh', 'utf8').toString('base64') })
    expect(store.list()[0]?.hasApiKey).toBe(true)
  })

  it('drops the preserved ciphertext only when the credential is cleared', async () => {
    await writeSecretsFile(UNREADABLE_CIPHERTEXT)
    const store = new ProviderStore()
    store.clearApiKey('deepseek')

    expect(await readStoredKeys()).toEqual({})
  })

  it('stores a readable credential normally and reports it as configured', async () => {
    await writeSecretsFile(Buffer.from('enc:sk-stored', 'utf8').toString('base64'))
    const store = new ProviderStore()
    expect(store.list()[0]?.hasApiKey).toBe(true)

    store.save([PROVIDER])
    expect(await readStoredKeys()).toEqual({ deepseek: Buffer.from('enc:sk-stored', 'utf8').toString('base64') })
  })

  it('reports the encrypted payload it could not read instead of silently dropping it', async () => {
    await writeSecretsFile(UNREADABLE_CIPHERTEXT)
    new ProviderStore()
    const warned = vi.mocked(console.warn).mock.calls.map((call) => String(call[0])).join('\n')
    expect(warned).toContain('the stored credential is preserved')
  })
})
