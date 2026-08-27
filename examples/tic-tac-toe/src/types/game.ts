/**
 * Core game types and data structures for the Tic-Tac-Toe engine.
 * Adheres to the Product Requirements Document & WCAG 2.1 AA Accessibility Specification.
 */

/** Player marks: 'X' starts first by standard convention. */
export type Player = 'X' | 'O';

/** Cell value can be occupied by a Player ('X' | 'O') or empty (null). */
export type CellValue = Player | null;

/**
 * 3x3 board represented as a fixed 9-element tuple of CellValues.
 * Indices 0..8 correspond to row-major layout:
 * 0 | 1 | 2 (Row 1)
 * 3 | 4 | 5 (Row 2)
 * 6 | 7 | 8 (Row 3)
 */
export type BoardState = [
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue,
  CellValue, CellValue, CellValue
];

/** A triplet of board indices representing a winning combination. */
export type WinningLine = [number, number, number];

/** Winning combination configuration with accessible text description. */
export interface WinningCombination {
  readonly line: WinningLine;
  readonly description: string;
}

/** Result when a player achieves a winning line. */
export interface WinResult {
  readonly winner: Player;
  readonly line: WinningLine;
  readonly description: string;
}

/** Overall status of the game match. */
export type GameStatus = 'in_progress' | 'won' | 'draw';

/**
 * Historical record of an individual move for time-travel replay and undo/redo.
 */
export interface MoveRecord {
  readonly step: number;
  readonly player: Player;
  readonly cellIndex: number;
  readonly row: number; // 1-indexed (1..3)
  readonly col: number; // 1-indexed (1..3)
  readonly boardSnapshot: BoardState;
}

/**
 * Complete immutable game state container.
 */
export interface GameState {
  readonly board: BoardState;
  readonly history: readonly MoveRecord[];
  readonly currentStep: number;
  readonly currentPlayer: Player;
  readonly status: GameStatus;
  readonly winResult: WinResult | null;
  readonly focusedCellIndex: number;
}

/**
 * Reason an attempted move may be invalid.
 */
export type InvalidMoveReason = 'out_of_bounds' | 'cell_occupied' | 'game_over';

/**
 * Detailed validation result for move attempts.
 */
export interface MoveValidationResult {
  readonly valid: boolean;
  readonly reason?: InvalidMoveReason;
  readonly message?: string;
}

/**
 * 1-indexed row/column coordinates and accessible semantic name.
 */
export interface CellCoordinate {
  readonly row: number;
  readonly col: number;
  readonly name: string;
}
