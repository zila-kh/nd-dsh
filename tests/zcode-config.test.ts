import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateZcodeCliConfigUpdate, type ZcodeCliConfigUpdate } from '../src/shared/zcode-config.js'
import { readZcodeCliConfig, writeZcodeCliConfig, zcodeCliConfigPath } from '../src/main/engines/zcode/zcode-config.js'

/**
 * ND's read/modify/write layer over the ZCode CLI's own config.json. The
 * contract under test: only the model/provider slice changes, unrelated keys
 * survive, secrets never come back to the renderer, and a file ND cannot
 * parse is never rewritten.
 */

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'nd-dsh-zcode-config-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function configPath(): string {
  return zcodeCliConfigPath(home)
}

async function writeRaw(document: unknown): Promise<void> {
  await mkdir(join(home, '.zcode', 'cli'), { recursive: true })
  await writeFile(configPath(), JSON.stringify(document, null, 2), 'utf8')
}

function baseUpdate(overrides: { providers?: ZcodeCliConfigUpdate['providers']; mainModel?: string; liteModel?: string } = {}): ZcodeCliConfigUpdate {
  return {
    providers: overrides.providers ?? [
      {
        id: 'zai',
        kind: 'anthropic',
        name: 'Z.ai',
        baseURL: 'https://api.z.ai/api/anthropic',
        apiKey: 'sk-test-1234',
        models: [{ id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 200_000 }],
      },
    ],
    mainModel: overrides.mainModel ?? 'zai/glm-5.3',
    ...(overrides.liteModel !== undefined ? { liteModel: overrides.liteModel } : {}),
  }
}

describe('zcode cli config read', () => {
  it('reports a missing file as an empty snapshot', async () => {
    const snapshot = await readZcodeCliConfig(home)
    expect(snapshot.exists).toBe(false)
    expect(snapshot.providers).toEqual([])
    expect(snapshot.mainModel).toBeUndefined()
    expect(snapshot.parseError).toBeUndefined()
  })

  it('maps providers, model references, and masked key hints without leaking secrets', async () => {
    await writeRaw({
      plugins: { enabledPlugins: {} },
      model: 'zai/glm-5.3',
      provider: {
        zai: {
          kind: 'anthropic',
          name: 'Z.ai',
          options: { baseURL: 'https://api.z.ai/api/anthropic', apiKey: 'sk-live-abcd1234' },
          models: { 'glm-5.3': { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 200_000, customTuning: true } },
        },
      },
    })
    const snapshot = await readZcodeCliConfig(home)
    expect(snapshot.exists).toBe(true)
    expect(snapshot.mainModel).toBe('zai/glm-5.3')
    expect(snapshot.providers).toHaveLength(1)
    const provider = snapshot.providers[0]!
    expect(provider.id).toBe('zai')
    expect(provider.kind).toBe('anthropic')
    expect(provider.baseURL).toBe('https://api.z.ai/api/anthropic')
    expect(provider.apiKeySet).toBe(true)
    expect(provider.apiKeyHint).toBe('sk-…1234')
    expect(provider.models).toEqual([{ id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 200_000 }])
    expect(JSON.stringify(snapshot)).not.toContain('sk-live-abcd1234')
  })

  it('reports an unparseable file without throwing', async () => {
    await mkdir(join(home, '.zcode', 'cli'), { recursive: true })
    await writeFile(configPath(), '{not json', 'utf8')
    const snapshot = await readZcodeCliConfig(home)
    expect(snapshot.exists).toBe(true)
    expect(snapshot.parseError).toBeTruthy()
    expect(snapshot.providers).toEqual([])
  })
})

