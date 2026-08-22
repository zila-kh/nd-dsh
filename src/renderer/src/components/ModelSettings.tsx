import { useEffect, useState, type FormEvent } from 'react'
import type { ModelProvider, ProviderPingResult } from '../../../shared/contracts'
import { BoxIcon, EyeIcon, EyeOffIcon, PencilIcon, PlugIcon, PlusIcon, RotateIcon, TrashIcon } from './Icons'

interface ModelSettingsProps {
  onError(message: string): void
}

const API_FORMATS = [
  'Provider native / catalog default',
  'Chat completions (/chat/completions)',
  'Responses (/responses)',
  'Anthropic Messages (/v1/messages)',
  'OpenAI compatible (/v1/chat/completions)',
]

export function ModelSettings({ onError }: ModelSettingsProps) {
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [savingCredential, setSavingCredential] = useState(false)
  const [renamingProvider, setRenamingProvider] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelDraft, setModelDraft] = useState('')
  const [editingContextModelId, setEditingContextModelId] = useState<string | null>(null)
  const [contextDraft, setContextDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [pingResult, setPingResult] = useState<ProviderPingResult | null>(null)

  useEffect(() => {
    let mounted = true
    void window.ndDsh.providers
      .list()
      .then((loaded) => {
        if (!mounted) return
        setProviders(loaded)
        setSelectedId((current) => (loaded.some((provider) => provider.id === current) ? current : (loaded[0]?.id ?? '')))
      })
      .catch((cause) => onError(errorMessage(cause)))
    return () => { mounted = false }
  }, [onError])

  useEffect(() => {
    setApiKeyDraft('')
    setShowApiKey(false)
    setPingResult(null)
  }, [selectedId])

  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0] ?? null

  const commit = (next: ModelProvider[]): void => {
    const safe = next.map((provider) => ({ ...provider, apiKey: '' }))
    setProviders(safe)
    void window.ndDsh.providers.save(safe).then(setProviders).catch((cause) => onError(errorMessage(cause)))
  }

  const updateSelected = (patch: Partial<ModelProvider>): void => {
    commit(providers.map((provider) => (provider.id === selectedId ? { ...provider, ...patch, apiKey: '' } : provider)))
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
    const provider: ModelProvider = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Custom provider',
      enabled: false,
      baseUrl: '',
      apiFormat: 'OpenAI compatible (/v1/chat/completions)',
      apiKey: '',
      hasApiKey: false,
      models: [],
    }
    setSelectedId(provider.id)
    commit([...providers, provider])
  }

  const saveCredential = async (): Promise<void> => {
    if (!selected || !apiKeyDraft.trim() || savingCredential) return
    setSavingCredential(true)
    try {
      setProviders(await window.ndDsh.providers.setApiKey(selected.id, apiKeyDraft))
      setApiKeyDraft('')
      setShowApiKey(false)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setSavingCredential(false)
    }
  }

  const clearCredential = async (): Promise<void> => {
    if (!selected || !selected.hasApiKey || savingCredential) return
    setSavingCredential(true)
    try {
      setProviders(await window.ndDsh.providers.clearApiKey(selected.id))
      setApiKeyDraft('')
      setShowApiKey(false)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setSavingCredential(false)
    }
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

  const commitContextEdit = (): void => {
    if (editingContextModelId && contextDraft.trim()) {
      updateSelected({
        models: (selected?.models ?? []).map((model) => (model.id === editingContextModelId ? { ...model, context: contextDraft.trim() } : model)),
      })
    }
    setEditingContextModelId(null)
  }

  const refresh = async (): Promise<void> => {
    try {
      const loaded = await window.ndDsh.providers.list()
      setProviders(loaded)
      setSelectedId((current) => loaded.some((provider) => provider.id === current) ? current : (loaded[0]?.id ?? ''))
    } catch (cause) {
      onError(errorMessage(cause))
    }
  }

  // Real probe: the trusted main process sends an authenticated request to
  // this provider's server and reports state, HTTP status, and latency.
  const testConnection = async (): Promise<void> => {
    if (!selected || testing) return
    setTesting(true)
    setPingResult(null)
    try {
      setPingResult(await window.ndDsh.providers.ping(selected.id, true))
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setTesting(false)
    }
  }

  const pingLabel = (ping: ProviderPingResult): string => {
    if (ping.state === 'ok') return `Online · ${ping.latencyMs ?? '?'}ms${ping.status !== undefined ? ` · HTTP ${ping.status}` : ''}`
    if (ping.state === 'auth') return `Reachable · credential rejected${ping.status !== undefined ? ` · HTTP ${ping.status}` : ''}`
    return 'No answer · timeout or network error'
  }

  return (
    <section className="models-settings" aria-label="Model settings">
      <header className="models-header">
        <div>
          <h2>Model settings</h2>
          <p>Configure model-provider routes independently from coding engines. Enabled routes become available to ND Harness sessions on the next prompt.</p>
        </div>
        <button className="models-refresh" title="Reload providers from storage" aria-label="Refresh model settings" onClick={() => void refresh()}>
          <RotateIcon />
        </button>
      </header>

      <div className="models-body">
        <aside className="providers-list" aria-label="Providers">
          <div className="provider-group-label">Providers</div>
          {providers.map((provider) => (
            <ProviderItem key={provider.id} provider={provider} selected={provider.id === selectedId} onSelect={() => setSelectedId(provider.id)} />
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
                    <button className="icon-button-mini" title="Rename provider" aria-label="Rename provider" onClick={() => { setNameDraft(selected.name); setRenamingProvider(true) }}>
                      <PencilIcon />
                    </button>
                  </>
                )}
              </div>
              <div className="provider-status-actions">
                <span className={selected.enabled ? 'badge-enabled' : 'badge-disabled'}>{selected.enabled ? 'Enabled' : 'Disabled'}</span>
                <button className="toggle-button" onClick={() => updateSelected({ enabled: !selected.enabled })}>{selected.enabled ? 'Disable' : 'Enable'}</button>
                <button type="button" className="toggle-button" disabled={testing} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test connection'}</button>
                {pingResult ? <span className={`ping-result ${pingResult.state}`}>{pingLabel(pingResult)}</span> : null}
                <button className="icon-button-mini danger" title="Delete provider" aria-label="Delete provider" onClick={() => removeProvider(selected.id)}><TrashIcon /></button>
              </div>
            </header>

            <form className="provider-form" onSubmit={(event: FormEvent) => event.preventDefault()}>
              <div className="provider-field">
                <label htmlFor="provider-base-url">Base URL</label>
                <input
                  id="provider-base-url"
                  value={selected.baseUrl}
                  placeholder="Leave blank for a provider-native catalog endpoint"
                  spellCheck={false}
                  onChange={(event) => updateSelected({ baseUrl: event.target.value })}
                />
              </div>
              <div className="provider-field">
                <label htmlFor="provider-api-format">API format</label>
                <select id="provider-api-format" value={selected.apiFormat} onChange={(event) => updateSelected({ apiFormat: event.target.value })}>
                  {API_FORMATS.includes(selected.apiFormat) ? null : <option value={selected.apiFormat}>{selected.apiFormat}</option>}
                  {API_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
                </select>
                <span className="settings-path">Native/catalog mode lets the runtime use a known provider's own protocol and ambient authentication. Custom gateways can use OpenAI Completions, OpenAI Responses, or Anthropic Messages.</span>
              </div>
              <div className="provider-field">
                <label htmlFor="provider-api-key">Credential</label>
                <div className="key-field">
                  <input
                    id="provider-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyDraft}
                    placeholder={selected.hasApiKey ? 'Credential stored — enter a new key to replace it' : 'Enter API key'}
                    spellCheck={false}
                    autoComplete="new-password"
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                  />
                  <button type="button" title={showApiKey ? 'Hide new credential' : 'Show new credential'} aria-label={showApiKey ? 'Hide new credential' : 'Show new credential'} onClick={() => setShowApiKey((current) => !current)}>
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <div className="provider-status-actions">
                  <span className={selected.hasApiKey ? 'badge-enabled' : 'badge-disabled'}>{selected.hasApiKey ? 'Credential stored' : 'No stored credential'}</span>
                  <button type="button" className="toggle-button" disabled={!apiKeyDraft.trim() || savingCredential} onClick={() => void saveCredential()}>{selected.hasApiKey ? 'Replace key' : 'Save key'}</button>
                  {selected.hasApiKey ? <button type="button" className="toggle-button" disabled={savingCredential} onClick={() => void clearCredential()}>Clear key</button> : null}
                </div>
                <span className="settings-path">Stored credentials are write-only from this screen. React receives only whether a credential exists; the key value remains in the trusted main process and OS-backed secure storage.</span>
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
                  ) : <span className="model-name">{model.id}</span>}
                  <div className="model-item-actions">
                    {editingContextModelId === model.id ? (
                      <input
                        className="model-name-input"
                        aria-label={`Context window for ${model.id}`}
                        value={contextDraft}
                        autoFocus
                        onChange={(event) => setContextDraft(event.target.value)}
                        onBlur={commitContextEdit}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitContextEdit()
                          if (event.key === 'Escape') setEditingContextModelId(null)
                        }}
                      />
                    ) : <span className="model-context">{model.context}</span>}
                    <button className="icon-button-mini" title="Edit model context" aria-label={`Edit context of ${model.id}`} onClick={() => { setContextDraft(model.context); setEditingContextModelId(model.id) }}><PlugIcon /></button>
                    <button className="icon-button-mini" title="Edit model id" aria-label={`Edit model ${model.id}`} onClick={() => { setModelDraft(model.id); setEditingModelId(model.id) }}><PencilIcon /></button>
                    <button className="icon-button-mini danger" title="Delete model" aria-label={`Delete model ${model.id}`} onClick={() => removeModel(model.id)}><TrashIcon /></button>
                  </div>
                </div>
              ))}
              <button className="add-model" onClick={addModel}><PlusIcon />Add model</button>
            </div>
          </div>
        ) : (
          <div className="provider-card provider-card-empty"><p>No providers yet. Use “Add provider” to create one.</p></div>
        )}
      </div>
    </section>
  )
}

function ProviderItem({ provider, selected, onSelect }: { provider: ModelProvider; selected: boolean; onSelect(): void }) {
  return (
    <button className={`provider-item ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <BoxIcon />
      <span className="provider-name">{provider.name}</span>
      <span className={`provider-dot ${provider.enabled ? 'on' : ''}`} title={provider.enabled ? 'Active' : 'Disabled'} />
    </button>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
