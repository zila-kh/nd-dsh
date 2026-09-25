import { useEffect, useState } from 'react'
import type {
  ToolRoutingDecision,
  ToolRoutingMode,
  ToolRouterProvider,
  ToolRoutingSettings,
} from '../../../shared/tool-routing'
import {
  SettingsButton,
  SettingsRow,
  SettingsSection,
  StatusChip,
  rowDesc,
  rowStack,
  rowTitle,
  rowValueText,
} from './settings-primitives'
import { Switch } from './ui/switch'

interface TokenToolOptimizationSettingsProps {
  onError(message: string): void
}

export function TokenToolOptimizationSettings({ onError }: TokenToolOptimizationSettingsProps) {
  const [settings, setSettings] = useState<ToolRoutingSettings | null>(null)
  const [recentDecisions, setRecentDecisions] = useState<ToolRoutingDecision[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const api = (window as any).ndDshToolRouting
    if (!api) return

    api.state().then((res: any) => {
      if (mounted && res) {
        setSettings(res.settings)
        setRecentDecisions(res.recentDecisions ?? [])
      }
    }).catch((err: any) => onError(err?.message ?? String(err)))

    return () => { mounted = false }
  }, [onError])

  const update = async (next: ToolRoutingSettings, label = 'settings'): Promise<void> => {
    setBusy(label)
    try {
      const api = (window as any).ndDshToolRouting
      if (api) {
        const updated = await api.updateSettings(next)
        setSettings(updated)
      } else {
        setSettings(next)
      }
    } catch (err: any) {
      onError(err?.message ?? String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!settings) {
    return (
      <SettingsSection title="Token & Tool Optimization">
        <div className="py-4 text-xs text-muted-foreground">Loading settings...</div>
      </SettingsSection>
    )
  }

  const modes: { id: ToolRoutingMode; label: string; desc: string }[] = [
    { id: 'off', label: 'Off', desc: 'No routing, supplies full tool catalog to the model.' },
    { id: 'shadow', label: 'Shadow', desc: 'Routes & measures savings, but supplies full tool catalog.' },
    { id: 'assist', label: 'Assist', desc: 'Reduces irrelevant tools with safe fallback when uncertain.' },
    { id: 'enforce', label: 'Enforce', desc: 'Strict router-selected tool catalog targeting max token savings.' },
  ]

  const providers: { id: ToolRouterProvider; label: string }[] = [
    { id: 'auto', label: 'Auto (Cascade)' },
    { id: 'laya', label: 'Laya' },
    { id: 'jev', label: 'Jev' },
    { id: 'deterministic', label: 'Deterministic only' },
  ]

  return (
    <SettingsSection title="Token & Tool Optimization">
      {/* Mode Selector */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Tool Routing Mode</span>
          <span className={rowDesc}>Choose how conservatively the router exposes tools to coding models.</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {modes.map((m) => (
              <SettingsButton
                key={m.id}
                active={settings.mode === m.id}
                disabled={busy !== null}
                onClick={() => update({ ...settings, mode: m.id }, 'mode')}
              >
                {m.label}
              </SettingsButton>
            ))}
          </div>
        </div>
        <StatusChip good={settings.mode !== 'off'} neutral={settings.mode === 'off'}>
          {settings.mode.toUpperCase()}
        </StatusChip>
      </SettingsRow>

      {/* Router Provider */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Router Provider</span>
          <span className={rowDesc}>Intelligence tier predicting relevant tool capabilities.</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {providers.map((p) => (
              <SettingsButton
                key={p.id}
                active={settings.provider === p.id}
                disabled={busy !== null}
                onClick={() => update({ ...settings, provider: p.id }, 'provider')}
              >
                {p.label}
              </SettingsButton>
            ))}
          </div>
        </div>
        <span className={rowValueText}>{settings.provider}</span>
      </SettingsRow>

      {/* Confidence Threshold */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Confidence Threshold</span>
          <span className={rowDesc}>Required minimum certainty before filtering the tool catalog (Default: 0.78).</span>
        </div>
        <span className={rowValueText}>{settings.confidenceThreshold.toFixed(2)}</span>
      </SettingsRow>

      {/* Minimum Tools */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Minimum Tools</span>
          <span className={rowDesc}>Lower bound of exposed tools guaranteed for each turn (Default: 3).</span>
        </div>
        <span className={rowValueText}>{settings.minTools} tools</span>
      </SettingsRow>

      {/* Always-available safe/core tools */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Always-available Safe / Core Tools</span>
          <span className={rowDesc}>Keep read_file, search_workspace, and verification tools always present.</span>
        </div>
        <Switch
          checked={settings.alwaysAvailableCoreTools}
          onCheckedChange={(checked) => update({ ...settings, alwaysAvailableCoreTools: checked }, 'core')}
          disabled={busy !== null}
        />
      </SettingsRow>

      {/* Fail-open fallback */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Fail-Open to Full Catalog</span>
          <span className={rowDesc}>Automatically fall back to the complete tool catalog if routing errors or times out.</span>
        </div>
        <Switch
          checked={settings.failOpen}
          onCheckedChange={(checked) => update({ ...settings, failOpen: checked }, 'failOpen')}
          disabled={busy !== null}
        />
      </SettingsRow>

      {/* Log activity */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Show Routing Decisions in Activity Log</span>
          <span className={rowDesc}>Persist sanitized tool reduction metrics and routing latency to the journal.</span>
        </div>
        <Switch
          checked={settings.showRoutingInLog}
          onCheckedChange={(checked) => update({ ...settings, showRoutingInLog: checked }, 'log')}
          disabled={busy !== null}
        />
      </SettingsRow>

      {/* Per-project overrides */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Allow Per-Project Overrides</span>
          <span className={rowDesc}>Individual projects can specify customized routing modes or provider rules.</span>
        </div>
        <Switch
          checked={settings.perProjectOverride}
          onCheckedChange={(checked) => update({ ...settings, perProjectOverride: checked }, 'projectOverride')}
          disabled={busy !== null}
        />
      </SettingsRow>

      {/* Recent Decisions Summary */}
      {recentDecisions.length > 0 && (
        <div className="mt-4 p-3 bg-muted/40 rounded border border-border/50 text-xs">
          <div className="font-semibold mb-2">Recent Routing Decisions ({recentDecisions.length})</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {recentDecisions.slice(0, 5).map((d, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span>[{d.mode}] {d.taskClass ?? 'turn'}: {d.selectedCount}/{d.totalCount} tools ({d.savingsPercent}% saved)</span>
                <span>{d.latencyMs}ms ({d.provider})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
