import type {
  BoardState,
  GameState,
  MoveRecord,
  MoveValidationResult,
  Player,
} from '../types/game.js';
import {
  createEmptyBoard,
  INITIAL_FOCUSED_CELL_INDEX,
  INITIAL_PLAYER,
} from './constants.js';
import {
  calculateGameStatus,
  getNextPlayer,
  indexToCoordinates,
  isValidCellIndex,
} from './evaluator.js';

/**
 * Creates the initial clean GameState for a new match.
 */
export function createInitialGameState(): GameState {
  return {
    board: createEmptyBoard(),
    history: [],
    currentStep: 0,
    currentPlayer: INITIAL_PLAYER,
    status: 'in_progress',
    winResult: null,
    focusedCellIndex: INITIAL_FOCUSED_CELL_INDEX,
  };
}

/**
 * Validates whether a move can be placed at `cellIndex` given the current `gameState`.
 * Returns a `MoveValidationResult` detailing validity and accessible error messages.
 */
export function validateMove(
  gameState: GameState,
  cellIndex: number
): MoveValidationResult {
  if (!isValidCellIndex(cellIndex)) {
    return {
      valid: false,
      reason: 'out_of_bounds',
      message: `Invalid move: Cell index ${cellIndex} is out of bounds (0-8).`,
    };
  }

  if (gameState.status !== 'in_progress') {
    return {
      valid: false,
      reason: 'game_over',
      message: 'Game is over. Press New Game or Alt+R to start a new match.',
    };
  }

  const currentCellValue = gameState.board[cellIndex];
  if (currentCellValue !== null) {
    const { row, col } = indexToCoordinates(cellIndex);
    return {
      valid: false,
      reason: 'cell_occupied',
      message: `Invalid move: Row ${row}, Column ${col} is already occupied by ${currentCellValue}. Please select an empty square.`,
    };
  }

  return {
    valid: true,
  };
}

/**
 * Quick predicate to check if a move is allowed.
 */
export function canMakeMove(gameState: GameState, cellIndex: number): boolean {
  return validateMove(gameState, cellIndex).valid;
}

/**
 * Pure state transition function that applies a player move to the current game state.
 *
 * Rules:
 * - Throws an Error if the move is invalid according to `validateMove`.
 * - If user has time-traveled into the past (currentStep < history.length),
 *   the history timeline is truncated before appending the new move (branching timeline).
 * - Updates board, status, winResult, history, currentStep, and toggles currentPlayer.
 */
export function makeMove(gameState: GameState, cellIndex: number): GameState {
  const validation = validateMove(gameState, cellIndex);
  if (!validation.valid) {
    throw new Error(validation.message ?? `Cannot place move at index ${cellIndex}.`);
  }

  const { row, col } = indexToCoordinates(cellIndex);
  const activePlayer = gameState.currentPlayer;

  // Create new immutable board tuple
  const newBoard = [...gameState.board] as BoardState;
  newBoard[cellIndex] = activePlayer;

  // Truncate history if branching from an earlier time-travel step
  const truncatedHistory = gameState.history.slice(0, gameState.currentStep);

  const moveRecord: MoveRecord = {
    step: gameState.currentStep + 1,
    player: activePlayer,
    cellIndex,
    row,
    col,
    boardSnapshot: newBoard,
  };

  const newHistory = [...truncatedHistory, moveRecord];
  const { status, winResult } = calculateGameStatus(newBoard);
  const nextPlayer = getNextPlayer(activePlayer);

  return {
    board: newBoard,
    history: newHistory,
    currentStep: newHistory.length,
    currentPlayer: nextPlayer,
    status,
    winResult,
    focusedCellIndex: cellIndex,
  };
}

/**
 * Replays game state up to a specific historical step (time-travel).
 *
 * Rules:
 * - targetStep = 0 returns the empty board at game start while preserving history.
 * - 1 <= targetStep <= history.length restores the board snapshot of that step.
 * - Throws RangeError if targetStep is negative or exceeds history.length.
 */
export function jumpToStep(gameState: GameState, targetStep: number): GameState {
  if (
    !Number.isInteger(targetStep) ||
    targetStep < 0 ||
    targetStep > gameState.history.length
  ) {
    throw new RangeError(
      `Invalid target step: ${targetStep}. Expected integer between 0 and ${gameState.history.length}.`
    );
  }

  if (targetStep === 0) {
    return {
      board: createEmptyBoard(),
      history: gameState.history,
      currentStep: 0,
      currentPlayer: INITIAL_PLAYER,
      status: 'in_progress',
      winResult: null,
      focusedCellIndex: INITIAL_FOCUSED_CELL_INDEX,
    };
  }

  const targetRecord = gameState.history[targetStep - 1]!;
  const board = targetRecord.boardSnapshot;
  const { status, winResult } = calculateGameStatus(board);
  const nextPlayer = targetStep % 2 === 1 ? 'O' : 'X';

  return {
    board,
    history: gameState.history,
    currentStep: targetStep,
    currentPlayer: nextPlayer,
    status,
    winResult,
    focusedCellIndex: targetRecord.cellIndex,
  };
}

/**
 * Checks if an undo operation is possible (currentStep > 0).
 */
export function canUndo(gameState: GameState): boolean {
  return gameState.currentStep > 0;
}

/**
 * Checks if a redo operation is possible (currentStep < history.length).
 */
export function canRedo(gameState: GameState): boolean {
  return gameState.currentStep < gameState.history.length;
}

/**
 * Undoes the last move (steps back 1 move in history).
 * Returns the current state if already at game start.
 */
export function undoMove(gameState: GameState): GameState {
  if (!canUndo(gameState)) {
    return gameState;
  }
  return jumpToStep(gameState, gameState.currentStep - 1);
}

/**
 * Redoes the next move (steps forward 1 move in history).
 * Returns the current state if already at latest move.
 */
export function redoMove(gameState: GameState): GameState {
  if (!canRedo(gameState)) {
    return gameState;
  }
  return jumpToStep(gameState, gameState.currentStep + 1);
}

/**
 * Resets the entire game to a fresh initial match state.
 */
export function resetGame(): GameState {
  return createInitialGameState();
}

/**
 * Sets the active keyboard focused cell index on the board (0..8).
 */
export function setFocusedCellIndex(
  gameState: GameState,
  cellIndex: number
): GameState {
  if (!isValidCellIndex(cellIndex)) {
    throw new RangeError(
      `Invalid cell index for focus: ${cellIndex}. Expected integer 0..8.`
    );
  }

  if (gameState.focusedCellIndex === cellIndex) {
    return gameState;
  }

  return {
    ...gameState,
    focusedCellIndex: cellIndex,
  };
}
