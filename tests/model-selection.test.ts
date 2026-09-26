import { describe, expect, it } from 'vitest'
import type { ModelProvider, SessionModels } from '../src/shared/contracts.js'
import { isVisionModel, resolveModelSelectionDisplay } from '../src/renderer/src/lib/model-selection.js'

const providers: ModelProvider[] = [
  {
    id: 'custom-open-router',
    name: 'Open Router',
    enabled: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'OpenAI compatible (/v1/chat/completions)',
    apiKey: '',
    models: [{ id: 'stealth/ox-alpha', context: '1M' }],
  },
]

describe('model selection display', () => {
  it('shows the configured default before a session exists', () => {
    expect(resolveModelSelectionDisplay(null, null, providers, 'idle')).toEqual({
      label: 'Open Router/stealth/ox-alpha',
      title: 'Default for the next ND Harness session · Open Router/stealth/ox-alpha',
      stale: false,
    })
  })

  it('uses provider-neutral copy while a session catalog loads or fails', () => {
    expect(resolveModelSelectionDisplay(null, 'session-1', providers, 'loading').label).toBe('Loading models…')
    expect(resolveModelSelectionDisplay(null, 'session-1', providers, 'unavailable').label).toBe('Model unavailable')
  })

  it('uses the session catalog when it is available', () => {
    const models: SessionModels = {
      current: { provider: 'custom-open-router', model: 'stealth/ox-alpha' },
      routable: true,
      groups: [{ id: 'custom-open-router', name: 'Open Router', models: [{ id: 'stealth/ox-alpha' }] }],
      failures: [],
    }

    expect(resolveModelSelectionDisplay(models, 'session-1', providers, 'ready').label).toBe('Open Router/stealth/ox-alpha')
  })

  it('does not invent a vendor when nothing is configured', () => {
    expect(resolveModelSelectionDisplay(null, null, [], 'idle').label).toBe('No model configured')
  })
})

describe('vision capability lookup', () => {
  const visionProviders: ModelProvider[] = [
    {
      id: 'mimo-route',
      name: 'Mimo',
      enabled: true,
      baseUrl: 'https://mimo.example/v1',
      apiFormat: 'OpenAI compatible (/v1/chat/completions)',
      apiKey: '',
      models: [
        { id: 'mimo-v2.5', context: '1M', inputTypes: ['text', 'image'] },
        { id: 'mimo-text', context: '128K', inputTypes: ['text'] },
      ],
    },
  ]

  it('marks only models whose provider record declares image input', () => {
    expect(isVisionModel(visionProviders, 'mimo-route', 'mimo-v2.5')).toBe(true)
    expect(isVisionModel(visionProviders, 'mimo-route', 'mimo-text')).toBe(false)
  })

  it('stays text-only for unknown routes and models', () => {
    expect(isVisionModel(visionProviders, 'unknown-route', 'mimo-v2.5')).toBe(false)
    expect(isVisionModel(visionProviders, 'mimo-route', 'gone')).toBe(false)
    expect(isVisionModel([], 'mimo-route', 'mimo-v2.5')).toBe(false)
  })

  it('resolves the direct DeepSeek compat route to the ND record', () => {
    const deepseekProviders: ModelProvider[] = [{
      id: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      baseUrl: '',
      apiFormat: 'OpenAI compatible (/v1/chat/completions)',
      apiKey: '',
      models: [{ id: 'deepseek-vision', context: '128K', inputTypes: ['text', 'image'] }],
    }]
    expect(isVisionModel(deepseekProviders, 'deepseek-official', 'deepseek-vision')).toBe(true)
    expect(isVisionModel(deepseekProviders, 'deepseek', 'deepseek-vision')).toBe(true)
  })

  it('does not display disabled DeepSeek even if session current still references it', () => {
    const disabledDsProviders: ModelProvider[] = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        enabled: false,
        baseUrl: 'https://api.deepseek.com',
        apiFormat: 'Chat completions (/chat/completions)',
        apiKey: '',
        models: [{ id: 'deepseek-chat', context: '128K' }],
      },
      {
        id: 'custom-mimo',
        name: 'Mimo v6',
        enabled: true,
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiFormat: 'OpenAI compatible (/v1/chat/completions)',
        apiKey: '',
        models: [{ id: 'mimo-v2.6-flash', context: '1M' }],
      },
    ]

    const models: SessionModels = {
      current: { provider: 'deepseek-official', model: 'deepseek-chat' },
      routable: true,
      groups: [],
      failures: [],
    }

    // Should fall back to the active enabled provider, not display disabled DeepSeek
    const display = resolveModelSelectionDisplay(models, 'session-1', disabledDsProviders, 'ready')
    expect(display.label).toBe('Mimo v6/mimo-v2.6-flash')
  })
})

