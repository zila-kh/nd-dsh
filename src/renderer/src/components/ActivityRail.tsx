import { BrowserIcon, ChatIcon, FilesIcon, GitIcon, SettingsIcon } from './Icons'

interface ActivityRailProps {
  browserActive: boolean
  settingsActive: boolean
  onBrowser(): void
  onSettings(): void
}

export function ActivityRail({ browserActive, settingsActive, onBrowser, onSettings }: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label="Primary activity">
      <div className="activity-group">
        <button className="activity-button active" title="Explorer" aria-label="Explorer"><FilesIcon /></button>
        <button className={`activity-button ${browserActive ? 'active-secondary' : ''}`} title="Browser" aria-label="Browser" onClick={onBrowser}><BrowserIcon /></button>
        <button className="activity-button" title="Agent" aria-label="Agent"><ChatIcon /></button>
        <button className="activity-button" title="Source Control (coming next)" aria-label="Source Control"><GitIcon /></button>
      </div>
      <button className={`activity-button ${settingsActive ? 'active-secondary' : ''}`} title="Settings" aria-label="Settings" onClick={onSettings}><SettingsIcon /></button>
    </nav>
  )
}
