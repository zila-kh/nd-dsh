import { useEffect, useState } from 'react'
import type { CodingEngineInstallHelp } from '../../../shared/contracts'
import { codingEngineInstallCommand } from '../../../shared/coding-engines'
import { CheckIcon, CopyIcon } from './Icons'
import { SettingsButton } from './settings-primitives'

// One platform lookup per renderer session; every help row shares it.
let platformPromise: Promise<string> | undefined

function currentPlatform(): Promise<string> {
  platformPromise ??= window.ndDsh.app.info()
    .then((info) => info.platform)
    .catch(() => '')
  return platformPromise
}

interface EngineInstallHelpProps {
  help?: CodingEngineInstallHelp | undefined
  retrying: boolean
  onRetry(): void
  onError(message: string): void
}

/**
 * Guidance for a third-party CLI engine ND cannot install itself: the official
 * page, a copyable official command, and a re-detect trigger for after the
 * user installs it.
 */
export function EngineInstallHelp({ help, retrying, onRetry, onError }: EngineInstallHelpProps) {
  const [platform, setPlatform] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let disposed = false
    void currentPlatform().then((value) => {
      if (!disposed) setPlatform(value)
    })
    return () => { disposed = true }
  }, [])

  const command = codingEngineInstallCommand(help, platform)
  const copy = async (): Promise<void> => {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      onError('Clipboard access is unavailable here.')
    }
  }

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {help?.url ? (
        <button
          type="button"
          className="text-[11px] font-medium text-primary hover:underline"
          onClick={() => void window.ndDsh.browser
            .openExternal(help.url ?? '')
            .catch((cause) => onError(cause instanceof Error ? cause.message : String(cause)))}
        >
          How to install →
        </button>
      ) : null}
      {command ? (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-soft bg-surface-0 px-2 py-1">
          <code className="min-w-0 truncate font-mono text-[9.5px] text-soft" title={`Install command (${platform})`}>{command}</code>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium text-faint transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[9px]"
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      <SettingsButton disabled={retrying} onClick={onRetry} className="px-2 py-1 text-[9px]">
        {retrying ? 'Re-checking…' : 'Re-check'}
      </SettingsButton>
    </div>
  )
}
