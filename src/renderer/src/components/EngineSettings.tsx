import { useEffect, useState } from 'react'
import type { CodingEngineDescriptor } from '../../../shared/contracts'

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
    <div className="settings-scroll">
      <section className="settings-section">
        <h2>Coding engines</h2>
        <div className="settings-row">
          <div>
            <strong>ND control plane</strong>
            <span>Companies, roles, tasks, skills, policies, memory, and provider routes stay owned by ND. Engines are replaceable execution adapters.</span>
          </div>
          <span className="settings-status good">Provider-neutral</span>
        </div>
        {loading ? <div className="settings-row"><div><strong>Detecting engines…</strong></div></div> : null}
        {engines.map((engine) => (
          <div className="settings-row" key={engine.id}>
            <div>
              <strong>{engine.name}</strong>
              <span>{engine.description}</span>
              <span className="settings-path">{capabilitySummary(engine)}</span>
              {!engine.available && engine.unavailableReason ? <span className="settings-path">{engine.unavailableReason}</span> : null}
            </div>
            <div>
              <span className={`settings-status ${engine.available ? 'good' : 'warn'}`}>{engine.available ? 'Available' : 'Unavailable'}</span>
              <span className="settings-value">{engine.integration === 'primary' ? 'Primary' : 'Delegated'}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h2>Engine boundaries</h2>
        <div className="settings-row">
          <div><strong>ND Harness</strong><span>Primary durable runtime for ND agents, browser, MCP, skills, approvals, and provider-routed models.</span></div>
        </div>
        <div className="settings-row">
          <div><strong>Codex CLI (direct)</strong><span>ND spawns and manages the official Codex app-server: streamed chat threads in the workbench, approval prompts, and workspace-scoped unattended runs. Codex account, model, project trust, and authentication remain native to Codex.</span></div>
        </div>
        <div className="settings-row">
          <div><strong>Codex (delegated)</strong><span>Fallback route where the ND runtime delegates one-shot implementation work through its pinned Codex adapter. Useful when the direct engine is unavailable.</span></div>
        </div>
      </section>
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
