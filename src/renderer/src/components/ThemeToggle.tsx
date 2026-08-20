import { useEffect, useRef, useState } from 'react'
import type { ThemeMode, ThemeState } from '../../../shared/contracts'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'

interface ThemeToggleProps {
  theme: ThemeState | null
  onSelect(mode: ThemeMode): void
}

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'system', label: 'System', Icon: MonitorIcon },
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
]

export function ThemeToggle({ theme, onSelect }: ThemeToggleProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const activeIcon = OPTIONS.find((option) => option.mode === theme?.mode) ?? OPTIONS[0]
  const ActiveIcon = activeIcon?.Icon ?? MonitorIcon

  return (
    <div className="theme-toggle" ref={rootRef}>
      <button
        className="theme-toggle-button"
        title={`Theme: ${theme?.mode ?? 'system'}`}
        aria-label="Theme"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ActiveIcon />
      </button>
      {open ? (
        <div className="theme-menu" role="menu" aria-label="Theme settings">
          {OPTIONS.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              role="menuitemradio"
              aria-checked={theme?.mode === mode}
              className={theme?.mode === mode ? 'active' : ''}
              onClick={() => {
                onSelect(mode)
                setOpen(false)
              }}
            >
              <Icon />
              <span>{label}</span>
              {theme?.mode === mode ? <span className="theme-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