describe('restrictDeepSeekCatalog', () => {
  it('omits DeepSeek completely from groups when DeepSeek is disabled', async () => {
    const { restrictDeepSeekCatalog } = await import('../src/shared/model-catalog.js')
    const catalog: SessionModels = {
      current: { provider: 'deepseek-official', model: 'deepseek-chat' },
      routable: true,
      groups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-chat', name: 'deepseek-chat' },
            { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
          ],
        },
        {
          id: 'custom-mimo',
          name: 'Mimo v6',
          models: [{ id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash' }],
        },
      ],
      failures: [],
    }

    const providersList: ModelProvider[] = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        enabled: false,
        baseUrl: '',
        apiFormat: 'Chat completions (/chat/completions)',
        apiKey: '',
        models: [],
      },
      {
        id: 'custom-mimo',
        name: 'Mimo v6',
        enabled: true,
        baseUrl: '',
        apiFormat: 'OpenAI compatible (/v1/chat/completions)',
        apiKey: '',
        models: [{ id: 'mimo-v2.6-flash', context: '1M' }],
      },
    ]

    const restricted = restrictDeepSeekCatalog(catalog, providersList)
    expect(restricted.groups.some((g) => g.id === 'deepseek-official' || g.id === 'deepseek')).toBe(false)
    expect(restricted.groups).toHaveLength(1)
    expect(restricted.groups[0]!.id).toBe('custom-mimo')
    expect(restricted.current).toEqual({ provider: 'custom-mimo', model: 'mimo-v2.6-flash' })
  })

  it('restricts DeepSeek to configured model when DeepSeek is enabled', async () => {
    const { restrictDeepSeekCatalog } = await import('../src/shared/model-catalog.js')
    const catalog: SessionModels = {
      current: { provider: 'deepseek-official', model: 'deepseek-chat' },
      routable: true,
      groups: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-chat', name: 'deepseek-chat' },
            { id: 'deepseek-reasoner', name: 'deepseek-reasoner' },
          ],
        },
      ],
      failures: [],
    }

    const providersList: ModelProvider[] = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        enabled: true,
        baseUrl: '',
        apiFormat: 'Chat completions (/chat/completions)',
        apiKey: '',
        models: [{ id: 'deepseek-chat', context: '128K' }],
      },
    ]

    const restricted = restrictDeepSeekCatalog(catalog, providersList)
    expect(restricted.groups).toHaveLength(1)
    expect(restricted.groups[0]!.id).toBe('deepseek-official')
    expect(restricted.groups[0]!.models).toHaveLength(1)
    expect(restricted.groups[0]!.models[0]!.id).toBe('deepseek-chat')
  })

  it('filters out disabled third-party providers from groups', async () => {
    const { restrictDeepSeekCatalog } = await import('../src/shared/model-catalog.js')
    const catalog: SessionModels = {
      current: { provider: 'provider-a', model: 'model-a' },
      routable: true,
      groups: [
        {
          id: 'provider-a',
          name: 'Provider A',
          models: [{ id: 'model-a', name: 'model-a' }],
        },
        {
          id: 'provider-b',
          name: 'Provider B',
          models: [{ id: 'model-b', name: 'model-b' }],
        },
      ],
      failures: [],
    }

    const providersList: ModelProvider[] = [
      { id: 'provider-a', name: 'Provider A', enabled: true, baseUrl: '', apiFormat: '', apiKey: '', models: [{ id: 'model-a', context: '128K' }] },
      { id: 'provider-b', name: 'Provider B', enabled: false, baseUrl: '', apiFormat: '', apiKey: '', models: [{ id: 'model-b', context: '128K' }] },
    ]

    const restricted = restrictDeepSeekCatalog(catalog, providersList)
    expect(restricted.groups).toHaveLength(1)
    expect(restricted.groups[0]!.id).toBe('provider-a')
  })
})

