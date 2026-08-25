import { useEffect, useMemo, useState } from 'react'
import type { CodingEngineDescriptor, ModelProvider } from '../../../shared/contracts'
import {
  AGENT_EXTENSION_SURFACES,
  EXTENSION_ADAPTERS,
  cloneBuiltinExtensionDemos,
  resolveExtensionRoute,
  type AgentExtensionManifest,
  type AgentExtensionSurface,
  type ExtensionAdapter,
} from '../../../shared/extensions'
import { cn } from '../lib/utils'
import { SettingsButton, SettingsRow, SettingsSection, StatusChip, rowDesc, rowPathText, rowStack, rowTitle } from './settings-primitives'

const STORAGE_KEY = 'nd-dsh.agent-extensions.v1'

const SURFACE_LABEL: Record<AgentExtensionSurface, string> = {
  memory: 'Memory',
  subagent: 'Subagents',
  plugin: 'Plugins',
  mcp: 'MCP Servers',
  skill: 'Skills',
  command: 'Commands',
  hook: 'Hooks',
}

function loadExtensions(): AgentExtensionManifest[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return cloneBuiltinExtensionDemos()
    const parsed = JSON.parse(raw) as AgentExtensionManifest[]
    return Array.isArray(parsed) && parsed.length ? parsed : cloneBuiltinExtensionDemos()
  } catch {
    return cloneBuiltinExtensionDemos()
  }
}

export function ExtensionSettings({ onError }: { onError(message: string): void }) {
  const [extensions, setExtensions] = useState<AgentExtensionManifest[]>(loadExtensions)
  const [engines, setEngines] = useState<CodingEngineDescriptor[]>([])
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [surface, setSurface] = useState<AgentExtensionSurface>('plugin')
  const [selectedId, setSelectedId] = useState<string>('demo-counter-plugin')

  useEffect(() => {
    let mounted = true
    void Promise.all([window.ndDsh.engines.list(), window.ndDsh.providers.list()])
      .then(([engineItems, providerItems]) => {
        if (!mounted) return
        setEngines(engineItems)
        setProviders(providerItems)
      })
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
    return () => { mounted = false }
  }, [onError])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(extensions))
  }, [extensions])

  const visible = useMemo(() => extensions.filter((item) => item.surface === surface), [extensions, surface])
  const selected = extensions.find((item) => item.id === selectedId) ?? visible[0]

  const mutate = (id: string, change: (item: AgentExtensionManifest) => AgentExtensionManifest): void => {
    setExtensions((items) => items.map((item) => item.id === id ? change(item) : item))
  }

  const setEngineRoute = (extension: AgentExtensionManifest, engineId: string, adapter: ExtensionAdapter): void => {
    mutate(extension.id, (item) => ({
      ...item,
      engineRoutes: [
        ...item.engineRoutes.filter((route) => route.engineId !== engineId),
        ...(adapter === 'auto' ? [] : [{ engineId, adapter }]),
      ],
    }))
  }

  const toggleProvider = (extension: AgentExtensionManifest, providerId: string, enabled: boolean): void => {
    mutate(extension.id, (item) => {
      const current = new Map(item.providerRoutes.map((route) => [route.providerId, route.enabled]))
      current.set(providerId, enabled)
      return { ...item, providerRoutes: [...current.entries()].map(([id, value]) => ({ providerId: id, enabled: value })) }
    })
  }

  const allowAllProviders = (extension: AgentExtensionManifest): void => {
    mutate(extension.id, (item) => ({ ...item, providerRoutes: [] }))
  }

  const reset = (): void => {
    const demos = cloneBuiltinExtensionDemos()
    setExtensions(demos)
    setSurface('plugin')
    setSelectedId('demo-counter-plugin')
  }

  return (
    <div className="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
      <aside className="min-h-0 overflow-auto border-r border-border-soft bg-secondary/20 px-3 py-4">
        <div className="mb-3 px-1">
          <strong className="block text-xs text-strong">Agent capabilities</strong>
          <span className="mt-1 block text-[10px] leading-4 text-faint">One ND extension definition, routed to every coding engine and model provider.</span>
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
                  if (first) setSelectedId(first.id)
                }}
              >
                <span>{SURFACE_LABEL[item]}</span>
                <span className="text-[9px] text-faint">{count}</span>
              </button>
            )
          })}
        </div>
        <div className="mt-4 border-t border-border-soft pt-3">
          <SettingsButton onClick={reset}>Reset demo pack</SettingsButton>
        </div>
      </aside>

      <main className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-4">
        <SettingsSection title={SURFACE_LABEL[surface]}>
          <div className="space-y-1.5">
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
                      {extension.builtInDemo ? <StatusChip good>Demo</StatusChip> : null}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-faint">{extension.description}</p>
                  </div>
                  <span className="text-[9px] text-faint">v{extension.version}</span>
                </div>
              </button>
            ))}
          </div>
        </SettingsSection>

        {selected ? (
          <>
            <SettingsSection title="Configuration">
              <SettingsRow>
                <div className={rowStack}>
                  <strong className={rowTitle}>{selected.name}</strong>
                  <span className={rowDesc}>{selected.description}</span>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-soft">
                  <input
                    type="checkbox"
                    checked={selected.enabled}
                    onChange={(event) => mutate(selected.id, (item) => ({ ...item, enabled: event.target.checked }))}
                  />
                  Enabled
                </label>
              </SettingsRow>
              {selected.demoPrompt ? (
                <SettingsRow>
                  <div className={rowStack}>
                    <strong className={rowTitle}>Pre-built demo</strong>
                    <span className={rowDesc}>Ready-to-run sample for manual QA.</span>
                    <code className={rowPathText}>{selected.demoPrompt}</code>
                  </div>
                </SettingsRow>
              ) : null}
            </SettingsSection>

            <SettingsSection title="Coding engine routes">
              <div className="space-y-1.5">
                {engines.map((engine) => {
                  const route = resolveExtensionRoute(selected, engine)
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
                  <span className={rowDesc}>Engine routing controls execution. Provider scope controls whether prompt/context delivery may reach DeepSeek, OpenAI, Anthropic, Gemini, local, or any future model route.</span>
                </div>
                <SettingsButton onClick={() => allowAllProviders(selected)}>Allow all</SettingsButton>
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
                        <input type="checkbox" checked={checked} disabled={!provider.enabled} onChange={(event) => toggleProvider(selected, provider.id, event.target.checked)} />
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
