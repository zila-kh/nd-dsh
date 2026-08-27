import type { BoardState, Player, WinningCombination } from '../types/game.js';

/** Dimension of the square Tic-Tac-Toe grid. */
export const BOARD_SIZE = 3;

/** Total number of cells on a 3x3 grid. */
export const TOTAL_CELLS = 9;

/** Default starting player. */
export const INITIAL_PLAYER: Player = 'X';

/** Default focused cell index for keyboard navigation and initialization. */
export const INITIAL_FOCUSED_CELL_INDEX = 0;

/**
 * All 8 predefined winning triplets (3 rows, 3 columns, 2 diagonals)
 * with human-readable descriptions for UI and ARIA live announcements.
 */
export const WINNING_COMBINATIONS: readonly WinningCombination[] = [
  // 3 Horizontal Rows
  { line: [0, 1, 2], description: 'Top row (Row 1)' },
  { line: [3, 4, 5], description: 'Middle row (Row 2)' },
  { line: [6, 7, 8], description: 'Bottom row (Row 3)' },

  // 3 Vertical Columns
  { line: [0, 3, 6], description: 'Left column (Column 1)' },
  { line: [1, 4, 7], description: 'Middle column (Column 2)' },
  { line: [2, 5, 8], description: 'Right column (Column 3)' },

  // 2 Diagonals
  { line: [0, 4, 8], description: 'Main diagonal (Top-left to bottom-right)' },
  { line: [2, 4, 6], description: 'Anti-diagonal (Top-right to bottom-left)' },
] as const;

/**
 * Semantic position names for each cell index 0..8.
 */
export const CELL_POSITION_NAMES: readonly string[] = [
  'Top-Left',
  'Top-Center',
  'Top-Right',
  'Middle-Left',
  'Center',
  'Middle-Right',
  'Bottom-Left',
  'Bottom-Center',
  'Bottom-Right',
] as const;

/**
 * Factory function returning a brand new empty 3x3 board tuple.
 */
export function createEmptyBoard(): BoardState {
  return [null, null, null, null, null, null, null, null, null];
}
