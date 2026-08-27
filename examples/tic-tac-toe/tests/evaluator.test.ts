import { describe, expect, it } from 'vitest';
import type { BoardState } from '../src/types/game.js';
import {
  BOARD_SIZE,
  CELL_POSITION_NAMES,
  TOTAL_CELLS,
  WINNING_COMBINATIONS,
  createEmptyBoard,
} from '../src/game/constants.js';
import {
  calculateGameStatus,
  calculateWinner,
  coordinatesToIndex,
  countMarks,
  getAvailableMoves,
  getCellAriaLabel,
  getNextPlayer,
  indexToCoordinates,
  isBoardFull,
  isCellInWinningLine,
  isDraw,
  isValidCellIndex,
} from '../src/game/evaluator.js';

describe('Game Evaluator & Constants', () => {
  describe('Constants & Board Creation', () => {
    it('should define expected board dimensions', () => {
      expect(BOARD_SIZE).toBe(3);
      expect(TOTAL_CELLS).toBe(9);
    });

    it('should create an empty 9-cell board', () => {
      const board = createEmptyBoard();
      expect(board).toHaveLength(9);
      expect(board.every((c) => c === null)).toBe(true);
    });

    it('should have exactly 8 winning combinations', () => {
      expect(WINNING_COMBINATIONS).toHaveLength(8);
    });

    it('should have semantic names for all 9 cells', () => {
      expect(CELL_POSITION_NAMES).toHaveLength(9);
      expect(CELL_POSITION_NAMES[0]).toBe('Top-Left');
      expect(CELL_POSITION_NAMES[4]).toBe('Center');
      expect(CELL_POSITION_NAMES[8]).toBe('Bottom-Right');
    });
  });

  describe('Index and Coordinate conversions', () => {
    it('should validate cell indices correctly', () => {
      expect(isValidCellIndex(0)).toBe(true);
      expect(isValidCellIndex(4)).toBe(true);
      expect(isValidCellIndex(8)).toBe(true);
      expect(isValidCellIndex(-1)).toBe(false);
      expect(isValidCellIndex(9)).toBe(false);
      expect(isValidCellIndex(3.5)).toBe(false);
      expect(isValidCellIndex(Number.NaN)).toBe(false);
    });

    it('should convert 0..8 indices to 1-indexed (row, col) coordinates and semantic names', () => {
      expect(indexToCoordinates(0)).toEqual({ row: 1, col: 1, name: 'Top-Left' });
      expect(indexToCoordinates(1)).toEqual({ row: 1, col: 2, name: 'Top-Center' });
      expect(indexToCoordinates(2)).toEqual({ row: 1, col: 3, name: 'Top-Right' });
      expect(indexToCoordinates(3)).toEqual({ row: 2, col: 1, name: 'Middle-Left' });
      expect(indexToCoordinates(4)).toEqual({ row: 2, col: 2, name: 'Center' });
      expect(indexToCoordinates(5)).toEqual({ row: 2, col: 3, name: 'Middle-Right' });
      expect(indexToCoordinates(6)).toEqual({ row: 3, col: 1, name: 'Bottom-Left' });
      expect(indexToCoordinates(7)).toEqual({ row: 3, col: 2, name: 'Bottom-Center' });
      expect(indexToCoordinates(8)).toEqual({ row: 3, col: 3, name: 'Bottom-Right' });
    });

    it('should throw RangeError for invalid index in indexToCoordinates', () => {
      expect(() => indexToCoordinates(-1)).toThrow(RangeError);
      expect(() => indexToCoordinates(9)).toThrow(RangeError);
      expect(() => indexToCoordinates(2.5)).toThrow(RangeError);
    });

    it('should convert 1-indexed (row, col) coordinates to cell indices', () => {
      expect(coordinatesToIndex(1, 1)).toBe(0);
      expect(coordinatesToIndex(1, 2)).toBe(1);
      expect(coordinatesToIndex(1, 3)).toBe(2);
      expect(coordinatesToIndex(2, 1)).toBe(3);
      expect(coordinatesToIndex(2, 2)).toBe(4);
      expect(coordinatesToIndex(2, 3)).toBe(5);
      expect(coordinatesToIndex(3, 1)).toBe(6);
      expect(coordinatesToIndex(3, 2)).toBe(7);
      expect(coordinatesToIndex(3, 3)).toBe(8);
    });

    it('should throw RangeError for invalid coordinates in coordinatesToIndex', () => {
      expect(() => coordinatesToIndex(0, 1)).toThrow(RangeError);
      expect(() => coordinatesToIndex(1, 4)).toThrow(RangeError);
      expect(() => coordinatesToIndex(4, 1)).toThrow(RangeError);
      expect(() => coordinatesToIndex(1.5, 2)).toThrow(RangeError);
      expect(() => coordinatesToIndex(1, 2.5)).toThrow(RangeError);
    });
  });

  describe('Winning Lines Evaluation (All 8 Lines)', () => {
    it('should return null on an empty board', () => {
      const board = createEmptyBoard();
      expect(calculateWinner(board)).toBeNull();
    });

    it('should detect Horizontal Row 1 win [0, 1, 2] for X', () => {
      const board: BoardState = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'X',
        line: [0, 1, 2],
        description: 'Top row (Row 1)',
      });
    });

    it('should detect Horizontal Row 2 win [3, 4, 5] for O', () => {
      const board: BoardState = ['X', 'X', null, 'O', 'O', 'O', 'X', null, null];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'O',
        line: [3, 4, 5],
        description: 'Middle row (Row 2)',
      });
    });

    it('should detect Horizontal Row 3 win [6, 7, 8] for X', () => {
      const board: BoardState = ['O', 'O', null, null, 'O', null, 'X', 'X', 'X'];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'X',
        line: [6, 7, 8],
        description: 'Bottom row (Row 3)',
      });
    });

    it('should detect Vertical Column 1 win [0, 3, 6] for O', () => {
      const board: BoardState = ['O', 'X', 'X', 'O', 'X', null, 'O', null, null];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'O',
        line: [0, 3, 6],
        description: 'Left column (Column 1)',
      });
    });

    it('should detect Vertical Column 2 win [1, 4, 7] for X', () => {
      const board: BoardState = ['O', 'X', 'O', null, 'X', null, null, 'X', null];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'X',
        line: [1, 4, 7],
        description: 'Middle column (Column 2)',
      });
    });

    it('should detect Vertical Column 3 win [2, 5, 8] for O', () => {
      const board: BoardState = ['X', 'X', 'O', null, 'X', 'O', null, null, 'O'];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'O',
        line: [2, 5, 8],
        description: 'Right column (Column 3)',
      });
    });

    it('should detect Main Diagonal win [0, 4, 8] for X', () => {
      const board: BoardState = ['X', 'O', 'O', null, 'X', null, null, null, 'X'];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'X',
        line: [0, 4, 8],
        description: 'Main diagonal (Top-left to bottom-right)',
      });
    });

    it('should detect Anti-Diagonal win [2, 4, 6] for O', () => {
      const board: BoardState = ['X', 'X', 'O', null, 'O', 'X', 'O', null, null];
      const win = calculateWinner(board);
      expect(win).toEqual({
        winner: 'O',
        line: [2, 4, 6],
        description: 'Anti-diagonal (Top-right to bottom-left)',
      });
    });
  });

  describe('Board Status & Draw Detection', () => {
    it('should detect full board correctly', () => {
      const emptyBoard = createEmptyBoard();
      expect(isBoardFull(emptyBoard)).toBe(false);

      const partialBoard: BoardState = ['X', 'O', 'X', null, null, null, null, null, null];
      expect(isBoardFull(partialBoard)).toBe(false);

      const fullBoard: BoardState = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
      expect(isBoardFull(fullBoard)).toBe(true);
    });

    it('should detect draw when board is full and there is no winner', () => {
      // Standard draw board:
      // X | O | X
      // X | O | O
      // O | X | X
      const drawBoard: BoardState = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
      expect(isDraw(drawBoard)).toBe(true);
      expect(calculateWinner(drawBoard)).toBeNull();

      const gameStatus = calculateGameStatus(drawBoard);
      expect(gameStatus.status).toBe('draw');
      expect(gameStatus.winResult).toBeNull();
    });

    it('should not detect draw if board is full but a winning line exists', () => {
      // Full board with a win:
      // X | X | X
      // O | O | X
      // O | X | O
      const winFullBoard: BoardState = ['X', 'X', 'X', 'O', 'O', 'X', 'O', 'X', 'O'];
      expect(isDraw(winFullBoard)).toBe(false);
      expect(calculateWinner(winFullBoard)).not.toBeNull();

      const gameStatus = calculateGameStatus(winFullBoard);
      expect(gameStatus.status).toBe('won');
      expect(gameStatus.winResult?.winner).toBe('X');
    });

    it('should return in_progress for incomplete games without winners', () => {
      const inProgressBoard: BoardState = ['X', 'O', null, null, 'X', null, null, null, null];
      expect(isDraw(inProgressBoard)).toBe(false);

      const status = calculateGameStatus(inProgressBoard);
      expect(status.status).toBe('in_progress');
      expect(status.winResult).toBeNull();
    });
  });

  describe('Utilities: Player turns, mark counts, available moves', () => {
    it('should alternate player turn correctly', () => {
      expect(getNextPlayer('X')).toBe('O');
      expect(getNextPlayer('O')).toBe('X');
    });

    it('should accurately count marks on the board', () => {
      const board: BoardState = ['X', 'O', 'X', null, 'O', null, null, null, null];
      expect(countMarks(board)).toEqual({
        xCount: 2,
        oCount: 2,
        emptyCount: 5,
      });
    });

    it('should return all available move indices', () => {
      const board: BoardState = ['X', 'O', 'X', null, 'O', null, 'X', null, 'O'];
      expect(getAvailableMoves(board)).toEqual([3, 5, 7]);
    });

    it('should identify whether a cell is part of the winning line', () => {
      const winResult = {
        winner: 'X' as const,
        line: [0, 4, 8] as [number, number, number],
        description: 'Main diagonal (Top-left to bottom-right)',
      };

      expect(isCellInWinningLine(0, winResult)).toBe(true);
      expect(isCellInWinningLine(4, winResult)).toBe(true);
      expect(isCellInWinningLine(8, winResult)).toBe(true);
      expect(isCellInWinningLine(1, winResult)).toBe(false);
      expect(isCellInWinningLine(0, null)).toBe(false);
    });
  });

  describe('Accessible ARIA Label Generation', () => {
    it('should generate accessible label for empty cells', () => {
      const board = createEmptyBoard();
      expect(getCellAriaLabel(0, board)).toBe('Row 1, Column 1, Empty');
      expect(getCellAriaLabel(4, board)).toBe('Row 2, Column 2, Empty');
      expect(getCellAriaLabel(8, board)).toBe('Row 3, Column 3, Empty');
    });

    it('should generate accessible label for occupied cells', () => {
      const board: BoardState = ['X', null, null, null, 'O', null, null, null, null];
      expect(getCellAriaLabel(0, board)).toBe('Row 1, Column 1, X');
      expect(getCellAriaLabel(4, board)).toBe('Row 2, Column 2, O');
    });

    it('should generate accessible label for winning cells', () => {
      const board: BoardState = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
      const winResult = calculateWinner(board);
      expect(getCellAriaLabel(0, board, winResult)).toBe('Row 1, Column 1, X, Winning square');
      expect(getCellAriaLabel(1, board, winResult)).toBe('Row 1, Column 2, X, Winning square');
      expect(getCellAriaLabel(2, board, winResult)).toBe('Row 1, Column 3, X, Winning square');
      expect(getCellAriaLabel(3, board, winResult)).toBe('Row 2, Column 1, O');
      expect(getCellAriaLabel(5, board, winResult)).toBe('Row 2, Column 3, Empty');
    });
  });
});
