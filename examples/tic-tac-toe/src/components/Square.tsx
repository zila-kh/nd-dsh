import React from 'react';
import type { Player } from '../types/game.js';

export interface SquareProps {
  /** 0-based cell index (0..8) */
  index: number;
  /** 1-based row coordinate (1..3) */
  row: number;
  /** 1-based column coordinate (1..3) */
  col: number;
  /** Current value in cell: 'X' | 'O' | null */
  value: Player | null;
  /** Whether this cell is part of the winning line */
  isWinning: boolean;
  /** Whether the game is in a won state (and another line won) */
  isDimmed: boolean;
  /** Whether this cell has roving tabindex focus */
  isFocused: boolean;
  /** Whether the board / cell is disabled for clicks (game over or occupied) */
  isGameOver: boolean;
  /** Accessible label for the cell button */
  ariaLabel: string;
  /** Preview mark for hover ghost effect when empty */
  previewMark?: Player | null;
  /** Click handler */
  onClick: (index: number) => void;
  /** Focus handler */
  onFocus: (index: number) => void;
  /** Key down handler for 2D keyboard navigation */
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => void;
}

/**
 * Modern SVG icon for Player X (sharp geometric cross with distinct primary styling).
 */
export function IconX({ className = 'token-icon token-x' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * Modern SVG icon for Player O (smooth geometric ring with distinct secondary styling).
 */
export function IconO({ className = 'token-icon token-o' }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

/**
 * Accessible Square component representing an individual cell in the 3x3 Tic-Tac-Toe grid.
 *
 * Implements:
 * - 2D Roving tabIndex (`tabIndex={isFocused ? 0 : -1}`)
 * - Focusable `aria-disabled="true"` for occupied cells to prevent broken arrow key navigation
 * - Dynamic ARIA labels reflecting coordinate, value, and winning status
 * - Non-color-only visual indicators (SVG glyphs + distinct high-contrast colors)
 * - Winning highlight animations and ghost preview on hover
 */
export const Square = React.forwardRef<HTMLButtonElement, SquareProps>(
  function Square(props, ref) {
    const {
      index,
      row,
      col,
      value,
      isWinning,
      isDimmed,
      isFocused,
      isGameOver,
      ariaLabel,
      previewMark,
      onClick,
      onFocus,
      onKeyDown,
    } = props;

    const isOccupied = value !== null;
    const isInteractive = !isGameOver && !isOccupied;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>): void => {
      e.preventDefault();
      onClick(index);
    };

    const handleFocus = (): void => {
      onFocus(index);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
      onKeyDown(e, index);
    };

    // Construct descriptive CSS classes
    const classNames = [
      'ttt-square',
      value ? `ttt-square--${value.toLowerCase()}` : 'ttt-square--empty',
      isWinning ? 'ttt-square--winning' : '',
      isDimmed ? 'ttt-square--dimmed' : '',
      isFocused ? 'ttt-square--focused' : '',
      isInteractive ? 'ttt-square--interactive' : 'ttt-square--disabled',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button
        ref={ref}
        type="button"
        className={classNames}
        tabIndex={isFocused ? 0 : -1}
        aria-label={ariaLabel}
        aria-disabled={!isInteractive}
        data-index={index}
        data-row={row}
        data-col={col}
        data-value={value ?? 'empty'}
        data-winning={isWinning ? 'true' : 'false'}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
      >
        {value === 'X' && <IconX />}
        {value === 'O' && <IconO />}
        {value === null && previewMark && isInteractive && (
          <span className="ttt-square__ghost-preview" aria-hidden="true">
            {previewMark === 'X' ? <IconX className="token-icon token-ghost token-x" /> : <IconO className="token-icon token-ghost token-o" />}
          </span>
        )}
      </button>
    );
  }
);

Square.displayName = 'Square';
