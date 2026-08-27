import React from 'react'
import type { GameAnnouncement } from '../../types/index.js'

interface AriaLiveRegionProps {
  announcement: GameAnnouncement | null
}

export const AriaLiveRegion: React.FC<AriaLiveRegionProps> = ({ announcement }) => {
  const isAssertive = announcement?.politeness === 'assertive'

  return (
    <div className="sr-only" data-testid="aria-live-container">
      {/* Polite live region for normal game progress and bet changes */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="aria-live-polite"
      >
        {!isAssertive ? announcement?.message : ''}
      </div>

      {/* Assertive live region for critical errors or urgent warnings */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        data-testid="aria-live-assertive"
      >
        {isAssertive ? announcement?.message : ''}
      </div>
    </div>
  )
}
