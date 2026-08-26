import { useEffect, useState } from 'react'
import type { CodingEngineDescriptor } from '../../../shared/contracts'
import {
  SettingsRow,
  SettingsSection,
  StatusChip,
  rowDesc,
  rowPathText,
  rowStack,
  rowTitle,
  rowValueText,
} from './settings-primitives'
import { GatewaySettings } from './GatewaySettings'
import { TokenSaverSettings } from './TokenSaverSettings'

interface EngineSettingsProps {
  onError(message: string): void
}

export function EngineSettings({ onError }: EngineSettingsProps) {
  const [engines, setEngines] = useState<CodingEngineDescriptor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    void window.ndDsh.engines.list()
      .then((value) => {
        if (mounted) setEngines(value)
      })
      .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [onError])

  return (
    <div className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-1.5">
      <TokenSaverSettings onError={onError} />
      <GatewaySettings onError={onError} />

      <SettingsSection title="Coding engines">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>ND control plane</strong>
              <span className={rowDesc}>Companies, roles, tasks, skills, policies, memory, and provider routes stay owned by ND. Engines are replaceable execution adapters.</span>
            </div>
            <StatusChip good>Provider-neutral</StatusChip>
          </SettingsRow>
          {loading ? (
            <SettingsRow>
              <div className={rowStack}><strong className={rowTitle}>Detecting engines…</strong></div>
            </SettingsRow>
          ) : null}
          {engines.map((engine) => (
            <SettingsRow key={engine.id}>
              <div className={rowStack}>
                <strong className={rowTitle}>{engine.name}</strong>
                <span className={rowDesc}>{engine.description}</span>
                <span className={rowPathText}>{capabilitySummary(engine)}</span>
                {!engine.available && engine.unavailableReason ? <span className={rowPathText}>{engine.unavailableReason}</span> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-[3px]">
                <StatusChip good={engine.available} warn={!engine.available}>{engine.available ? 'Available' : 'Unavailable'}</StatusChip>
                <span className={rowValueText}>{engine.integration === 'primary' ? 'Primary' : 'Delegated'}</span>
              </div>
            </SettingsRow>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Engine boundaries">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>ND Harness</strong>
              <span className={rowDesc}>Primary durable runtime for ND agents, browser, MCP, skills, approvals, and provider-routed models.</span>
            </div>
          </SettingsRow>
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Codex CLI (direct)</strong>
              <span className={rowDesc}>ND spawns and manages the official Codex app-server: streamed chat threads in the workbench, approval prompts, and workspace-scoped unattended runs. Codex account, model, project trust, and authentication remain native to Codex.</span>
            </div>
          </SettingsRow>
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Codex (delegated)</strong>
              <span className={rowDesc}>Fallback route where the ND runtime delegates one-shot implementation work through its pinned Codex adapter. Useful when the direct engine is unavailable.</span>
            </div>
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  )
}

function capabilitySummary(engine: CodingEngineDescriptor): string {
  const labels: Array<[keyof CodingEngineDescriptor['capabilities'], string]> = [
    ['workspace', 'workspace'],
    ['filesystem', 'files'],
    ['shell', 'shell'],
    ['browser', 'browser'],
    ['skills', 'skills'],
    ['mcp', 'MCP'],
    ['modelProviderRouting', 'ND model routing'],
    ['humanApprovals', 'human approvals'],
    ['streaming', 'streaming'],
    ['persistentSessions', 'persistent sessions'],
  ]
  return labels.filter(([key]) => engine.capabilities[key]).map(([, label]) => label).join(' · ') || 'No advertised capabilities'
}