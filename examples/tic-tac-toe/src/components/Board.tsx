import React, { useRef, useEffect } from 'react';
import type { BoardState, Player, WinResult } from '../types/game.js';
import { getCellAriaLabel, isCellInWinningLine, indexToCoordinates } from '../game/evaluator.js';
import { Square } from './Square.js';

export interface BoardProps {
  /** 9-cell board state */
  board: BoardState;
  /** Active win result if game is won */
  winResult: WinResult | null;
  /** Whether the game is over (won or draw) */
  isGameOver: boolean;
  /** Currently active roving tabindex cell index (0..8) */
  focusedIndex: number;
  /** Current player whose turn it is (used for ghost hover preview) */
  currentPlayer: Player;
  /** Cell selection callback */
  onCellClick: (index: number) => void;
  /** Cell focus change callback */
  onCellFocus: (index: number) => void;
}

/**
 * Accessible 3x3 Board component using the Composite Button Matrix pattern.
 *
 * Provides:
 * - `<div role="region" aria-label="Tic-Tac-Toe Game Board">`
 * - 2D roving tabindex keyboard navigation across 9 cell buttons
 * - Boundary clamping for Arrow keys, Home, End, PageUp, PageDown
 * - Winning triplet line highlighting
 */
export function Board({
  board,
  winResult,
  isGameOver,
  focusedIndex,
  currentPlayer,
  onCellClick,
  onCellFocus,
}: BoardProps): React.JSX.Element {
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Focus the active cell button when focusedIndex changes via keyboard navigation
  useEffect(() => {
    const targetButton = cellRefs.current[focusedIndex];
    if (targetButton && document.activeElement !== targetButton) {
      // Only focus if a board cell or the board container was previously focused or if user interacted with keyboard
      if (
        document.activeElement &&
        (document.activeElement.classList.contains('ttt-square') ||
          document.activeElement.closest('.ttt-board-region'))
      ) {
        targetButton.focus();
      }
    }
  }, [focusedIndex]);

  const handleCellKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ): void => {
    const { row, col } = indexToCoordinates(index); // 1-indexed row (1..3), col (1..3)
    let nextIndex: number | null = null;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (col < 3) {
          nextIndex = index + 1;
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (col > 1) {
          nextIndex = index - 1;
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (row < 3) {
          nextIndex = index + 3;
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (row > 1) {
          nextIndex = index - 3;
        }
        break;

      case 'Home':
        e.preventDefault();
        // Ctrl+Home jumps to Top-Left (index 0); Home jumps to start of current row
        nextIndex = e.ctrlKey ? 0 : (row - 1) * 3;
        break;

      case 'End':
        e.preventDefault();
        // Ctrl+End jumps to Bottom-Right (index 8); End jumps to end of current row
        nextIndex = e.ctrlKey ? 8 : (row - 1) * 3 + 2;
        break;

      case 'PageUp':
        e.preventDefault();
        // Jump to top row in the same column
        nextIndex = col - 1;
        break;

      case 'PageDown':
        e.preventDefault();
        // Jump to bottom row in the same column
        nextIndex = 6 + (col - 1);
        break;

      case 'Enter':
      case ' ':
        // Space / Enter handled natively by button click, but prevent default page scroll for Space
        if (e.key === ' ') {
          e.preventDefault();
          onCellClick(index);
        }
        break;

      default:
        break;
    }

    if (nextIndex !== null && nextIndex >= 0 && nextIndex < 9) {
      onCellFocus(nextIndex);
      cellRefs.current[nextIndex]?.focus();
    }
  };

  const hasWinner = winResult !== null;

  return (
    <div
      role="region"
      aria-label="Tic-Tac-Toe Game Board"
      className="ttt-board-region"
    >
      <div className="ttt-board-grid">
        {board.map((cellValue, idx) => {
          const { row, col } = indexToCoordinates(idx);
          const isWinning = isCellInWinningLine(idx, winResult);
          const isDimmed = hasWinner && !isWinning;
          const isFocused = idx === focusedIndex;
          const ariaLabel = getCellAriaLabel(idx, board, winResult);

          return (
            <Square
              key={idx}
              ref={(el) => {
                cellRefs.current[idx] = el;
              }}
              index={idx}
              row={row}
              col={col}
              value={cellValue}
              isWinning={isWinning}
              isDimmed={isDimmed}
              isFocused={isFocused}
              isGameOver={isGameOver}
              ariaLabel={ariaLabel}
              previewMark={currentPlayer}
              onClick={onCellClick}
              onFocus={onCellFocus}
              onKeyDown={handleCellKeyDown}
            />
          );
        })}
      </div>
    </div>
  );
}
