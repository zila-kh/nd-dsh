import { SidebarToggleIcon } from './Icons'

interface LeftSidebarToggleProps {
  isCollapsed: boolean
  onToggle(): void
}

export function LeftSidebarToggle({ isCollapsed, onToggle }: LeftSidebarToggleProps) {
  return (
    <button
      type="button"
      className="sidebar-toggle left-sidebar-toggle"
      aria-label="Toggle left sidebar"
      aria-pressed={isCollapsed}
      onClick={onToggle}
    >
      {/* mirror the right-sidebar icon: collapsed=true means panel is hidden, show arrow pointing right to open */}
      <SidebarToggleIcon collapsed={!isCollapsed} />
    </button>
  )
}
