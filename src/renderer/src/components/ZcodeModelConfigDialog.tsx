import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  formatModelReference,
  parseModelReference,
  validateZcodeCliConfigUpdate,
  ZCODE_PROVIDER_KINDS,
  type ZcodeCliConfigSnapshot,
  type ZcodeCliConfigUpdate,
  type ZcodeProviderKind,
  type ZcodeProviderModelSpec,
  type ZcodeProviderUpdate,
} from '../../../shared/zcode-config'
import { cn } from '../lib/utils'
import { CheckIcon, CloseIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from './Icons'

/**
 * ND's GUI for the ZCode CLI model-provider config (`~/.zcode/cli/config.json`).
 *
 * Inspired by Orca's local-LLM provider setup: pick a provider preset, paste a
 * Base URL and API key, list models, and pick the default route — no
 * hand-written JSON. The write itself is guarded by the shared validator and
 * the main-process writer, which preserves every config key ND does not own.
 */

interface ProviderPreset {
  id: string
  label: string
  kind: ZcodeProviderKind
  baseURL: string
  name: string
  /** Starter model row; always editable before saving. */
  model?: string
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'zai', label: 'Z.ai (GLM)', kind: 'anthropic', baseURL: 'https://api.z.ai/api/anthropic', name: 'Z.ai', model: 'glm-5.3' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai-compatible', baseURL: 'https://api.deepseek.com', name: 'DeepSeek', model: 'deepseek-chat' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
  { id: 'ollama', label: 'Ollama (local)', kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1', name: 'Ollama' },
  { id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai-compatible', baseURL: 'http://localhost:1234/v1', name: 'LM Studio' },
]

const KIND_LABELS: Record<ZcodeProviderKind, string> = {
  anthropic: 'Anthropic Messages',
  openai: 'OpenAI (Responses)',
  'openai-compatible': 'OpenAI-compatible',
}

interface ZcodeModelConfigDialogProps {
  open: boolean
  onClose(): void
  /** Fires after a successful save with the refreshed snapshot. */
  onSaved?(snapshot: ZcodeCliConfigSnapshot): void
  /** Surfaced when the dialog itself fails (load/save rejection). */
  onError?(message: string): void
}

interface ProviderDraft extends ZcodeProviderUpdate {
  /** Providers already on disk keep their id fixed; renaming would orphan their credential. */
  fromConfig: boolean
}

export function ZcodeModelConfigDialog({ open, onClose, onSaved, onError }: ZcodeModelConfigDialogProps) {
  const [snapshot, setSnapshot] = useState<ZcodeCliConfigSnapshot | null>(null)
  const [providers, setProviders] = useState<ProviderDraft[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mainModel, setMainModel] = useState('')
  const [liteModel, setLiteModel] = useState('')
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [showKeyDrafts, setShowKeyDrafts] = useState<Record<string, boolean>>({})
  const [clearKeyIds, setClearKeyIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const loadedRef = useRef(false)

  const reset = useCallback(() => {
    setSnapshot(null)
    setProviders([])
    setSelectedId(null)
    setMainModel('')
    setLiteModel('')
    setKeyDrafts({})
    setShowKeyDrafts({})
    setClearKeyIds(new Set())
    setSaving(false)
    setLoadFailed(null)
    setSavedMessage(null)
  }, [])

  useEffect(() => {
    if (!open) {
      loadedRef.current = false
      return
    }
    if (loadedRef.current) return
    loadedRef.current = true
    void (async () => {
      try {
        const fresh = await window.ndDsh.zcodeConfig.read()
        setSnapshot(fresh)
        setProviders(fresh.providers.map((provider) => ({
          id: provider.id,
          kind: provider.kind ?? 'openai-compatible',
          ...(provider.name !== undefined ? { name: provider.name } : {}),
          ...(provider.baseURL !== undefined ? { baseURL: provider.baseURL } : {}),
          models: provider.models.map((model) => ({ ...model })),
          fromConfig: true,
        })))
        setMainModel(fresh.mainModel ?? '')
        setLiteModel(fresh.liteModel ?? '')
        setSelectedId(fresh.providers[0]?.id ?? null)
      } catch (error) {
        setLoadFailed(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, onClose])

  const selected = providers.find((provider) => provider.id === selectedId) ?? null
  const problems = useMemo(() => validateDraft({ providers, mainModel, liteModel }), [providers, mainModel, liteModel])
  const modelOptions = useMemo(() => providers.flatMap((provider) => provider.models.map((model) => ({
    value: formatModelReference(provider.id, model.id),
    label: `${provider.name || provider.id} · ${model.name || model.id}`,
  }))), [providers])

  if (!open) return null

  const updateProvider = (id: string, patch: Partial<ProviderDraft>): void => {
    setProviders((current) => current.map((provider) => (provider.id === id ? { ...provider, ...patch } : provider)))
  }
  const updateModel = (providerId: string, index: number, patch: Partial<ZcodeProviderModelSpec>): void => {
    setProviders((current) => current.map((provider) => (
      provider.id !== providerId ? provider : {
        ...provider,
        models: provider.models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model)),
      }
    )))
  }
  const addModel = (providerId: string): void => {
    setProviders((current) => current.map((provider) => (
      provider.id !== providerId ? provider : { ...provider, models: [...provider.models, { id: '' }] }
    )))
  }
  const removeModel = (providerId: string, index: number): void => {
    setProviders((current) => current.map((provider) => (
      provider.id !== providerId ? provider : { ...provider, models: provider.models.filter((_, modelIndex) => modelIndex !== index) }
    )))
  }

  const addPreset = (preset: ProviderPreset): void => {
    const id = uniqueProviderId(preset.id, providers)
    const draft: ProviderDraft = {
      id,
      kind: preset.kind,
      name: preset.name,
      baseURL: preset.baseURL,
      models: preset.model ? [{ id: preset.model }] : [{ id: '' }],
      fromConfig: false,
    }
    setProviders((current) => [...current, draft])
    setSelectedId(id)
  }
  const addCustom = (): void => {
    const id = uniqueProviderId('custom', providers)
    setProviders((current) => [...current, { id, kind: 'openai-compatible', models: [{ id: '' }], fromConfig: false }])
    setSelectedId(id)
  }
  const removeProvider = (id: string): void => {
    setProviders((current) => current.filter((provider) => provider.id !== id))
    setClearKeyIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    setSelectedId((current) => (current === id ? null : current))
  }

  const save = async (): Promise<void> => {
    if (problems.length > 0 || saving) return
    setSaving(true)
    setSavedMessage(null)
    const update: ZcodeCliConfigUpdate = {
      providers: providers.map((provider) => {
        const keyDraft = keyDrafts[provider.id]?.trim()
        return {
          id: provider.id,
          kind: provider.kind,
          ...(provider.name?.trim() ? { name: provider.name.trim() } : {}),
          ...(provider.baseURL?.trim() ? { baseURL: provider.baseURL.trim() } : {}),
          ...(keyDraft ? { apiKey: keyDraft } : {}),
          ...(clearKeyIds.has(provider.id) ? { clearApiKey: true } : {}),
          models: provider.models.map((model) => ({
            id: model.id.trim(),
            ...(model.name?.trim() ? { name: model.name.trim() } : {}),
            ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
            ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
          })),
        }
      }),
      ...(parseModelReference(mainModel) ? { mainModel } : {}),
      ...(parseModelReference(liteModel) ? { liteModel } : {}),
    }
    try {
      const fresh = await window.ndDsh.zcodeConfig.write(update)
      setSnapshot(fresh)
      setSavedMessage(`Saved to ${fresh.path}. ZCode picks the new provider up on the next message.`)
      onSaved?.(fresh)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSavedMessage(null)
      onError?.(message)
      setLoadFailed(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[220] grid place-items-center bg-black/55 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ZCode model providers"
      onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}
      onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose() }}
    >
      <div className="flex max-h-[86vh] w-[680px] max-w-full flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface-2 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <header className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-[13px] font-semibold text-foreground">ZCode model providers</h2>
            <p className="m-0 truncate font-mono text-[9px] text-fainter" title={snapshot?.path ?? undefined}>
              {snapshot?.path ?? '…/.zcode/cli/config.json'}
            </p>
          </div>
          <button
            type="button"
            className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-accent hover:text-foreground"
            onClick={onClose}
            disabled={saving}
            title="Close"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[190px] shrink-0 flex-col overflow-y-auto border-r border-border-soft p-2">
            <div className="px-1.5 pb-1 pt-0.5 text-[8px] font-semibold uppercase tracking-[0.11em] text-fainter">Providers</div>
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={cn(
                  'mb-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                  provider.id === selectedId ? 'bg-accent text-foreground' : 'text-soft hover:bg-accent/60 hover:text-foreground',
                )}
                onClick={() => setSelectedId(provider.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium">{provider.name || provider.id}</span>
                  <span className="block truncate font-mono text-[8px] text-fainter">{provider.id}</span>
                </span>
                {mainModel.startsWith(`${provider.id}/`) ? <CheckIcon className="size-3 shrink-0 text-primary" /> : null}
              </button>
            ))}
            {providers.length === 0 ? (
              <p className="m-0 px-1.5 py-1 text-[10px]/[1.5] text-faint">No providers yet. Start from a preset or add a custom endpoint.</p>
            ) : null}
            <div className="mt-2 border-t border-border-soft pt-2">
              <div className="px-1.5 pb-1 text-[8px] font-semibold uppercase tracking-[0.11em] text-fainter">Add</div>
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => addPreset(preset)}
                  title={`Add ${preset.label} (${preset.baseURL})`}
                >
                  <PlusIcon className="size-3 shrink-0 text-faint" />
                  <span className="truncate">{preset.label}</span>
                </button>
              ))}
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-[11px] text-soft transition-colors hover:bg-accent hover:text-foreground"
                onClick={addCustom}
              >
                <PlusIcon className="size-3 shrink-0 text-faint" />
                <span>Custom endpoint…</span>
              </button>
            </div>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto p-3.5">
            {loadFailed ? (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-[11px]/[1.5] text-destructive">{loadFailed}</div>
            ) : null}
            {snapshot?.parseError ? (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/[0.08] px-3 py-2 text-[11px]/[1.5] text-destructive">
                The config file is not valid JSON, so ND will not overwrite it. Fix or remove the file manually, then reload this dialog.
              </div>
            ) : null}
            {savedMessage ? (
              <div className="mb-3 rounded-lg border border-primary/30 bg-primary/[0.08] px-3 py-2 text-[11px]/[1.5] text-primary">{savedMessage}</div>
            ) : null}

            {selected ? (
              <ProviderForm
                key={selected.id}
                provider={selected}
                keyDraft={keyDrafts[selected.id] ?? ''}
                keyDraftVisible={showKeyDrafts[selected.id] === true}
                clearKey={clearKeyIds.has(selected.id)}
                storedKeyHint={snapshot?.providers.find((provider) => provider.id === selected.id)?.apiKeyHint}
                onProviderChange={(patch) => updateProvider(selected.id, patch)}
                onModelChange={(index, patch) => updateModel(selected.id, index, patch)}
                onAddModel={() => addModel(selected.id)}
                onRemoveModel={(index) => removeModel(selected.id, index)}
                onRemoveProvider={() => removeProvider(selected.id)}
                onKeyDraftChange={(value) => setKeyDrafts((current) => ({ ...current, [selected.id]: value }))}
                onToggleKeyVisible={() => setShowKeyDrafts((current) => ({ ...current, [selected.id]: !current[selected.id] }))}
                onToggleClearKey={() => setClearKeyIds((current) => {
                  const next = new Set(current)
                  if (next.has(selected.id)) next.delete(selected.id)
                  else next.add(selected.id)
                  return next
                })}
                canRemove={providers.length > 0}
              />
            ) : (
              <p className="m-0 py-6 text-center text-[11px] text-faint">Select a provider, or add one from the presets on the left.</p>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-border-soft px-4 py-3">
          <label className="flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
            <span className="shrink-0">Default model</span>
            <select
              className="h-7 min-w-0 max-w-[190px] rounded-md border border-border-soft bg-secondary px-1.5 font-mono text-[10px] text-soft outline-none focus:border-primary/50"
              value={mainModel}
              onChange={(event) => setMainModel(event.target.value)}
            >
              <option value="">ZCode native default</option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.value}</option>
              ))}
            </select>
          </label>
          {parseModelReference(mainModel) ? (
            <label className="flex min-w-0 items-center gap-1.5 text-[10px] text-faint">
              <span className="shrink-0">Lite</span>
              <select
                className="h-7 min-w-0 max-w-[170px] rounded-md border border-border-soft bg-secondary px-1.5 font-mono text-[10px] text-soft outline-none focus:border-primary/50"
                value={liteModel}
                onChange={(event) => setLiteModel(event.target.value)}
              >
                <option value="">None</option>
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.value}</option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {problems.length > 0 && !savedMessage ? (
              <span className="max-w-[280px] truncate text-[10px] text-destructive" title={problems.join('\n')}>{problems[0]}</span>
            ) : null}
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onClose}
              disabled={saving}
            >
              Close
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => void save()}
              disabled={saving || problems.length > 0 || snapshot === null || (snapshot.parseError !== undefined)}
            >
              {saving ? 'Saving…' : 'Save providers'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function ProviderForm({ provider, keyDraft, keyDraftVisible, clearKey, storedKeyHint, onProviderChange, onModelChange, onAddModel, onRemoveModel, onRemoveProvider, onKeyDraftChange, onToggleKeyVisible, onToggleClearKey, canRemove }: {
  provider: ProviderDraft
  keyDraft: string
  keyDraftVisible: boolean
  clearKey: boolean
  storedKeyHint?: string | undefined
  onProviderChange(patch: Partial<ProviderDraft>): void
  onModelChange(index: number, patch: Partial<ZcodeProviderModelSpec>): void
  onAddModel(): void
  onRemoveModel(index: number): void
  onRemoveProvider(): void
  onKeyDraftChange(value: string): void
  onToggleKeyVisible(): void
  onToggleClearKey(): void
  canRemove: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_170px] gap-2.5">
        <Field label={provider.fromConfig ? 'Provider id (fixed)' : 'Provider id'}>
          <input
            value={provider.id}
            disabled={provider.fromConfig}
            onChange={(event) => onProviderChange({ id: event.target.value.trim() })}
            className={fieldClass}
            placeholder="my-provider"
            spellCheck={false}
          />
        </Field>
        <Field label="API kind">
          <select
            className={cn(fieldClass, 'appearance-none')}
            value={provider.kind}
            onChange={(event) => onProviderChange({ kind: event.target.value as ZcodeProviderKind })}
          >
            {ZCODE_PROVIDER_KINDS.map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Display name">
          <input
            value={provider.name ?? ''}
            onChange={(event) => onProviderChange({ name: event.target.value })}
            className={fieldClass}
            placeholder="Optional"
            spellCheck={false}
          />
        </Field>
        <Field label="Base URL">
          <input
            value={provider.baseURL ?? ''}
            onChange={(event) => onProviderChange({ baseURL: event.target.value })}
            className={cn(fieldClass, 'font-mono text-[11px]')}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
          />
        </Field>
      </div>
      <Field label="API key">
        <div className="flex items-center gap-1.5">
          <input
            type={keyDraftVisible ? 'text' : 'password'}
            value={keyDraft}
            onChange={(event) => onKeyDraftChange(event.target.value)}
            className={cn(fieldClass, 'font-mono text-[11px]')}
            placeholder={clearKey ? 'Key will be removed' : storedKeyHint ? `Stored ${storedKeyHint} — leave empty to keep` : 'Paste the provider API key'}
            spellCheck={false}
            autoComplete="off"
          />
          {keyDraft || storedKeyHint ? (
            <button
              type="button"
              className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-accent hover:text-foreground"
              onClick={onToggleKeyVisible}
              title={keyDraftVisible ? 'Hide key' : 'Show key'}
            >
              {keyDraftVisible ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
            </button>
          ) : null}
          {storedKeyHint ? (
            <button
              type="button"
              className={cn(
                'shrink-0 rounded-md border px-2 py-1 text-[9px] font-medium transition-colors',
                clearKey ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={onToggleClearKey}
              title={clearKey ? 'Keep the stored key' : 'Remove the stored key on save'}
            >
              {clearKey ? 'Keep key' : 'Clear key'}
            </button>
          ) : null}
        </div>
      </Field>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground">Models</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onAddModel}
          >
            <PlusIcon className="size-2.5" /> Add model
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {provider.models.map((model, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                value={model.id}
                onChange={(event) => onModelChange(index, { id: event.target.value })}
                className={cn(fieldClass, 'w-[150px] shrink-0 font-mono text-[11px]')}
                placeholder="model-id"
                spellCheck={false}
              />
              <input
                value={model.name ?? ''}
                onChange={(event) => onModelChange(index, { name: event.target.value })}
                className={cn(fieldClass, 'w-[110px] shrink-0')}
                placeholder="Label"
              />
              <input
                value={model.contextWindow?.toString() ?? ''}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  onModelChange(index, Number.isFinite(parsed) && parsed > 0 ? { contextWindow: parsed } : {})
                }}
                className={cn(fieldClass, 'min-w-0 flex-1 font-mono text-[11px]')}
                placeholder="Context window (optional)"
                inputMode="numeric"
              />
              <button
                type="button"
                className="grid size-7 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onRemoveModel(index)}
                title="Remove model"
              >
                <TrashIcon className="size-3" />
              </button>
            </div>
          ))}
          {provider.models.length === 0 ? (
            <p className="m-0 text-[10px]/[1.4] text-faint">Add at least one model id so ZCode can route to this provider.</p>
          ) : null}
        </div>
      </div>

      {canRemove ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            onClick={onRemoveProvider}
            title="Remove this provider from the ZCode config on save"
          >
            <TrashIcon className="size-3" /> Remove provider
          </button>
        </div>
      ) : null}
    </div>
  )
}

const fieldClass = 'h-8 w-full rounded-md border border-border-soft bg-secondary px-2 text-[11px] text-soft outline-none transition-colors placeholder:text-fainter focus:border-primary/50 disabled:opacity-50'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-fainter">{label}</span>
      {children}
    </label>
  )
}

function uniqueProviderId(base: string, providers: ProviderDraft[]): string {
  let candidate = base
  let counter = 2
  while (providers.some((provider) => provider.id === candidate)) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  return candidate
}

function validateDraft(draft: { providers: ProviderDraft[]; mainModel: string; liteModel: string }): string[] {
  return validateZcodeCliConfigUpdate({
    providers: draft.providers,
    ...(parseModelReference(draft.mainModel) ? { mainModel: draft.mainModel } : {}),
    ...(parseModelReference(draft.liteModel) ? { liteModel: draft.liteModel } : {}),
  })
}
