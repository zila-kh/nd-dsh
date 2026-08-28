import { useEffect, useMemo, useState } from 'react'
import type { ModelProvider } from '../../../shared/contracts'
import type { NdGatewayMode, NdGatewayState } from '../../../shared/gateway'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  StatusChip,
  rowDesc,
  rowPathText,
  rowStack,
  rowTitle,
  rowValueText,
} from './settings-primitives'

interface GatewaySettingsProps {
  onError(message: string): void
}

export function GatewaySettings({ onError }: GatewaySettingsProps) {
  const [state, setState] = useState<NdGatewayState | null>(null)
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [mode, setMode] = useState<NdGatewayMode>('nd-enhanced')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    const apply = (value: NdGatewayState): void => { if (mounted) setState(value) }
    const unsubscribe = window.ndDshGateway.onChanged(apply)
    void Promise.all([window.ndDshGateway.state(), window.ndDsh.providers.list()])
      .then(([gateway, available]) => {
        if (!mounted) return
        setState(gateway)
        setProviders(available.filter((provider) => provider.enabled))
        const preferred = available.find((provider) => provider.enabled && provider.hasApiKey)
          ?? available.find((provider) => provider.enabled)
        if (preferred) setProviderId(preferred.id)
      })
      .catch((cause) => onError(message(cause)))
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [onError])

  const chatgpt = state?.apps.find((app) => app.id === 'chatgpt')
  const codex = state?.apps.find((app) => app.id === 'codex')
  const selectedProvider = useMemo(() => providers.find((provider) => provider.id === providerId), [providerId, providers])
  const responsesCompatible = selectedProvider?.apiFormat.toLowerCase().includes('responses') ?? false
  const canConnect = Boolean(codex?.supported && selectedProvider?.hasApiKey && responsesCompatible && mode !== 'full-nd' && !busy)
  const connect = async (): Promise<void> => {
    setBusy(true)
    try {
      setState(await window.ndDshGateway.connect({ appId: 'codex', mode, providerId }))
    } catch (cause) {
      onError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    try {
      setState(await window.ndDshGateway.disconnect('codex'))
    } catch (cause) {
      onError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection title="ND Gateway">
      <div className="space-y-1.5">
        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Use ND from other apps</strong>
            <span className={rowDesc}>Zero-terminal setup. External apps receive an ND-local credential; your real provider API key stays inside ND.</span>
            {state?.endpoint ? <span className={rowPathText}>Gateway active on this computer only</span> : null}
          </div>
          <StatusChip good={state?.running} neutral={!state?.running}>{state?.running ? 'Running' : 'Off'}</StatusChip>
        </SettingsRow>

        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Codex</strong>
            <span className={rowDesc}>{codex?.detail ?? 'Checking this computer…'}</span>
            <span className={rowPathText}>{codex?.detected ? 'Detected on this computer' : 'Custom-provider setup available'}</span>
          </div>
          <StatusChip good={codex?.connected} neutral={!codex?.connected}>
            {codex?.connected ? 'Proxy ready' : 'Ready to connect'}
          </StatusChip>
        </SettingsRow>

        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>ChatGPT Desktop</strong>
            <span className={rowDesc}>{chatgpt?.detail ?? 'Checking this computer…'}</span>
            <span className={rowPathText}>{chatgpt?.detected ? 'Detected on this computer' : 'Not detected yet'}</span>
          </div>
          <StatusChip good={chatgpt?.connected} warn={chatgpt?.detected && !chatgpt?.supported} neutral={!chatgpt?.detected}>
            {chatgpt?.connected ? 'Connected' : chatgpt?.supported ? 'Ready' : 'Safe integration unavailable'}
          </StatusChip>
        </SettingsRow>

        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Use ND for</strong>
            <span className={rowDesc}>Choose how much ND should add when an app has a supported connection method.</span>
          </div>
          <div className="flex shrink-0 gap-1">
            {(['llm-only', 'nd-enhanced', 'full-nd'] as const).map((value) => (
              <SettingsButton key={value} active={mode === value} disabled={busy || value === 'full-nd'} onClick={() => setMode(value)}>
                {value === 'llm-only' ? 'LLM only' : value === 'nd-enhanced' ? 'ND Enhanced' : 'Full ND'}
              </SettingsButton>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Model provider</strong>
            <span className={rowDesc}>Codex requires a provider route using Responses (/responses). The real provider key stays inside ND.</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={providerId}
              disabled={busy || providers.length === 0}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
            </select>
            <StatusChip good={selectedProvider?.hasApiKey} warn={Boolean(selectedProvider && !selectedProvider.hasApiKey)}>
              {selectedProvider?.hasApiKey ? 'API key saved' : 'API key required'}
            </StatusChip>
          </div>
        </SettingsRow>

        <SettingsRow>
          <div className={rowStack}>
            <strong className={rowTitle}>Connection</strong>
            <span className={rowDesc}>Connect installs a reversible, ND-marked route in your user-level Codex config. Native Codex choices stay native; only ND â€” provider â€” model choices route through ND.</span>
            {selectedProvider && !responsesCompatible ? <span className={rowPathText}>Change this provider’s API format to Responses (/responses) in Models first.</span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedProvider && !selectedProvider.hasApiKey ? <span className={rowValueText}>Add the API key in Models first</span> : null}
            {codex?.connected ? (
              <SettingsButton disabled={busy} onClick={() => void disconnect()}>{busy ? 'Working…' : 'Disconnect'}</SettingsButton>
            ) : (
              <SettingsButton disabled={!canConnect} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect'}</SettingsButton>
            )}
          </div>
        </SettingsRow>

        {codex?.connected ? (
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Proxy model catalog enabled</strong>
              <span className={rowDesc}>Restart Codex once, then choose an ND â€” {selectedProvider?.name ?? 'provider'} â€” model. Disconnect restores your prior configuration and removes these entries when Codex refreshes.</span>
            </div>
            <StatusChip good>Installed</StatusChip>
          </SettingsRow>
        ) : null}
      </div>
    </SettingsSection>
  )
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
