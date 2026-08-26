import { useEffect, useMemo, useState } from 'react'
import type {
  TokenSaverAccountId,
  TokenSaverSettings,
  TokenSaverState,
} from '../../../shared/token-saver'
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
import { Switch } from './ui/switch'

interface TokenSaverSettingsProps {
  onError(message: string): void
}

export function TokenSaverSettings({ onError }: TokenSaverSettingsProps) {
  const [state, setState] = useState<TokenSaverState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [demoNotice, setDemoNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const apply = (value: TokenSaverState): void => { if (mounted) setState(value) }
    const unsubscribe = window.ndDshTokenSaver.onChanged(apply)
    void window.ndDshTokenSaver.state()
      .then(apply)
      .catch((cause) => onError(message(cause)))
    void window.ndDshTokenSaver.detectExternalApps()
      .then(apply)
      .catch(() => undefined)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [onError])

  const savings = useMemo(() => {
    const counters = state?.counters
    if (!counters) return { percent: 0, tokens: 0 }
    const percent = counters.originalChars > 0
      ? Math.round((counters.avoidedChars / counters.originalChars) * 100)
      : 0
    return { percent, tokens: Math.round(counters.avoidedChars / 4) }
  }, [state?.counters])

  const update = async (next: TokenSaverSettings, label = 'settings'): Promise<void> => {
    setBusy(label)
    try {
      setState(await window.ndDshTokenSaver.updateSettings(next))
    } catch (cause) {
      onError(message(cause))
      try { setState(await window.ndDshTokenSaver.state()) } catch { /* event/state will recover */ }
    } finally {
      setBusy(null)
    }
  }

  const settings = state?.settings
  const builtInEnabled = Boolean(settings?.ndEnabled && settings.mode !== 'off')

  const setBuiltIn = (enabled: boolean): void => {
    if (!settings) return
    setDemoNotice(null)
    void update({
      ...settings,
      ndEnabled: enabled,
      mode: enabled ? (settings.mode === 'advanced' ? 'advanced' : 'automatic') : 'off',
    }, 'nd')
  }

  const setMode = (mode: TokenSaverSettings['mode']): void => {
    if (!settings) return
    setDemoNotice(null)
    void update({ ...settings, ndEnabled: mode !== 'off', mode }, 'mode')
  }

  const setExternal = (enabled: boolean): void => {
    if (!settings) return
    void update({ ...settings, externalEnabled: enabled }, 'external')
  }

  const setExternalApp = (id: 'codex', enabled: boolean): void => {
    if (!settings) return
    void update({
      ...settings,
      externalApps: { ...settings.externalApps, [id]: enabled },
    }, `app:${id}`)
  }

  const accountAction = async (id: TokenSaverAccountId, connected: boolean): Promise<void> => {
    setBusy(`account:${id}`)
    try {
      const next = connected
        ? await window.ndDshTokenSaver.disconnectAccount(id)
        : await window.ndDshTokenSaver.connectAccount(id)
      setState(next)
    } catch (cause) {
      onError(message(cause))
    } finally {
      setBusy(null)
    }
  }

  const runDemo = async (): Promise<void> => {
    setBusy('demo')
    setDemoNotice(null)
    try {
      const result = await window.ndDshTokenSaver.runDemo()
      const percent = result.originalChars > 0 ? Math.round((result.avoidedChars / result.originalChars) * 100) : 0
      setDemoNotice(`Demo passed · ${percent}% smaller · local recovery verified`)
      setState(await window.ndDshTokenSaver.state())
    } catch (cause) {
      onError(message(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <SettingsSection title="Token Saver" className="mt-3.5">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Save tokens in ND</strong>
              <span className={rowDesc}>Built in. Reduce repeated/noisy context automatically without changing how you code.</span>
            </div>
            <Switch
              aria-label="Save tokens in ND"
              checked={builtInEnabled}
              disabled={!state || busy !== null}
              onCheckedChange={setBuiltIn}
            />
          </SettingsRow>

          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Mode</strong>
              <span className={rowDesc}>Automatic is recommended. Advanced keeps quality protection visible.</span>
            </div>
            <div className="flex shrink-0 gap-1">
              {(['off', 'automatic', 'advanced'] as const).map((mode) => (
                <SettingsButton
                  key={mode}
                  active={settings?.mode === mode}
                  disabled={!state || busy !== null}
                  onClick={() => setMode(mode)}
                >
                  {mode === 'off' ? 'Off' : mode === 'automatic' ? 'Automatic' : 'Advanced'}
                </SettingsButton>
              ))}
            </div>
          </SettingsRow>

          {settings?.mode === 'advanced' ? (
            <SettingsRow>
              <div className={rowStack}>
                <strong className={rowTitle}>Quality protection</strong>
                <span className={rowDesc}>Use the original content whenever an optimization fails or is not worth applying.</span>
              </div>
              <Switch
                aria-label="Quality protection"
                checked={settings.qualityProtection}
                disabled={busy !== null}
                onCheckedChange={(checked) => void update({ ...settings, qualityProtection: checked }, 'quality')}
              />
            </SettingsRow>
          ) : null}

          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Savings</strong>
              <span className={rowDesc}>These counters show ND-local avoided content. Harness history/tool-result compaction follows the same switch but is not estimated into this number yet.</span>
              {demoNotice ? <span className={rowPathText}>{demoNotice}</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={rowValueText}>~{formatNumber(savings.tokens)} tokens · {savings.percent}%</span>
              <SettingsButton disabled={!builtInEnabled || busy !== null} onClick={() => void runDemo()}>
                {busy === 'demo' ? 'Testing…' : 'Run demo'}
              </SettingsButton>
              <SettingsButton
                disabled={!state || busy !== null || state.counters.operations === 0}
                onClick={() => {
                  setBusy('reset')
                  setDemoNotice(null)
                  void window.ndDshTokenSaver.resetCounters()
                    .then(setState)
                    .catch((cause) => onError(message(cause)))
                    .finally(() => setBusy(null))
                }}
              >
                Reset
              </SettingsButton>
            </div>
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection title="External apps">
        <div className="space-y-1.5">
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Enable for external apps</strong>
              <span className={rowDesc}>Optional and off by default. ND only changes apps you explicitly enable, and restores ND-managed changes when disabled.</span>
            </div>
            <Switch
              aria-label="Enable Token Saver for external apps"
              checked={settings?.externalEnabled ?? false}
              disabled={!state || busy !== null}
              onCheckedChange={setExternal}
            />
          </SettingsRow>

          {state?.externalApps.map((app) => (
            <SettingsRow key={app.id}>
              <div className={rowStack}>
                <strong className={rowTitle}>{app.name}</strong>
                <span className={rowDesc}>{app.detail}</span>
                <span className={rowPathText}>{app.detected ? 'Detected on this computer' : 'Not detected yet'}</span>
              </div>
              {app.id === 'codex' && app.supported ? (
                <div className="flex shrink-0 items-center gap-2">
                  {busy === 'app:codex' ? <span className={rowValueText}>Setting up…</span> : null}
                  <Switch
                    aria-label="Optimize external Codex"
                    checked={app.enabled}
                    disabled={!settings?.externalEnabled || busy !== null}
                    onCheckedChange={(checked) => setExternalApp('codex', checked)}
                  />
                </div>
              ) : (
                <StatusChip neutral>{app.support === 'limited' ? 'Account only' : 'Unavailable'}</StatusChip>
              )}
            </SettingsRow>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection title="Accounts">
        <div className="space-y-1.5">
          {state?.accounts.map((account) => (
            <SettingsRow key={account.id}>
              <div className={rowStack}>
                <strong className={rowTitle}>{account.name}</strong>
                <span className={rowDesc}>{account.detail}</span>
                {account.email ? <span className={rowPathText}>{account.email}</span> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusChip good={account.connected} warn={!account.connected && account.available}>
                  {account.connected ? 'Connected' : account.available ? 'Not connected' : 'Unavailable'}
                </StatusChip>
                {account.connectable ? (
                  <SettingsButton
                    disabled={busy !== null}
                    onClick={() => void accountAction(account.id, account.connected)}
                  >
                    {busy === `account:${account.id}` ? 'Working…' : account.connected ? 'Disconnect' : 'Connect'}
                  </SettingsButton>
                ) : null}
              </div>
            </SettingsRow>
          ))}
          <SettingsRow>
            <div className={rowStack}>
              <strong className={rowTitle}>Account status</strong>
              <span className={rowDesc}>This release intentionally exposes only Codex and Antigravity account sign-in.</span>
            </div>
            <SettingsButton
              disabled={busy !== null}
              onClick={() => {
                setBusy('refresh')
                void window.ndDshTokenSaver.refreshAccounts()
                  .then(setState)
                  .catch((cause) => onError(message(cause)))
                  .finally(() => setBusy(null))
              }}
            >
              Refresh
            </SettingsButton>
          </SettingsRow>
        </div>
      </SettingsSection>
    </>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
