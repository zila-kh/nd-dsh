import { useState } from 'react'
import type { BrowserPlatformState } from '../../../shared/browser-platform'
import {
  SettingsButton,
  SettingsRow,
  SettingsSwitch,
  StatusChip,
  rowDesc,
  rowStack,
  rowTitle,
} from './settings-primitives'

interface BrowserExtensionsManagerProps {
  platform: BrowserPlatformState | null
  onError(message: string): void
  /** Switches to the built-in browser view, used where an action is only visible there. */
  onOpenBrowser(): void
}

/**
 * The single canonical manager for extensions in the ND built-in Chromium
 * profile. Rendered in Settings → General → Browser; the browser-pane toolbar
 * popover offers quick toggles and links here for everything else.
 */
export function BrowserExtensionsManager({ platform, onError, onOpenBrowser }: BrowserExtensionsManagerProps) {
  const [search, setSearch] = useState('')

  return (
    <div className="space-y-2 rounded-lg border border-border-soft bg-secondary/35 p-3">
      <div className="flex items-center gap-2">
        <input
          aria-label="Search browser extensions"
          placeholder="Search extensions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-[28px] min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[10px] outline-none focus:border-(--border-focus)"
        />
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[9px] font-semibold text-soft">Developer mode</span>
          <SettingsSwitch
            label="Browser extension developer mode"
            checked={platform?.developerMode === true}
            disabled={platform === null}
            onCheckedChange={(enabled) => {
              void window.ndDsh.browserPlatform.setDeveloperMode(enabled)
                .catch((cause) => onError(errorMessage(cause)))
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <SettingsButton
          disabled={platform?.developerMode !== true}
          onClick={() => {
            void window.ndDsh.browserPlatform.installExtension()
              .catch((cause) => onError(errorMessage(cause)))
          }}
        >
          Load unpacked
        </SettingsButton>
        <SettingsButton onClick={() => {
          void window.ndDsh.browserPlatform.reloadExtensions()
            .catch((cause) => onError(errorMessage(cause)))
        }}>
          Reload extensions
        </SettingsButton>
      </div>

      <div className="pt-1">
        <strong className="block text-[10px] font-semibold text-strong">Built-in catalog</strong>
        <span className="text-[9px] text-faint">First-party items are bundled with ND. Third-party store entries are reference-only; local folders are tested separately through Developer mode without launching external Chrome.</span>
      </div>
      {(platform?.extensionCatalog ?? [])
        .filter((item) => {
          const query = search.trim().toLowerCase()
          return !query || item.name.toLowerCase().includes(query) || item.publisher.toLowerCase().includes(query)
        })
        .map((item) => (
          <SettingsRow key={item.id}>
            <div className={rowStack}>
              <strong className={rowTitle}>{item.name} · {item.publisher}</strong>
              <span className={rowDesc}>{item.description} · {item.compatibility}{item.note ? ` · ${item.note}` : ''}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {item.installed ? (
                <StatusChip good>{item.installedSource === 'unpacked' ? 'Loaded package' : 'Installed'}</StatusChip>
              ) : (
                <SettingsButton
                  disabled={!item.bundleAvailable || item.packagePolicy === 'reference-only'}
                  onClick={() => {
                    void window.ndDsh.browserPlatform.installCatalogExtension(item.id)
                      .catch((cause) => onError(errorMessage(cause)))
                  }}
                >
                  {item.bundleAvailable
                    ? 'Install'
                    : item.packagePolicy === 'reference-only'
                      ? 'Reference only'
                      : 'Unavailable'}
                </SettingsButton>
              )}
              {item.storeUrl ? (
                <SettingsButton onClick={() => {
                  void window.ndDsh.browserPlatform.openCatalogExtension(item.id)
                    .then(() => onOpenBrowser())
                    .catch((cause) => onError(errorMessage(cause)))
                }}>
                  View in ND browser
                </SettingsButton>
              ) : null}
            </div>
          </SettingsRow>
        ))}

      <div className="pt-1">
        <strong className="block text-[10px] font-semibold text-strong">Installed extensions</strong>
      </div>
      {(platform?.extensions ?? [])
        .filter((extension) => {
          const query = search.trim().toLowerCase()
          return !query || extension.name.toLowerCase().includes(query) || extension.publisher?.toLowerCase().includes(query)
        })
        .map((extension) => (
          <SettingsRow key={extension.id}>
            <div className={rowStack}>
              <strong className={rowTitle}>{extension.name}</strong>
              <span className={rowDesc}>
                {extension.version} · MV{extension.manifestVersion ?? '?'} · {extension.status}
                {extension.publisher ? ` · ${extension.publisher}` : ''}
                {extension.error ? ` · ${extension.error}` : ''}
                {extension.compatibilityNotes?.length ? ` · ${extension.compatibilityNotes.join(' ')}` : ''}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {extension.enabled && extension.status !== 'error' && extension.actionPopup ? (
                <SettingsButton onClick={() => {
                  void window.ndDsh.browserPlatform.showExtensionPopup(extension.id)
                    .then(() => onOpenBrowser())
                    .catch((cause) => onError(errorMessage(cause)))
                }}>Open popup</SettingsButton>
              ) : null}
              <SettingsSwitch
                label={`${extension.enabled ? 'Disable' : 'Enable'} ${extension.name}`}
                checked={extension.enabled}
                onCheckedChange={(enabled) => {
                  void window.ndDsh.browserPlatform.setExtensionEnabled(extension.id, enabled)
                    .catch((cause) => onError(errorMessage(cause)))
                }}
              />
              <SettingsButton onClick={() => {
                void window.ndDsh.browserPlatform.removeExtension(extension.id)
                  .catch((cause) => onError(errorMessage(cause)))
              }}>Remove</SettingsButton>
            </div>
          </SettingsRow>
        ))}
    </div>
  )
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
