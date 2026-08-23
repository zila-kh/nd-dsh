import { useEffect, useState } from 'react'
import type { AgentPresetSummary } from '../../../shared/contracts'
import {
  SettingsButton,
  SettingsNote,
  SettingsRow,
  SettingsSection,
  StatusChip,
  rowPathText,
  rowStack,
  rowTitle,
} from './settings-primitives'

interface PresetSettingsProps {
  onError(message: string): void
}

interface PresetRow extends AgentPresetSummary {
  trust?: string
  isDefault?: boolean
}

/**
 * The agent-preset roster as the engine reports it: the shipped standard,
 * code (PTC), minimal, and cordis (creator) presets plus locally authored
 * ones (the ND-DSH preset lives in the harness-home user root).
 */
export function PresetSettings({ onError }: PresetSettingsProps) {
  const [presets, setPresets] = useState<PresetRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void window.ndDsh.dsh.rpc('agentPreset.list', {})
      .then((result) => {
        if (!mounted) return
        if (!result.ok) {
          onError(result.error?.message ?? 'Could not load agent presets')
          return
        }
        const value = (result.value ?? {}) as { presets?: PresetRow[] }
        setPresets(value.presets ?? [])
        setLoaded(true)
      })
      .catch((cause) => {
        if (!mounted) return
        setLoaded(true)
        onError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { mounted = false }
  }, [onError])

  const startSession = async (preset: PresetRow): Promise<void> => {
    setBusyId(preset.id)
    setNotice(null)
    try {
      const result = await window.ndDsh.dsh.rpc('session.create', { agentPreset: preset.id })
      if (!result.ok) throw new Error(result.error?.message ?? 'session.create failed')
      const sessionId = ((result.value ?? {}) as { sessionId?: string }).sessionId
      setNotice(`Started a new ${preset.name ?? preset.id} session: ${sessionId ?? ''}`)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }

  const setDefault = async (preset: PresetRow): Promise<void> => {
    setBusyId(preset.id)
    setNotice(null)
    try {
      const result = await window.ndDsh.dsh.rpc('settings.update', { ns: 'agent-presets', patch: { default: preset.id } })
      if (!result.ok) throw new Error(result.error?.message ?? 'settings.update failed')
      setPresets((current) => current.map((row) => ({ ...row, isDefault: row.id === preset.id })))
      setNotice(`${preset.name ?? preset.id} is now the default preset for new sessions.`)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-0 overflow-auto px-[26px] pb-[42px] pt-1.5">
      <SettingsSection title="Agent presets" className="mt-3.5">
        <SettingsNote>
          Each session composes its agent from one preset. Creator mode is the shipped <code>cordis</code> preset
          (creates custom presets); Code mode is the shipped <code>code</code> (PTC) preset.
        </SettingsNote>
        {!loaded ? (
          <SettingsNote>Loading presets…</SettingsNote>
        ) : presets.length === 0 ? (
          <SettingsNote>No presets are available in this deployment.</SettingsNote>
        ) : (
          <div className="space-y-1.5">
            {presets.map((preset) => (
              <SettingsRow key={preset.id}>
                <div className={rowStack}>
                  <strong className={rowTitle}>{preset.name ?? preset.id}</strong>
                  <span className={rowPathText}>{preset.description ?? preset.id}</span>
                  {preset.trust === 'system' ? <StatusChip neutral>shipped</StatusChip> : null}
                  {preset.isDefault ? <StatusChip good>default</StatusChip> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SettingsButton disabled={busyId === preset.id} onClick={() => void startSession(preset)}>
                    New session
                  </SettingsButton>
                  <SettingsButton
                    active={preset.isDefault}
                    disabled={busyId === preset.id || preset.isDefault === true}
                    onClick={() => void setDefault(preset)}
                  >
                    {preset.isDefault ? 'Default' : 'Set default'}
                  </SettingsButton>
                </div>
              </SettingsRow>
            ))}
          </div>
        )}
        {notice ? <SettingsNote good>{notice}</SettingsNote> : null}
      </SettingsSection>
    </div>
  )
}
