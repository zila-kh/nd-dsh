import { useEffect, useState } from 'react'
import type { CapabilityDescriptor, CapabilityKind, CapabilityProviderStatus } from '../../../shared/capabilities'
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

interface CapabilitySettingsProps {
  onError(message: string): void
}

const KIND_SECTIONS: Array<{ kind: CapabilityKind; title: string; note: string }> = [
  { kind: 'engine', title: 'Engine providers', note: 'Which coding runtime executes assigned work. ND Harness is the always-available built-in; Codex routes are adapters.' },
  { kind: 'memory', title: 'Memory providers', note: 'Durable organizational recall injected into PM, worker, and review prompts. Adapters extend recall in-loop once staged.' },
  { kind: 'context', title: 'Context providers', note: 'How workspace and repo understanding is gathered before a run. Harness-plugin slots mount through the sanctioned patch overlay.' },
]

type Lifecycle = 'active' | 'disabled' | 'unverified' | 'not-installed'

export function CapabilitySettings({ onError }: CapabilitySettingsProps) {
  const [providers, setProviders] = useState<CapabilityDescriptor[]>([])
  const [statuses, setStatuses] = useState<Record<string, CapabilityProviderStatus>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const refresh = (): void => {
      void window.ndDsh.capabilities.providers()
        .then((value) => { if (mounted) setProviders(value) })
        .catch((cause) => onError(errorMessage(cause)))
      void window.ndDsh.capabilities.statuses()
        .then((value) => { if (mounted) setStatuses(value) })
        .catch((cause) => onError(errorMessage(cause)))
        .finally(() => { if (mounted) setLoading(false) })
    }
    refresh()
    const offStatus = window.ndDsh.capabilities.onStatusChanged((value) => { if (mounted) setStatuses(value) })
    return () => { mounted = false; offStatus() }
  }, [onError])

  const verify = async (providerId: string): Promise<void> => {
    if (busy) return
    setBusy(`verify-${providerId}`)
    try {
      await window.ndDsh.capabilities.verify(providerId)
      setStatuses(await window.ndDsh.capabilities.statuses())
    } catch (cause) {
      onError(errorMessage(cause))
      setStatuses(await window.ndDsh.capabilities.statuses().catch(() => statuses))
    } finally {
      setBusy(null)
    }
  }

  const toggle = async (providerId: string, enabled: boolean): Promise<void> => {
    if (busy) return
    setBusy(`toggle-${providerId}`)
    try {
      await window.ndDsh.capabilities.setEnabled(providerId, enabled)
      setStatuses(await window.ndDsh.capabilities.statuses())
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-1.5">
      {KIND_SECTIONS.map(({ kind, title, note }) => (
        <SettingsSection key={kind} title={title} className="mt-3.5">
          <div className="space-y-1.5">
            <SettingsRow>
              <div className={rowStack}>
                <span className={rowDesc}>{note}</span>
              </div>
            </SettingsRow>
            {loading ? (
              <SettingsRow>
                <div className={rowStack}><strong className={rowTitle}>Detecting providers…</strong></div>
              </SettingsRow>
            ) : null}
            {providers.filter((provider) => provider.kind === kind).map((provider) => {
              const status = statuses[provider.id]
              const enabled = status?.enabled ?? provider.integration === 'builtin'
              const verified = status?.lastVerifiedAt !== undefined && status.lastError === undefined
              const lifecycle = !provider.available
                ? 'not-installed'
                : enabled
                  ? 'active'
                  : verified
                    ? 'disabled'
                    : 'unverified'
              return (
                <SettingsRow key={provider.id}>
                  <div className={rowStack}>
                    <strong className={rowTitle}>{provider.name}</strong>
                    <span className={rowDesc}>{provider.description}</span>
                    {!provider.available && provider.unavailableReason ? <span className={rowPathText}>{provider.unavailableReason}</span> : null}
                    {status?.lastError ? <span className={rowPathText}>{status.lastError}</span> : null}
                    {status?.lastVerifiedAt ? (
                      <span className={rowPathText}>{`Verified ${new Date(status.lastVerifiedAt).toLocaleString()}`}</span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-[3px]">
                    <StatusChip good={lifecycle === 'active'} warn={lifecycle === 'unverified' || lifecycle === 'not-installed'}>
                      {lifecycleLabel(lifecycle)}
                    </StatusChip>
                    <span className={rowValueText}>{provider.integration === 'builtin' ? 'Built-in' : 'Adapter'}</span>
                    <div className="flex items-center gap-1.5">
                      <SettingsButton disabled={busy !== null} onClick={() => void verify(provider.id)}>
                        {busy === `verify-${provider.id}` ? 'Verifying…' : 'Verify'}
                      </SettingsButton>
                      <SettingsButton disabled={busy !== null || lifecycle === 'not-installed' || (lifecycle === 'unverified' && !enabled)} onClick={() => void toggle(provider.id, !enabled)}>
                        {enabled ? 'Disable' : 'Enable'}
                      </SettingsButton>
                    </div>
                  </div>
                </SettingsRow>
              )
            })}
          </div>
        </SettingsSection>
      ))}

      <SettingsSection title="Lifecycle">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Verify before enable</strong>
              <span className={rowDesc}>A provider can only be turned on after its latest verification probe passes. Built-ins start active; adapters stay off until verified. A failed re-verification disables eligibility until it passes again.</span>
            </div>
          </SettingsRow>
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Assignment</strong>
              <span className={rowDesc}>Per-agent engine, memory, and context routing lives in Company → Teams &amp; Skills → AI workers. Role and team routing arrive with role/team editing.</span>
            </div>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  )
}

function lifecycleLabel(lifecycle: Lifecycle): string {
  if (lifecycle === 'active') return 'Active'
  if (lifecycle === 'disabled') return 'Disabled'
  if (lifecycle === 'unverified') return 'Unverified'
  return 'Not installed'
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
