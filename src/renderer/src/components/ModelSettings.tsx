import { useEffect, useState, type FormEvent } from 'react'
import type { ModelProvider } from '../../../shared/contracts'
import { BoxIcon, EyeIcon, EyeOffIcon, PencilIcon, PlugIcon, PlusIcon, RotateIcon, TrashIcon } from './Icons'

interface ModelSettingsProps {
  onError(message: string): void
}

const API_FORMATS = [
  'Chat completions (/chat/completions)',
  'Responses (/responses)',
  'OpenAI compatible (/v1/chat/completions)',
]

export function ModelSettings({ onError }: ModelSettingsProps) {
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [renamingProvider, setRenamingProvider] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState('')

  useEffect(() => {
    let mounted = true
    void window.ndDsh.providers
      .list()
      .then((loaded) => {
        if (!mounted) return
        setProviders(loaded)
        setSelectedId((current) => (loaded.some((provider) => provider.id === current) ? current : (loaded[0]?.id ?? '')))
      })
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0] ?? null
  const builtins = providers.filter((provider) => provider.id === 'deepseek')
  const customs = providers.filter((provider) => provider.id !== 'deepseek')

  const commit = (next: ModelProvider[]): void => {
    setProviders(next)
    void window.ndDsh.providers.save(next).then(setProviders).catch((cause) => {
      onError(cause instanceof Error ? cause.message : String(cause))
    })
  }

  const updateSelected = (patch: Partial<ModelProvider>): void => {
    commit(providers.map((provider) => (provider.id === selectedId ? { ...provider, ...patch } : provider)))
  }

  const renameProvider = (): void => {
    const name = nameDraft.trim()
    if (name) updateSelected({ name })
    setRenamingProvider(false)
  }

  const removeProvider = (id: string): void => {
    const next = providers.filter((provider) => provider.id !== id)
    if (selectedId === id) setSelectedId(next[0]?.id ?? '')
    commit(next)
  }

  const addProvider = (): void => {
    const index = providers.length + 1
    const provider: ModelProvider = {
      id: `custom-${index}`,
      name: `Custom provider ${index}`,
      enabled: false,
      baseUrl: '',
      apiFormat: API_FORMATS[0] ?? '',
      apiKey: '',
      models: [],
    }
    setSelectedId(provider.id)
    commit([...providers, provider])
  }

  const addModel = (): void => {
    const index = (selected?.models.length ?? 0) + 1
    updateSelected({ models: [...(selected?.models ?? []), { id: `model-${index}`, context: '128K' }] })
  }

  const removeModel = (id: string): void => {
    updateSelected({ models: (selected?.models ?? []).filter((model) => model.id !== id) })
  }

  const commitModelRename = (): void => {
    if (editingModelId && modelDraft.trim()) {
      updateSelected({
        models: (selected?.models ?? []).map((model) => (model.id === editingModelId ? { ...model, id: modelDraft.trim() } : model)),
      })
    }
    setEditingModelId(null)
  }

  return (
    <section className="models-settings" aria-label="Model settings">
      <header className="models-header">
        <div>
          <h2>Model settings</h2>
          <p>Manage custom model providers. Once configured, they can be selected during chat.</p>
        </div>
        <button
          className="models-refresh"
          title="Reload providers from storage"
          aria-label="Refresh model settings"
          onClick={() => {
            void window.ndDsh.providers.list().then(setProviders).catch((cause) => {
              onError(cause instanceof Error ? cause.message : String(cause))
            })
          }}
        >
          <RotateIcon />
        </button>
      </header>

      <div className="models-body">
        <aside className="providers-list" aria-label="Providers">
          <div className="provider-group-label">Providers</div>
          {builtins.map((provider) => (
            <ProviderItem
              key={provider.id}
              provider={provider}
              selected={provider.id === selectedId}
              onSelect={() => setSelectedId(provider.id)}
            />
          ))}
          <div className="provider-group-label">Custom providers</div>
          {customs.map((provider) => (
            <ProviderItem
              key={provider.id}
              provider={provider}
              selected={provider.id === selectedId}
              onSelect={() => setSelectedId(provider.id)}
            />
          ))}
          <button className="add-provider" onClick={addProvider}><PlusIcon />Add provider</button>
        </aside>

        {selected ? (
          <div className="provider-card">
            <header className="provider-card-header">
              <div className="provider-title">
                {renamingProvider ? (
                  <input
                    className="provider-name-input"
                    value={nameDraft}
                    autoFocus
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={renameProvider}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') renameProvider()
                      if (event.key === 'Escape') setRenamingProvider(false)
                    }}
                  />
                ) : (
                  <>
                    <h3>{selected.name}</h3>
                    <button
                      className="icon-button-mini"
                      title="Rename provider"
                      aria-label="Rename provider"
                      onClick={() => {
                        setNameDraft(selected.name)
                        setRenamingProvider(true)
                      }}
                    >
                      <PencilIcon />
                    </button>
                  </>
                )}
              </div>
              <div className="provider-status-actions">
                <span className={selected.enabled ? 'badge-enabled' : 'badge-disabled'}>
                  {selected.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button className="toggle-button" onClick={() => updateSelected({ enabled: !selected.enabled })}>
                  {selected.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="icon-button-mini danger"
                  title="Delete provider"
                  aria-label="Delete provider"
                  onClick={() => removeProvider(selected.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </header>

            <form className="provider-form" onSubmit={(event: FormEvent) => event.preventDefault()}>
              <div className="provider-field">
                <label htmlFor="provider-base-url">Base URL</label>
                <input
                  id="provider-base-url"
                  value={selected.baseUrl}
                  placeholder="https://api.example.com"
                  spellCheck={false}
                  onChange={(event) => updateSelected({ baseUrl: event.target.value })}
                />
              </div>
              <div className="provider-field">
                <label htmlFor="provider-api-format">API format</label>
                <select
                  id="provider-api-format"
                  value={selected.apiFormat}
                  onChange={(event) => updateSelected({ apiFormat: event.target.value })}
                >
                  {API_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
                </select>
              </div>
              <div className="provider-field">
                <label htmlFor="provider-api-key">API key</label>
                <div className="key-field">
                  <input
                    id="provider-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={selected.apiKey}
                    placeholder="••••••••••••••••••••"
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => updateSelected({ apiKey: event.target.value })}
                  />
                  <button
                    type="button"
                    title={showApiKey ? 'Hide API key' : 'Show API key'}
                    aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                    onClick={() => setShowApiKey((current) => !current)}
                  >
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <span className="settings-path">Desktop API keys are stored with OS-backed encryption. If a secure key store is unavailable, the key stays memory-only and must be entered again after restart.</span>
              </div>
            </form>

            <div className="model-list">
              <div className="model-list-label">Model list</div>
              {selected.models.map((model) => (
                <div className="model-item" key={model.id}>
                  {editingModelId === model.id ? (
                    <input
                      className="model-name-input"
                      value={modelDraft}
                      autoFocus
                      onChange={(event) => setModelDraft(event.target.value)}
                      onBlur={commitModelRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitModelRename()
                        if (event.key === 'Escape') setEditingModelId(null)
                      }}
                    />
                  ) : (
                    <span className="model-name">{model.id}</span>
                  )}
                  <div className="model-item-actions">
                    <span className="model-context">{model.context}</span>
                    <button
                      className="icon-button-mini"
                      title="Edit model context"
                      aria-label={`Edit context of ${model.id}`}
                      onClick={() => onError('Model context editing is not wired yet.')}
                    >
                      <PlugIcon />
                    </button>
                    <button
                      className="icon-button-mini"
                      title="Edit model id"
                      aria-label={`Edit model ${model.id}`}
                      onClick={() => {
                        setModelDraft(model.id)
                        setEditingModelId(model.id)
                      }}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      className="icon-button-mini danger"
                      title="Delete model"
                      aria-label={`Delete model ${model.id}`}
                      onClick={() => removeModel(model.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
              <button className="add-model" onClick={addModel}><PlusIcon />Add model</button>
            </div>
          </div>
        ) : (
          <div className="provider-card provider-card-empty">
            <p>No providers yet. Use “Add provider” to create one.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function ProviderItem({ provider, selected, onSelect }: {
  provider: ModelProvider
  selected: boolean
  onSelect(): void
}) {
  return (
    <button
      className={`provider-item ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <BoxIcon />
      <span className="provider-name">{provider.name}</span>
      <span className={`provider-dot ${provider.enabled ? 'on' : ''}`} title={provider.enabled ? 'Active' : 'Disabled'} />
    </button>
  )
}
