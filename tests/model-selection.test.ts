import { describe, expect, it } from 'vitest'
import type { ModelProvider, SessionModels } from '../src/shared/contracts.js'
import { resolveModelSelectionDisplay } from '../src/renderer/src/lib/model-selection.js'

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
