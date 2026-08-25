import { useEffect, useMemo, useState } from 'react'
import type { CodingEngineDescriptor, ModelProvider } from '../../../shared/contracts'
import {
  AGENT_EXTENSION_SURFACES,
  EXTENSION_ADAPTERS,
  resolveExtensionRoute,
  type AgentExtensionManifest,
  type AgentExtensionSurface,
  type ExtensionAdapter,
  type ExtensionDemoResult,
} from '../../../shared/extensions'
import { cn } from '../lib/utils'
import { SettingsButton, SettingsRow, SettingsSection, StatusChip, rowDesc, rowPathText, rowStack, rowTitle } from './settings-primitives'

const SURFACE_LABEL: Record<AgentExtensionSurface, string> = {
  memory: 'Memory',
  subagent: 'Subagents',
  plugin: 'Plugins',
  mcp: 'MCP Servers',
  skill: 'Skills',
  command: 'Commands',
  hook: 'Hooks',
}

interface DetailDraft {
  name: string
  description: string
  version: string
  instructions: string
}

export function ExtensionSettings({ onError }: { onError(message: string): void }) {
  const [extensions, setExtensions] = useState<AgentExtensionManifest[]>([])
  const [engines, setEngines] = useState<CodingEngineDescriptor[]>([])
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [surface, setSurface] = useState<AgentExtensionSurface>('plugin')
  const [selectedId, setSelectedId] = useState<string>('demo-counter-plugin')
  const [busy, setBusy] = useState<string | null>('load')
  const [demoEngineId, setDemoEngineId] = useState('')
  const [demoProviderId, setDemoProviderId] = useState('')
  const [demoResult, setDemoResult] = useState<ExtensionDemoResult | null>(null)
  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null)

  useEffect(() => {
    let mounted = true
    void Promise.all([window.ndDshExtensions.list(), window.ndDsh.engines.list(), window.ndDsh.providers.list()])
      .then(([extensionItems, engineItems, providerItems]) => {
        if (!mounted) return
        setExtensions(extensionItems)
        setEngines(engineItems)
        setProviders(providerItems)
        setDemoEngineId(engineItems.find((item) => item.available)?.id ?? engineItems[0]?.id ?? '')
        setDemoProviderId(providerItems.find((item) => item.enabled)?.id ?? '')
      })
      .catch((cause) => onError(errorMessage(cause)))
      .finally(() => { if (mounted) setBusy(null) })
    const offExtensions = window.ndDshExtensions.onChanged((items) => { if (mounted) setExtensions(items) })
    const offProviders = window.ndDsh.providers.onChanged((items) => { if (mounted) setProviders(items) })
    return () => {
      mounted = false
      offExtensions()
      offProviders()
    }
  }, [onError])

  const visible = useMemo(() => extensions.filter((item) => item.surface === surface), [extensions, surface])
  const selected = extensions.find((item) => item.id === selectedId) ?? visible[0]

  useEffect(() => {
    if (!selected) {
      setDetailDraft(null)
      return
    }
    setDetailDraft({
      name: selected.name,
      description: selected.description,
      version: selected.version,
      instructions: selected.instructions ?? '',
    })
    setDemoResult(null)
  }, [selected?.id])

  const persist = async (next: AgentExtensionManifest, label = 'save'): Promise<void> => {
    if (busy) return
    setBusy(`${label}-${next.id}`)
    try {
      const items = await window.ndDshExtensions.save(next)
      setExtensions(items)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const setEngineRoute = (extension: AgentExtensionManifest, engineId: string, adapter: ExtensionAdapter): void => {
    void persist({
      ...extension,
      engineRoutes: [
        ...extension.engineRoutes.filter((route) => route.engineId !== engineId),
        ...(adapter === 'auto' ? [] : [{ engineId, adapter }]),
      ],
    }, 'route')
  }

  const toggleProvider = (extension: AgentExtensionManifest, providerId: string, enabled: boolean): void => {
    const current = new Map<string, boolean>()
    if (extension.providerRoutes.length === 0) {
      // Moving away from Allow all must preserve every other provider's
      // current enabled state rather than accidentally denying the rest.
      for (const provider of providers) current.set(provider.id, provider.enabled)
    } else {
      for (const route of extension.providerRoutes) current.set(route.providerId, route.enabled)
    }
    current.set(providerId, enabled)
    void persist({
      ...extension,
      providerRoutes: [...current.entries()].map(([id, value]) => ({ providerId: id, enabled: value })),
    }, 'provider')
  }

  const allowAllProviders = (extension: AgentExtensionManifest): void => {
    void persist({ ...extension, providerRoutes: [] }, 'provider')
  }

  const reset = async (): Promise<void> => {
    if (busy) return
    setBusy('reset')
    try {
      const items = await window.ndDshExtensions.resetDemos()
      setExtensions(items)
      setSurface('plugin')
      setSelectedId('demo-counter-plugin')
      setDemoResult(null)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const addExtension = async (): Promise<void> => {
    if (busy) return
    const id = `custom-${surface}-${Date.now().toString(36)}`
    const manifest: AgentExtensionManifest = {
      id,
      name: `New ${SURFACE_LABEL[surface].replace(/s$/, '')}`,
      description: `Custom ${SURFACE_LABEL[surface].toLowerCase()} extension managed by ND.`,
      surface,
      version: '1.0.0',
      enabled: false,
      instructions: '',
      engineRoutes: [],
      providerRoutes: [],
    }
    setBusy('add')
    try {
      setExtensions(await window.ndDshExtensions.save(manifest))
      setSelectedId(id)
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const deleteSelected = async (): Promise<void> => {
    if (!selected || selected.builtInDemo || busy) return
    setBusy(`delete-${selected.id}`)
    try {
      const items = await window.ndDshExtensions.remove(selected.id)
      setExtensions(items)
      const next = items.find((item) => item.surface === surface)
      setSelectedId(next?.id ?? '')
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const saveDetails = (): void => {
    if (!selected || !detailDraft) return
    void persist({
      ...selected,
      name: detailDraft.name,
      description: detailDraft.description,
      version: detailDraft.version,
      instructions: detailDraft.instructions,
    }, 'details')
  }

  const runDemo = async (): Promise<void> => {
    if (!selected?.builtInDemo || busy) return
    setBusy(`demo-${selected.id}`)
    try {
      setDemoResult(await window.ndDshExtensions.runDemo(
        selected.id,
        demoEngineId || undefined,
        demoProviderId || undefined,
      ))
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
      <aside className="min-h-0 overflow-auto border-r border-border-soft bg-secondary/20 px-3 py-4">
        <div className="mb-3 px-1">
          <strong className="block text-xs text-strong">Agent capabilities</strong>
          <span className="mt-1 block text-[10px] leading-4 text-faint">Configure once in ND. The compatibility router maps each capability onto ND Harness, delegated Codex, direct Codex, and future engines.</span>
        </div>
        <div className="space-y-1">
          {AGENT_EXTENSION_SURFACES.map((item) => {
            const count = extensions.filter((extension) => extension.surface === item).length
            return (
              <button
                key={item}
                className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-xs', surface === item ? 'bg-primary/10 text-primary' : 'text-soft hover:bg-accent')}
                onClick={() => {
                  setSurface(item)
                  const first = extensions.find((extension) => extension.surface === item)
                  setSelectedId(first?.id ?? '')
                }}
              >
                <span>{SURFACE_LABEL[item]}</span>
                <span className="text-[9px] text-faint">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-4 space-y-2 border-t border-border-soft pt-3">
          <SettingsButton disabled={Boolean(busy)} onClick={() => void addExtension()}>Add {SURFACE_LABEL[surface].replace(/s$/, '')}</SettingsButton>
          <SettingsButton disabled={Boolean(busy)} onClick={() => void reset()}>Reset demo pack</SettingsButton>
        </div>
      </aside>

      <main className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-4">
        <SettingsSection title={SURFACE_LABEL[surface]}>
          <div className="space-y-1.5">
            {busy === 'load' ? <SettingsRow><span className={rowDesc}>Loading extension catalog…</span></SettingsRow> : null}
            {visible.map((extension) => (
              <button
                key={extension.id}
                className={cn('w-full rounded-lg border p-3 text-left transition-colors', selected?.id === extension.id ? 'border-primary/40 bg-primary/[0.04]' : 'border-border-soft bg-secondary/15 hover:bg-accent/50')}
                onClick={() => setSelectedId(extension.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs text-strong">{extension.name}</strong>
                      {extension.builtInDemo ? <StatusChip good>Demo</StatusChip> : <StatusChip>Custom</StatusChip>}
                      <StatusChip good={extension.enabled} warn={!extension.enabled}>{extension.enabled ? 'Enabled' : 'Off'}</StatusChip>
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-faint">{extension.description}</p>
                  </div>
                  <span className="text-[9px] text-faint">v{extension.version}</span>
                </div>
              </button>
            ))}
            {!busy && visible.length === 0 ? <SettingsRow><span className={rowDesc}>No extensions on this surface yet.</span></SettingsRow> : null}
          </div>
        </SettingsSection>

        {selected ? (
          <>
            <SettingsSection title="Configuration">
              <SettingsRow>
                <div className={rowStack}>
                  <strong className={rowTitle}>{selected.name}</strong>
                  <span className={rowDesc}>{selected.description}</span>
                  <code className={rowPathText}>{selected.id}</code>
                </div>
                <div className="flex items-center gap-2">
                  {!selected.builtInDemo ? <SettingsButton disabled={Boolean(busy)} onClick={() => void deleteSelected()}>Delete</SettingsButton> : null}
                  <label className="flex items-center gap-2 text-[10px] text-soft">
                    <input
                      type="checkbox"
                      checked={selected.enabled}
                      disabled={Boolean(busy)}
                      onChange={(event) => void persist({ ...selected, enabled: event.target.checked }, 'enabled')}
                    />
                    Enabled for real runs
                  </label>
                </div>
              </SettingsRow>

              {!selected.builtInDemo && detailDraft ? (
                <SettingsRow>
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                    <input className="h-8 rounded-md border border-border bg-background px-2 text-[10px] text-soft" value={detailDraft.name} onChange={(event) => setDetailDraft({ ...detailDraft, name: event.target.value })} placeholder="Name" />
                    <input className="h-8 rounded-md border border-border bg-background px-2 text-[10px] text-soft" value={detailDraft.version} onChange={(event) => setDetailDraft({ ...detailDraft, version: event.target.value })} placeholder="1.0.0" />
                    <input className="col-span-2 h-8 rounded-md border border-border bg-background px-2 text-[10px] text-soft" value={detailDraft.description} onChange={(event) => setDetailDraft({ ...detailDraft, description: event.target.value })} placeholder="Description" />
                    <textarea className="col-span-2 min-h-20 rounded-md border border-border bg-background px-2 py-2 text-[10px] leading-4 text-soft" value={detailDraft.instructions} onChange={(event) => setDetailDraft({ ...detailDraft, instructions: event.target.value })} placeholder="Portable instructions delivered when this extension route is active." />
                  </div>
                  <SettingsButton disabled={Boolean(busy)} onClick={saveDetails}>Save details</SettingsButton>
                </SettingsRow>
              ) : selected.instructions ? (
                <SettingsRow>
                  <div className={rowStack}>
                    <strong className={rowTitle}>Portable runtime instructions</strong>
                    <span className={rowDesc}>{selected.instructions}</span>
                  </div>
                </SettingsRow>
              ) : null}

              {selected.demoPrompt ? (
                <SettingsRow>
                  <div className={rowStack}>
                    <strong className={rowTitle}>Pre-built demo prompt</strong>
                    <span className={rowDesc}>The demo runner is deterministic and account-free; enable this extension only when you want its instructions in real agent runs.</span>
                    <code className={rowPathText}>{selected.demoPrompt}</code>
                  </div>
                </SettingsRow>
              ) : null}
            </SettingsSection>

            {selected.builtInDemo ? (
              <SettingsSection title="Run demo">
                <SettingsRow>
                  <div className={rowStack}>
                    <strong className={rowTitle}>Counter route smoke test</strong>
                    <span className={rowDesc}>Exercises this surface through the same compatibility resolver used by real runs. It does not require provider credentials.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-soft" value={demoEngineId} onChange={(event) => setDemoEngineId(event.target.value)}>
                      {engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}{engine.available ? '' : ' (unavailable)'}</option>)}
                    </select>
                    <select className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-soft" value={demoProviderId} onChange={(event) => setDemoProviderId(event.target.value)}>
                      <option value="">Engine-native provider</option>
                      {providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                    </select>
                    <SettingsButton disabled={Boolean(busy) || !demoEngineId} onClick={() => void runDemo()}>Run demo</SettingsButton>
                  </div>
                </SettingsRow>
                {demoResult ? (
                  <SettingsRow>
                    <div className={rowStack}>
                      <div className="flex items-center gap-2">
                        <strong className={rowTitle}>{demoResult.summary}</strong>
                        <StatusChip good={demoResult.supported} warn={!demoResult.supported}>{demoResult.adapter}</StatusChip>
                      </div>
                      {demoResult.steps.map((step, index) => <code key={`${index}-${step}`} className={rowPathText}>{index + 1}. {step}</code>)}
                    </div>
                  </SettingsRow>
                ) : null}
              </SettingsSection>
            ) : null}

            <SettingsSection title="Coding engine routes">
              <div className="space-y-1.5">
                {engines.map((engine) => {
                  // Compatibility should stay visible even while the extension
                  // itself is disabled; enablement is displayed separately.
                  const route = resolveExtensionRoute({ ...selected, enabled: true }, engine)
                  const configured = selected.engineRoutes.find((item) => item.engineId === engine.id)?.adapter ?? 'auto'
                  return (
                    <SettingsRow key={engine.id}>
                      <div className={rowStack}>
                        <strong className={rowTitle}>{engine.name}</strong>
                        <span className={rowDesc}>{route.reason}</span>
                        <span className={rowPathText}>{engine.id} → {route.adapter}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusChip good={route.supported} warn={!route.supported}>{route.supported ? 'Routed' : 'Off'}</StatusChip>
                        <select
                          className="h-7 rounded-md border border-border bg-background px-2 text-[10px] text-soft"
                          value={configured}
                          disabled={Boolean(busy)}
                          onChange={(event) => setEngineRoute(selected, engine.id, event.target.value as ExtensionAdapter)}
                        >
                          {EXTENSION_ADAPTERS.map((adapter) => <option key={adapter} value={adapter}>{adapter}</option>)}
                        </select>
                      </div>
                    </SettingsRow>
                  )
                })}
                {engines.length === 0 ? <SettingsRow><span className={rowDesc}>No coding engines detected.</span></SettingsRow> : null}
              </div>
            </SettingsSection>

            <SettingsSection title="Model provider scope">
              <SettingsRow>
                <div className={rowStack}>
                  <strong className={rowTitle}>Provider routing</strong>
                  <span className={rowDesc}>Engine routing controls execution. Provider scope independently controls whether portable prompt/context delivery may reach DeepSeek, OpenAI, Anthropic, Gemini, local, or future model routes.</span>
                </div>
                <SettingsButton disabled={Boolean(busy)} onClick={() => allowAllProviders(selected)}>Allow all</SettingsButton>
              </SettingsRow>
              <div className="space-y-1.5">
                {providers.map((provider) => {
                  const explicit = selected.providerRoutes.find((route) => route.providerId === provider.id)
                  const checked = selected.providerRoutes.length === 0 ? provider.enabled : explicit?.enabled === true
                  return (
                    <SettingsRow key={provider.id}>
                      <div className={rowStack}>
                        <strong className={rowTitle}>{provider.name}</strong>
                        <span className={rowPathText}>{provider.id}</span>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-soft">
                        <input type="checkbox" checked={checked} disabled={!provider.enabled || Boolean(busy)} onChange={(event) => toggleProvider(selected, provider.id, event.target.checked)} />
                        {provider.enabled ? 'Allowed' : 'Provider disabled'}
                      </label>
                    </SettingsRow>
                  )
                })}
              </div>
            </SettingsSection>
          </>
        ) : null}
      </main>
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