describe('zcode cli config write', () => {
  it('creates the config with the provider slice and the default model', async () => {
    const snapshot = await writeZcodeCliConfig(baseUpdate(), home)
    expect(existsSync(configPath())).toBe(true)
    expect(snapshot.mainModel).toBe('zai/glm-5.3')
    const document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.model).toBe('zai/glm-5.3')
    expect(document.provider.zai.kind).toBe('anthropic')
    expect(document.provider.zai.options.baseURL).toBe('https://api.z.ai/api/anthropic')
    expect(document.provider.zai.options.apiKey).toBe('sk-test-1234')
    expect(document.provider.zai.models['glm-5.3'].name).toBe('GLM-5.3')
  })

  it('writes a main/lite pair as the object form', async () => {
    await writeZcodeCliConfig(baseUpdate({
      providers: [
        { id: 'zai', kind: 'anthropic', models: [{ id: 'glm-5.3' }], apiKey: 'k1' },
      ],
      mainModel: 'zai/glm-5.3',
      liteModel: 'zai/glm-5.3',
    }), home)
    const document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.model).toEqual({ main: 'zai/glm-5.3', lite: 'zai/glm-5.3' })
  })

  it('preserves unrelated keys and unknown passthrough fields', async () => {
    await writeRaw({
      plugins: { enabledPlugins: { 'a@b': true } },
      skills: { '/tmp/skill.md': { enable: false } },
      provider: {
        zai: {
          kind: 'anthropic',
          vendorExtension: { keep: true },
          options: { baseURL: 'https://old.example/v1', apiKey: 'old-key', includeUsage: true },
          models: { 'glm-5.3': { id: 'glm-5.3', internalFlag: 7 } },
        },
      },
    })
    await writeZcodeCliConfig(baseUpdate(), home)
    const document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.plugins).toEqual({ enabledPlugins: { 'a@b': true } })
    expect(document.skills).toEqual({ '/tmp/skill.md': { enable: false } })
    expect(document.provider.zai.vendorExtension).toEqual({ keep: true })
    expect(document.provider.zai.options.includeUsage).toBe(true)
    // An explicit key in the update wins over the stored one; the omitted-key
    // keep path is covered by the key-lifecycle test below.
    expect(document.provider.zai.options.apiKey).toBe('sk-test-1234')
    expect(document.provider.zai.options.baseURL).toBe('https://api.z.ai/api/anthropic')
    expect(document.provider.zai.models['glm-5.3'].internalFlag).toBe(7)
  })

  it('keeps an existing API key when the update omits one, sets new keys, and clears on request', async () => {
    await writeZcodeCliConfig(baseUpdate(), home)
    await writeZcodeCliConfig(baseUpdate({
      providers: [
        // Existing provider, no key in the update: the stored key survives.
        { id: 'zai', kind: 'anthropic', baseURL: 'https://api.z.ai/api/anthropic', models: [{ id: 'glm-5.3' }] },
        // New provider with a fresh key, then a clear request in a second pass.
        { id: 'local', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', apiKey: 'ollama-secret', models: [{ id: 'llama3.3' }] },
      ],
    }), home)
    let document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.provider.zai.options.apiKey).toBe('sk-test-1234')
    expect(document.provider.local.options.apiKey).toBe('ollama-secret')

    await writeZcodeCliConfig(baseUpdate({
      providers: [
        { id: 'zai', kind: 'anthropic', baseURL: 'https://api.z.ai/api/anthropic', models: [{ id: 'glm-5.3' }] },
        { id: 'local', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', clearApiKey: true, models: [{ id: 'llama3.3' }] },
      ],
    }), home)
    document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.provider.zai.options.apiKey).toBe('sk-test-1234')
    expect(document.provider.local.options.apiKey).toBeUndefined()
    expect(document.provider.local.options.baseURL).toBe('http://localhost:11434/v1')
  })

  it('removes providers that are absent from the update but keeps their entry out of unrelated keys', async () => {
    await writeZcodeCliConfig(baseUpdate(), home)
    await writeZcodeCliConfig(baseUpdate({
      providers: [{ id: 'local', kind: 'openai-compatible', baseURL: 'http://localhost:1234/v1', models: [{ id: 'qwen3' }] }],
      mainModel: 'local/qwen3',
    }), home)
    const document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(Object.keys(document.provider)).toEqual(['local'])
  })

  it('preserves the existing default model when the update omits one', async () => {
    await writeZcodeCliConfig(baseUpdate(), home)
    await writeZcodeCliConfig({
      providers: [{ id: 'zai', kind: 'anthropic', models: [{ id: 'glm-5.3' }] }],
    }, home)
    const document = JSON.parse(await readFile(configPath(), 'utf8'))
    expect(document.model).toBe('zai/glm-5.3')
  })

  it('backs up the previous content before the first ND rewrite', async () => {
    await writeRaw({ plugins: { enabledPlugins: {} }, note: 'hand written' })
    await writeZcodeCliConfig(baseUpdate(), home)
    const backup = JSON.parse(await readFile(`${configPath()}.nd-backup`, 'utf8'))
    expect(backup.note).toBe('hand written')
    expect(backup.plugins).toEqual({ enabledPlugins: {} })
  })

  it('refuses to rewrite a file that does not parse', async () => {
    await mkdir(join(home, '.zcode', 'cli'), { recursive: true })
    const broken = '{not json'
    await writeFile(configPath(), broken, 'utf8')
    await expect(writeZcodeCliConfig(baseUpdate(), home)).rejects.toThrow(/could not be parsed/)
    expect(await readFile(configPath(), 'utf8')).toBe(broken)
  })

  it('rejects invalid updates without touching the file', async () => {
    const cases: ZcodeCliConfigUpdate[] = [
      { providers: [{ id: 'bad/id', kind: 'openai', models: [{ id: 'm' }] }] },
      { providers: [{ id: 'ok', kind: 'openai', models: [] }] },
      { providers: [{ id: 'ok', kind: 'openai', models: [{ id: 'm' }] }], mainModel: 'ok' },
      { providers: [{ id: 'ok', kind: 'openai', models: [{ id: 'm' }] }], mainModel: 'other/m' },
      { providers: [{ id: 'ok', kind: 'grpc' as unknown as ZcodeCliConfigUpdate['providers'][number]['kind'], models: [{ id: 'm' }] }] },
      { providers: [{ id: 'ok', kind: 'openai-compatible', baseURL: 'ftp://x', models: [{ id: 'm' }] }] },
    ]
    for (const update of cases) {
      await expect(writeZcodeCliConfig(update, home)).rejects.toThrow()
      expect(existsSync(configPath())).toBe(false)
    }
  })

  it('rewrites atomically without leaving staging files behind', async () => {
    await writeZcodeCliConfig(baseUpdate(), home)
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(join(home, '.zcode', 'cli'))
    expect(files.filter((name) => name.includes('nd-staging'))).toEqual([])
  })
})

describe('shared zcode config validation', () => {
  it('accepts a well-formed update with local endpoints', () => {
    const problems = validateZcodeCliConfigUpdate({
      providers: [{
        id: 'ollama',
        kind: 'openai-compatible',
        baseURL: 'http://localhost:11434/v1',
        models: [{ id: 'llama3.3', contextWindow: 128_000 }],
      }],
      mainModel: 'ollama/llama3.3',
    })
    expect(problems).toEqual([])
  })

  it('flags duplicate providers, duplicate models, and bad token counts', () => {
    const problems = validateZcodeCliConfigUpdate({
      providers: [
        { id: 'dup', kind: 'openai', models: [{ id: 'm', contextWindow: -5 }, { id: 'm' }] },
        { id: 'dup', kind: 'openai', models: [{ id: 'm2' }] },
      ],
    })
    expect(problems).toHaveLength(3)
  })
})
