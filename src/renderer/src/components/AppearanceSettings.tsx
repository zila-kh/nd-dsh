import type { ThemeMode, ThemeState } from '../../../shared/contracts'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { SettingsRow, SettingsSection, rowDesc, rowStack, rowTitle } from './settings-primitives'
import { cn } from '../lib/utils'

interface AppearanceSettingsProps {
  theme: ThemeState | null
  onSelectTheme(mode: ThemeMode): void
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'system', label: 'System', Icon: MonitorIcon },
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
]

/** Appearance tab: follow the OS, or pin light or dark mode. */
export function AppearanceSettings({ theme, onSelectTheme }: AppearanceSettingsProps) {
  return (
    <SettingsSection title="Appearance" className="mt-3.5">
      <SettingsRow>
        <div className={rowStack}>
          <strong className={rowTitle}>Theme</strong>
          <span className={rowDesc}>Follow the OS, or pin light or dark mode.</span>
        </div>
        <div role="radiogroup" aria-label="Theme" className="flex shrink-0 gap-[3px] rounded-[7px] border border-border bg-secondary p-[3px]">
          {THEME_OPTIONS.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              role="radio"
              aria-checked={theme?.mode === mode}
              aria-label={label}
              title={label}
              className={cn(
                'grid size-[30px] h-6 place-items-center rounded-[5px] transition-colors [&_svg]:size-[13px]',
                theme?.mode === mode ? 'bg-primary/10 text-primary' : 'text-faint hover:bg-accent hover:text-foreground',
              )}
              onClick={() => onSelectTheme(mode)}
            >
              <Icon />
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  )
}
