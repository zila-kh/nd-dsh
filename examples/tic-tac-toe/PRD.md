# Tic-Tac-Toe Game — Product Requirements & Accessibility Specification

This directory contains the official specification and requirements for the **Tic-Tac-Toe Beta Acceptance** project at ND.

## Documents
- **Complete PRD & A11y Specification:** [`docs/PRD_UX_A11Y_SPEC.md`](./docs/PRD_UX_A11Y_SPEC.md)
- **Accessible Grid Interaction Patterns Research:** [`docs/ACCESSIBLE_GRID_PATTERNS_RESEARCH.md`](./docs/ACCESSIBLE_GRID_PATTERNS_RESEARCH.md)

## Summary of Acceptance Criteria & Requirements
- **Turn Indicators:** Clear visual pill & player card indicating current active player ('X' vs 'O') with distinct non-color glyphs and subtle animations.
- **Winning Line Highlights:** Real-time evaluation of all 8 winning combinations (3 rows, 3 columns, 2 diagonals) with high-contrast cell accents, line overlays, and victory announcements.
- **Draw State Handling:** Automated detection of stalemate when 9 cells are filled without a winning line, presenting a celebratory draw banner and restart prompt.
- **Move History & Time-Travel Replay:** Step-by-step interactive history allowing users to inspect past board states and branch timelines.
- **Accessibility (WCAG 2.1 AA):**
  - **Keyboard Navigation:** 2D Arrow key navigation across the 3x3 board using the roving tabindex pattern, Home/End shortcuts, Enter/Space placement, and global shortcuts.
  - **ARIA Live Regions:** Dual `polite` and `assertive` live regions broadcasting real-time updates for turns, moves, occupied cell warnings, victory/draw banners, time travel jumps, and resets.
  - **Color & Contrast:** Strict 4.5:1 text/icon contrast, 3:1 UI component contrast, distinct token shapes, and high-visibility focus rings.
- **Game Reset Flow:** Instant restart action resetting the 3x3 board, turns, and history while returning keyboard focus to the initial cell with screen reader announcements.
