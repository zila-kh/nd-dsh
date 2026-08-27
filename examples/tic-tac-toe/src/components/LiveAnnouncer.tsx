import React from 'react';

export interface LiveAnnouncerProps {
  /** Non-urgent announcement message (turn progression, time travel) */
  politeMessage: string;
  /** Urgent announcement message (win, draw, invalid move, reset) */
  assertiveMessage: string;
}

/**
 * LiveAnnouncer component managing dual ARIA live regions for assistive technologies.
 *
 * Implements WCAG 2.1 AA 4.1.3 (Status Messages):
 * - `role="status"` with `aria-live="polite"` for non-urgent regular turns & history jumps
 * - `role="alert"` with `aria-live="assertive"` for critical game state changes (win, draw, invalid move, reset)
 */
export function LiveAnnouncer({
  politeMessage,
  assertiveMessage,
}: LiveAnnouncerProps): React.JSX.Element {
  return (
    <div className="ttt-announcers-container" aria-hidden="false">
      {/* Polite Live Region: Status announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only ttt-sr-status"
      >
        {politeMessage}
      </div>

      {/* Assertive Live Region: Urgent alerts & game conclusion */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only ttt-sr-alert"
      >
        {assertiveMessage}
      </div>
    </div>
  );
}
