import { SidebarToggleIcon } from './Icons'

interface RightSidebarToggleProps {
  isCollapsed: boolean
  onToggle(): void
}

export function RightSidebarToggle({ isCollapsed, onToggle }: RightSidebarToggleProps) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      aria-label="Toggle right sidebar"
      aria-pressed={isCollapsed}
      onClick={onToggle}
    >
      <SidebarToggleIcon collapsed={isCollapsed} />
    </button>
  )
}
