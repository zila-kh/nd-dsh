import type {
  BoardState,
  CellCoordinate,
  GameStatus,
  Player,
  WinResult,
} from '../types/game.js';
import {
  BOARD_SIZE,
  CELL_POSITION_NAMES,
  TOTAL_CELLS,
  WINNING_COMBINATIONS,
} from './constants.js';

/**
 * Checks whether an index is a valid 0-based cell index on a 3x3 grid (0..8).
 */
export function isValidCellIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < TOTAL_CELLS;
}

/**
 * Converts a 0-based cell index (0..8) into 1-indexed row/column coordinates and semantic name.
 * Throws a RangeError if the index is outside 0..8.
 */
export function indexToCoordinates(index: number): CellCoordinate {
  if (!isValidCellIndex(index)) {
    throw new RangeError(`Invalid cell index: ${index}. Expected integer from 0 to ${TOTAL_CELLS - 1}.`);
  }

  const row = Math.floor(index / BOARD_SIZE) + 1;
  const col = (index % BOARD_SIZE) + 1;
  const name = CELL_POSITION_NAMES[index] ?? `Row ${row}, Column ${col}`;

  return { row, col, name };
}

/**
 * Converts 1-indexed (row, col) coordinates back into a 0-based cell index (0..8).
 * Throws a RangeError if coordinates are outside 1..3.
 */
export function coordinatesToIndex(row: number, col: number): number {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 1 ||
    row > BOARD_SIZE ||
    col < 1 ||
    col > BOARD_SIZE
  ) {
    throw new RangeError(`Invalid row/col coordinates: (${row}, ${col}). Expected integers 1..${BOARD_SIZE}.`);
  }

  return (row - 1) * BOARD_SIZE + (col - 1);
}

/**
 * Evaluates the board against all 8 winning lines.
 * Returns a `WinResult` object if a player has three matching marks along a line, or `null`.
 */
export function calculateWinner(board: BoardState): WinResult | null {
  for (const { line, description } of WINNING_COMBINATIONS) {
    const [a, b, c] = line;
    const cellA = board[a];
    const cellB = board[b];
    const cellC = board[c];

    if (cellA !== null && cellA !== undefined && cellA === cellB && cellA === cellC) {
      return {
        winner: cellA,
        line: [a, b, c],
        description,
      };
    }
  }

  return null;
}

/**
 * Checks whether all 9 cells of the board are filled with player marks.
 */
export function isBoardFull(board: BoardState): boolean {
  return board.every((cell) => cell !== null);
}

/**
 * Checks whether the current board is in a draw state (all 9 cells filled and no winning line).
 */
export function isDraw(board: BoardState): boolean {
  return isBoardFull(board) && calculateWinner(board) === null;
}

/**
 * Evaluates the overall game status ('in_progress', 'won', or 'draw') along with any win result.
 */
export function calculateGameStatus(board: BoardState): {
  status: GameStatus;
  winResult: WinResult | null;
} {
  const winResult = calculateWinner(board);
  if (winResult !== null) {
    return {
      status: 'won',
      winResult,
    };
  }

  if (isBoardFull(board)) {
    return {
      status: 'draw',
      winResult: null,
    };
  }

  return {
    status: 'in_progress',
    winResult: null,
  };
}

/**
 * Returns the opposite player's turn ('X' -> 'O', 'O' -> 'X').
 */
export function getNextPlayer(currentPlayer: Player): Player {
  return currentPlayer === 'X' ? 'O' : 'X';
}

/**
 * Checks whether a specific cell index is part of the active winning line.
 */
export function isCellInWinningLine(
  cellIndex: number,
  winResult: WinResult | null
): boolean {
  if (winResult === null) {
    return false;
  }
  return winResult.line.includes(cellIndex);
}

/**
 * Counts marks placed on the board (X count, O count, and empty cell count).
 */
export function countMarks(board: BoardState): {
  xCount: number;
  oCount: number;
  emptyCount: number;
} {
  let xCount = 0;
  let oCount = 0;
  let emptyCount = 0;

  for (const cell of board) {
    if (cell === 'X') {
      xCount += 1;
    } else if (cell === 'O') {
      oCount += 1;
    } else {
      emptyCount += 1;
    }
  }

  return { xCount, oCount, emptyCount };
}

/**
 * Returns a list of all currently available (empty) cell indices.
 */
export function getAvailableMoves(board: BoardState): number[] {
  const available: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) {
      available.push(i);
    }
  }
  return available;
}

/**
 * Generates the WCAG 2.1 AA accessible name for a board cell button.
 * Formats:
 * - Empty: "Row {r}, Column {c}, Empty"
 * - Occupied: "Row {r}, Column {c}, {Mark}"
 * - Occupied & Winning: "Row {r}, Column {c}, {Mark}, Winning square"
 */
export function getCellAriaLabel(
  cellIndex: number,
  board: BoardState,
  winResult: WinResult | null = null
): string {
  const { row, col } = indexToCoordinates(cellIndex);
  const mark = board[cellIndex];

  if (mark === null) {
    return `Row ${row}, Column ${col}, Empty`;
  }

  if (isCellInWinningLine(cellIndex, winResult)) {
    return `Row ${row}, Column ${col}, ${mark}, Winning square`;
  }

  return `Row ${row}, Column ${col}, ${mark}`;
}
