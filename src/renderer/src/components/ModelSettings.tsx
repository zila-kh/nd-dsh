import { useEffect, useState, type FormEvent } from 'react'
import type { ModelProvider, ProviderPingResult } from '../../../shared/contracts'
import { BoxIcon, CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, PlugIcon, PlusIcon, RotateIcon, TrashIcon } from './Icons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { cn } from '../lib/utils'

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

const miniIconButton = cn(
  'grid size-[26px] shrink-0 place-items-center rounded-[5px] text-(--models-faint) transition-colors',
  'hover:bg-(--models-field) hover:text-(--models-text) [&_svg]:size-3.5',
)

const pillBadge = (enabled: boolean | undefined): string =>
  cn(
    'rounded-full border px-[9px] py-[3px] text-[11px] font-semibold',
    enabled
      ? 'border-[rgba(34,197,94,0.35)] bg-(--models-green-soft) text-(--models-green)'
      : 'border-(--models-border-2) bg-(--models-field) text-(--models-faint)',
  )

const scopeButton = cn(
  'rounded-md border border-(--models-border-2) bg-(--models-field) px-2.5 py-1 text-[11px] text-(--models-muted) transition-colors',
  'hover:text-(--models-text) disabled:pointer-events-none disabled:opacity-45',
)

const PING_RESULT_COLORS: Record<ProviderPingResult['state'], string> = {
  ok: 'text-green-400',
  auth: 'text-amber-500',
  unreachable: 'text-red-400',
}

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
  // Per-model ping state: modelId → 'testing' | ProviderPingResult
  const [modelPings, setModelPings] = useState<Record<string, 'testing' | ProviderPingResult>>({})

  // Clear per-model pings when the selected provider changes.
  useEffect(() => {
    setModelPings({})
  }, [selectedId])

  useEffect(() => {
    let mounted = true
    const load = (): void => {
      void window.ndDsh.providers
        .list()
        .then((loaded) => {
          if (!mounted) return
          setProviders(loaded)
          setSelectedId((current) => (loaded.some((provider) => provider.id === current) ? current : (loaded[0]?.id ?? '')))
        })
        .catch((cause) => onError(errorMessage(cause)))
    }
    load()
    const unsubscribe = window.ndDsh.providers.onChanged(() => {
      if (mounted) load()
    })
    return () => {
      mounted = false
      unsubscribe()
    }
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

  /** Probe the provider endpoint on behalf of a specific model row. */
  const testModel = async (modelId: string): Promise<void> => {
    if (!selected || modelPings[modelId] === 'testing') return
    setModelPings((current) => ({ ...current, [modelId]: 'testing' }))
    try {
      const result = await window.ndDsh.providers.ping(selected.id, true)
      setModelPings((current) => ({ ...current, [modelId]: result }))
    } catch (cause) {
      onError(errorMessage(cause))
      setModelPings((current) => {
        const next = { ...current }
        delete next[modelId]
        return next
      })
    }
  }

  const pingLabel = (ping: ProviderPingResult): string => {
    if (ping.state === 'ok') return `Online · ${ping.latencyMs ?? '?'}ms${ping.status !== undefined ? ` · HTTP ${ping.status}` : ''}`
    if (ping.state === 'auth') return `Reachable · credential rejected${ping.status !== undefined ? ` · HTTP ${ping.status}` : ''}`
    return 'No answer · timeout or network error'
  }

  return (
    <section className="models-scope grid h-full w-full grid-rows-[auto_minmax(0,1fr)] min-h-0 bg-(--models-bg) text-(--models-text)" aria-label="Model settings">
      <header className="flex items-start justify-between gap-3.5 px-6 pb-3 pt-[18px]">
        <div>
          <h2 className="m-0 text-xl font-semibold tracking-tight">Model settings</h2>
          <p className="mb-0 mt-1 text-xs/[1.5] text-(--models-muted)">Configure model-provider routes independently from coding engines. Enabled routes become available to ND Harness sessions on the next prompt.</p>
        </div>
        <button
          className="grid size-[30px] shrink-0 place-items-center rounded-[7px] text-(--models-muted) transition-colors hover:bg-(--models-field) hover:text-(--models-text) [&_svg]:size-[15px]"
          title="Reload providers from storage"
          aria-label="Refresh model settings"
          onClick={() => void refresh()}
        >
          <RotateIcon />
        </button>
      </header>

      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-4 px-6 pb-6">
        <aside className="flex min-h-0 flex-col overflow-auto" aria-label="Providers">
          <div className="px-1.5 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-(--models-faint)">Providers</div>
          {providers.map((provider) => (
            <ProviderItem key={provider.id} provider={provider} selected={provider.id === selectedId} onSelect={() => setSelectedId(provider.id)} />
          ))}
          <button className="mt-2.5 flex items-center gap-[7px] rounded-md px-[9px] py-1.5 text-left text-[12px] text-(--models-muted) transition-colors hover:text-(--models-text) [&_svg]:size-3.5" onClick={addProvider}>
            <PlusIcon />Add provider
          </button>
        </aside>

        {selected ? (
          <div className="flex min-h-0 flex-col rounded-[14px] border border-(--models-border) bg-(--models-surface) p-[22px]">
            <header className="mb-[18px] flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {renamingProvider ? (
                  <input
                    className="h-7 w-40 rounded-md border border-(--models-border-2) bg-(--models-field) px-2 text-sm text-(--models-text) outline-none"
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
                    <h3 className="m-0 truncate text-[17px] font-semibold">{selected.name}</h3>
                    <button className={miniIconButton} title="Rename provider" aria-label="Rename provider" onClick={() => { setNameDraft(selected.name); setRenamingProvider(true) }}>
                      <PencilIcon />
                    </button>
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={pillBadge(selected.enabled)}>{selected.enabled ? 'Enabled' : 'Disabled'}</span>
                <button type="button" className={scopeButton} onClick={() => updateSelected({ enabled: !selected.enabled })}>{selected.enabled ? 'Disable' : 'Enable'}</button>
                <button type="button" className={scopeButton} disabled={testing} onClick={() => void testConnection()}>{testing ? 'Testing…' : 'Test connection'}</button>
                {pingResult ? <span className={cn('shrink-0 text-[10px] font-semibold', PING_RESULT_COLORS[pingResult.state])}>{pingLabel(pingResult)}</span> : null}
                <button className={cn(miniIconButton, 'hover:text-destructive')} title="Delete provider" aria-label="Delete provider" onClick={() => removeProvider(selected.id)}><TrashIcon /></button>
              </div>
            </header>

            <form className="flex flex-col gap-[13px]" onSubmit={(event: FormEvent) => event.preventDefault()}>
              <div className="flex flex-col gap-[5px]">
                <label htmlFor="provider-base-url" className="text-[11px] font-medium text-(--models-muted)">Base URL</label>
                <input
                  id="provider-base-url"
                  value={selected.baseUrl}
                  placeholder="Leave blank for a provider-native catalog endpoint"
                  spellCheck={false}
                  onChange={(event) => updateSelected({ baseUrl: event.target.value })}
                  className="h-8 rounded-[7px] border border-(--models-border) bg-(--models-field) px-2.5 text-[12px] text-(--models-text) outline-none"
                />
              </div>
              <div className="flex flex-col gap-[5px]">
                <label htmlFor="provider-api-format" className="text-[11px] font-medium text-(--models-muted)">API format</label>
                <Select value={selected.apiFormat} onValueChange={(value) => updateSelected({ apiFormat: value })}>
                  <SelectTrigger id="provider-api-format" className="h-8 w-full rounded-[7px] border-(--models-border) bg-(--models-field) px-2.5 text-[12px] text-(--models-text)">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_FORMATS.includes(selected.apiFormat) ? null : <SelectItem value={selected.apiFormat}>{selected.apiFormat}</SelectItem>}
                    {API_FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="max-w-[300px] truncate text-[10px]/[1.45] text-(--models-muted)">Native/catalog mode lets the runtime use a known provider's own protocol and ambient authentication. Custom gateways can use OpenAI Completions, OpenAI Responses, or Anthropic Messages.</span>
              </div>
              <div className="flex flex-col gap-[5px]">
                <label htmlFor="provider-api-key" className="text-[11px] font-medium text-(--models-muted)">Credential</label>
                <div className="relative flex items-center">
                  <input
                    id="provider-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyDraft}
                    placeholder={selected.hasApiKey ? 'Credential stored — enter a new key to replace it' : 'Enter API key'}
                    spellCheck={false}
                    autoComplete="new-password"
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                    className="h-8 w-full rounded-[7px] border border-(--models-border) bg-(--models-field) px-2.5 pr-[34px] text-[12px] text-(--models-text) outline-none"
                  />
                  <button
                    type="button"
                    title={showApiKey ? 'Hide new credential' : 'Show new credential'}
                    aria-label={showApiKey ? 'Hide new credential' : 'Show new credential'}
                    onClick={() => setShowApiKey((current) => !current)}
                    className="absolute right-1 grid size-[26px] place-items-center rounded-[5px] text-(--models-faint) transition-colors hover:text-(--models-text) [&_svg]:size-3.5"
                  >
                    {showApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={pillBadge(selected.hasApiKey)}>{selected.hasApiKey ? 'Credential stored' : 'No stored credential'}</span>
                  <button type="button" className={scopeButton} disabled={!apiKeyDraft.trim() || savingCredential} onClick={() => void saveCredential()}>{selected.hasApiKey ? 'Replace key' : 'Save key'}</button>
                  {selected.hasApiKey ? <button type="button" className={scopeButton} disabled={savingCredential} onClick={() => void clearCredential()}>Clear key</button> : null}
                </div>
                <span className="max-w-[300px] truncate text-[10px]/[1.45] text-(--models-muted)">Stored credentials are write-only from this screen. React receives only whether a credential exists; the key value remains in the trusted main process and OS-backed secure storage.</span>
              </div>
            </form>

            <div className="mt-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-(--models-muted)">Model list</div>
              <div className="space-y-1.5">
                {selected.models.map((model) => {
                  const modelPing = modelPings[model.id]
                  const isTesting = modelPing === 'testing'
                  const pingRes = modelPing !== undefined && modelPing !== 'testing' ? modelPing : null
                  return (
                  <div className="flex items-center justify-between gap-2.5 rounded-[9px] border border-(--models-border) bg-(--models-bg) px-3 py-[9px]" key={model.id}>
                    {editingModelId === model.id ? (
                      <input
                        className="h-[26px] w-[200px] rounded-md border border-(--models-border-2) bg-(--models-field) px-2 font-mono text-[12px] text-(--models-text) outline-none"
                        value={modelDraft}
                        autoFocus
                        onChange={(event) => setModelDraft(event.target.value)}
                        onBlur={commitModelRename}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitModelRename()
                          if (event.key === 'Escape') setEditingModelId(null)
                        }}
                      />
                    ) : <span className="min-w-0 truncate font-mono text-[12px]">{model.id}</span>}
                    <div className="flex shrink-0 items-center gap-0.5">
                      {/* Per-model ping result badge */}
                      {pingRes ? (
                        <span
                          className={cn(
                            'mr-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                            pingRes.state === 'ok' && 'bg-green-500/15 text-green-400',
                            pingRes.state === 'auth' && 'bg-amber-500/15 text-amber-400',
                            pingRes.state === 'unreachable' && 'bg-red-500/15 text-red-400',
                          )}
                          title={pingLabel(pingRes)}
                        >
                          {pingRes.state === 'ok'
                            ? `✓ ${pingRes.latencyMs ?? '?'}ms`
                            : pingRes.state === 'auth'
                              ? '✗ Auth'
                              : '✗ Offline'}
                        </span>
                      ) : null}
                      {editingContextModelId === model.id ? (
                        <input
                          className="h-[26px] w-[200px] rounded-md border border-(--models-border-2) bg-(--models-field) px-2 font-mono text-[12px] text-(--models-text) outline-none"
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
                      ) : <span className="rounded-full bg-(--models-field) px-2 py-0.5 text-[11px] text-(--models-muted)">{model.context}</span>}
                      {/* Test this model's provider connection */}
                      <button
                        className={cn(miniIconButton, isTesting && 'text-(--models-green) opacity-70')}
                        title={`Test connection for ${model.id}`}
                        aria-label={`Test connection for model ${model.id}`}
                        disabled={isTesting}
                        onClick={() => void testModel(model.id)}
                      >
                        {isTesting
                          ? <RotateIcon className="animate-spin" />
                          : pingRes?.state === 'ok'
                            ? <CheckIcon />
                            : <RotateIcon />}
                      </button>
                      <button className={miniIconButton} title="Edit model context" aria-label={`Edit context of ${model.id}`} onClick={() => { setContextDraft(model.context); setEditingContextModelId(model.id) }}><PlugIcon /></button>
                      <button className={miniIconButton} title="Edit model id" aria-label={`Edit model ${model.id}`} onClick={() => { setModelDraft(model.id); setEditingModelId(model.id) }}><PencilIcon /></button>
                      <button className={cn(miniIconButton, 'hover:text-destructive')} title="Delete model" aria-label={`Delete model ${model.id}`} onClick={() => removeModel(model.id)}><TrashIcon /></button>
                    </div>
                  </div>
                  )
                })}
              </div>
              <button className="mt-2.5 flex items-center gap-[7px] rounded-[9px] border border-(--models-border-2) bg-(--models-field) px-3 py-[7px] text-[12px] text-(--models-muted) transition-colors hover:text-(--models-text) [&_svg]:size-3.5" onClick={addModel}>
                <PlusIcon />Add model
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col items-center justify-center rounded-[14px] border border-(--models-border) bg-(--models-surface) p-[22px] text-center text-[12px] text-(--models-faint)">
            <p>No providers yet. Use “Add provider” to create one.</p>
          </div>
        )}
      </div>
    </section>
  )
}

function ProviderItem({ provider, selected, onSelect }: { provider: ModelProvider; selected: boolean; onSelect(): void }) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-[9px] rounded-[7px] px-[9px] py-[7px] text-left text-[13px] text-(--models-text) transition-colors hover:bg-(--models-surface-3) [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-(--models-muted)',
        selected && 'bg-(--models-surface-3) shadow-[inset_0_0_0_1px_var(--models-border-2)]',
      )}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <BoxIcon />
      <span className="min-w-0 flex-1 truncate">{provider.name}</span>
      <span className={cn('size-[7px] shrink-0 rounded-full bg-(--models-faint)', provider.enabled && 'bg-(--models-green)')} title={provider.enabled ? 'Active' : 'Disabled'} />
    </button>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
