import { useEffect, useState } from 'react'
import type {
  ToolRoutingDecision,
  ToolRoutingMode,
  ToolRouterProvider,
  ToolRoutingSettings,
} from '../../../shared/tool-routing'
import {
  SettingsButton,
  SettingsNote,
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

const numberInput = 'w-[86px] shrink-0 rounded-md border border-border-strong bg-background px-[9px] py-[5px] text-right font-mono text-[11px] text-foreground outline-none focus:border-primary/40 disabled:opacity-50'

export function TokenToolOptimizationSettings({ onError }: TokenToolOptimizationSettingsProps) {
  const [settings, setSettings] = useState<ToolRoutingSettings | null>(null)
  const [recentDecisions, setRecentDecisions] = useState<ToolRoutingDecision[]>([])
  const [bridgeAvailable, setBridgeAvailable] = useState(true)
  const [thresholdDraft, setThresholdDraft] = useState('')
  const [minToolsDraft, setMinToolsDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const api = window.ndDshToolRouting
    if (!api) {
      setBridgeAvailable(false)
      return
    }

    api.state().then((res) => {
      if (!mounted) return
      setSettings(res.settings)
      setThresholdDraft(res.settings.confidenceThreshold.toFixed(2))
      setMinToolsDraft(String(res.settings.minTools))
      setRecentDecisions(res.recentDecisions ?? [])
    }).catch((cause) => {
      if (mounted) onError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => { mounted = false }
  }, [onError])

  const update = async (next: ToolRoutingSettings, label = 'settings'): Promise<void> => {
    setBusy(label)
    try {
      const updated = await window.ndDshToolRouting.updateSettings(next)
      setSettings(updated)
      setThresholdDraft(updated.confidenceThreshold.toFixed(2))
      setMinToolsDraft(String(updated.minTools))
    } catch (cause) {
      if (settings) {
        setThresholdDraft(settings.confidenceThreshold.toFixed(2))
        setMinToolsDraft(String(settings.minTools))
      }
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const commitThreshold = (): void => {
    if (!settings) return
    const value = Number.parseFloat(thresholdDraft)
    if (!Number.isFinite(value)) {
      setThresholdDraft(settings.confidenceThreshold.toFixed(2))
      return
    }
    const clamped = Math.min(1, Math.max(0.5, value))
    setThresholdDraft(clamped.toFixed(2))
    if (clamped !== settings.confidenceThreshold) void update({ ...settings, confidenceThreshold: clamped }, 'threshold')
  }

  const commitMinTools = (): void => {
    if (!settings) return
    const value = Number.parseInt(minToolsDraft, 10)
    if (!Number.isFinite(value)) {
      setMinToolsDraft(String(settings.minTools))
      return
    }
    const clamped = Math.min(24, Math.max(1, value))
    setMinToolsDraft(String(clamped))
    if (clamped !== settings.minTools) void update({ ...settings, minTools: clamped }, 'minTools')
  }

  if (!bridgeAvailable) {
    return (
      <SettingsSection title="Token & Tool Optimization">
        <SettingsNote>
          Tool routing runs inside the ND desktop app. It is not available in the UI preview.
        </SettingsNote>
      </SettingsSection>
    )
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
          <span className={rowDesc}>Required minimum certainty before filtering the tool catalog (0.50–1.00, Default: 0.78).</span>
        </div>
        <input
          className={numberInput}
          type="number"
          min="0.5"
          max="1"
          step="0.01"
          aria-label="Confidence threshold"
          value={thresholdDraft}
          disabled={busy !== null}
          onChange={(event) => setThresholdDraft(event.target.value)}
          onBlur={commitThreshold}
          onKeyDown={(event) => { if (event.key === 'Enter') commitThreshold() }}
        />
      </SettingsRow>

      {/* Minimum Tools */}
      <SettingsRow>
        <div className={rowStack}>
          <span className={rowTitle}>Minimum Tools</span>
          <span className={rowDesc}>Lower bound of exposed tools guaranteed for each turn (1–24, Default: 3).</span>
        </div>
        <input
          className={numberInput}
          type="number"
          min="1"
          max="24"
          step="1"
          aria-label="Minimum tools"
          value={minToolsDraft}
          disabled={busy !== null}
          onChange={(event) => setMinToolsDraft(event.target.value)}
          onBlur={commitMinTools}
          onKeyDown={(event) => { if (event.key === 'Enter') commitMinTools() }}
        />
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
