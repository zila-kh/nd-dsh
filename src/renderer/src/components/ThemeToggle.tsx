import type { ThemeMode, ThemeState } from '../../../shared/contracts'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { TitlebarIconButton } from './titlebar-icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

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
  const ActiveIcon = OPTIONS.find((option) => option.mode === theme?.mode)?.Icon ?? MonitorIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TitlebarIconButton title={`Theme: ${theme?.mode ?? 'system'}`} aria-label="Theme">
          <ActiveIcon />
        </TitlebarIconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme?.mode ?? 'system'}
          onValueChange={(value) => onSelect(value as ThemeMode)}
        >
          {OPTIONS.map(({ mode, label, Icon }) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              <Icon className="size-3.5" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
