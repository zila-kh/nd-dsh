import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/types/game.js';
import {
  canMakeMove,
  canRedo,
  canUndo,
  createInitialGameState,
  jumpToStep,
  makeMove,
  redoMove,
  resetGame,
  setFocusedCellIndex,
  undoMove,
  validateMove,
} from '../src/game/engine.js';

describe('Game Engine & State Machine', () => {
  describe('Initial State', () => {
    it('should create initial clean game state', () => {
      const state = createInitialGameState();
      expect(state.board).toEqual([null, null, null, null, null, null, null, null, null]);
      expect(state.history).toEqual([]);
      expect(state.currentStep).toBe(0);
      expect(state.currentPlayer).toBe('X');
      expect(state.status).toBe('in_progress');
      expect(state.winResult).toBeNull();
      expect(state.focusedCellIndex).toBe(0);
    });
  });

  describe('Move Validation & Invalid Move Handling', () => {
    it('should validate legal moves on empty board', () => {
      const state = createInitialGameState();
      const validation = validateMove(state, 0);
      expect(validation.valid).toBe(true);
      expect(validation.reason).toBeUndefined();
      expect(canMakeMove(state, 0)).toBe(true);
    });

    it('should reject out-of-bounds cell indices', () => {
      const state = createInitialGameState();

      const valNegative = validateMove(state, -1);
      expect(valNegative.valid).toBe(false);
      expect(valNegative.reason).toBe('out_of_bounds');
      expect(valNegative.message).toContain('out of bounds');

      const valOver = validateMove(state, 9);
      expect(valOver.valid).toBe(false);
      expect(valOver.reason).toBe('out_of_bounds');

      const valFloat = validateMove(state, 3.14);
      expect(valFloat.valid).toBe(false);
      expect(valFloat.reason).toBe('out_of_bounds');

      expect(() => makeMove(state, -1)).toThrow(/out of bounds/);
      expect(() => makeMove(state, 9)).toThrow(/out of bounds/);
    });

    it('should reject placing a mark on an already occupied cell', () => {
      let state = createInitialGameState();
      state = makeMove(state, 4); // X marks center (Row 2, Column 2)

      const validation = validateMove(state, 4);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('cell_occupied');
      expect(validation.message).toBe(
        'Invalid move: Row 2, Column 2 is already occupied by X. Please select an empty square.'
      );
      expect(canMakeMove(state, 4)).toBe(false);

      expect(() => makeMove(state, 4)).toThrow(/already occupied by X/);
    });

    it('should reject placing a mark after game is won', () => {
      // Play a quick win for X on row 1:
      // Step 1: X -> 0
      // Step 2: O -> 3
      // Step 3: X -> 1
      // Step 4: O -> 4
      // Step 5: X -> 2 (Win!)
      let state = createInitialGameState();
      state = makeMove(state, 0); // X
      state = makeMove(state, 3); // O
      state = makeMove(state, 1); // X
      state = makeMove(state, 4); // O
      state = makeMove(state, 2); // X wins!

      expect(state.status).toBe('won');
      expect(state.winResult?.winner).toBe('X');

      const validation = validateMove(state, 8);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('game_over');
      expect(validation.message).toContain('Game is over');
      expect(canMakeMove(state, 8)).toBe(false);

      expect(() => makeMove(state, 8)).toThrow(/Game is over/);
    });

    it('should reject placing a mark after game ends in a draw', () => {
      // Play a full 9-move draw match:
      // X | O | X
      // X | O | O
      // O | X | X
      // 0: X, 1: O, 2: X
      // 3: X, 4: O, 5: O
      // 7: X, 6: O, 8: X
      let state = createInitialGameState();
      state = makeMove(state, 0); // X (0)
      state = makeMove(state, 1); // O (1)
      state = makeMove(state, 2); // X (2)
      state = makeMove(state, 4); // O (4)
      state = makeMove(state, 3); // X (3)
      state = makeMove(state, 5); // O (5)
      state = makeMove(state, 7); // X (7)
      state = makeMove(state, 6); // O (6)
      state = makeMove(state, 8); // X (8)

      expect(state.status).toBe('draw');
      expect(state.winResult).toBeNull();
      expect(state.currentStep).toBe(9);

      const validation = validateMove(state, 0);
      expect(validation.valid).toBe(false);
      expect(canMakeMove(state, 0)).toBe(false);
    });
  });

  describe('Move Progression, History & State Immutability', () => {
    it('should execute moves and record history immutably', () => {
      const state0 = createInitialGameState();
      const state1 = makeMove(state0, 0);

      // Verify state0 was not mutated
      expect(state0.board[0]).toBeNull();
      expect(state0.history).toHaveLength(0);
      expect(state0.currentStep).toBe(0);

      // Verify state1 updates
      expect(state1.board[0]).toBe('X');
      expect(state1.currentPlayer).toBe('O');
      expect(state1.currentStep).toBe(1);
      expect(state1.history).toHaveLength(1);
      expect(state1.history[0]).toEqual({
        step: 1,
        player: 'X',
        cellIndex: 0,
        row: 1,
        col: 1,
        boardSnapshot: state1.board,
      });
      expect(state1.focusedCellIndex).toBe(0);

      const state2 = makeMove(state1, 4);
      expect(state2.board[4]).toBe('O');
      expect(state2.currentPlayer).toBe('X');
      expect(state2.currentStep).toBe(2);
      expect(state2.history).toHaveLength(2);
      expect(state2.history[1]?.player).toBe('O');
      expect(state2.focusedCellIndex).toBe(4);
    });
  });

  describe('Time-Travel Replay & Branching Timelines', () => {
    it('should jump back to step 0 (game start)', () => {
      let state = createInitialGameState();
      state = makeMove(state, 0); // X
      state = makeMove(state, 4); // O
      state = makeMove(state, 8); // X

      expect(state.currentStep).toBe(3);
      expect(state.history).toHaveLength(3);

      const startState = jumpToStep(state, 0);
      expect(startState.currentStep).toBe(0);
      expect(startState.board.every((c) => c === null)).toBe(true);
      expect(startState.currentPlayer).toBe('X');
      expect(startState.status).toBe('in_progress');
      expect(startState.history).toHaveLength(3); // History is preserved
      expect(startState.focusedCellIndex).toBe(0);
    });

    it('should jump to intermediate historical steps accurately', () => {
      let state = createInitialGameState();
      state = makeMove(state, 0); // Step 1: X (0)
      state = makeMove(state, 4); // Step 2: O (4)
      state = makeMove(state, 8); // Step 3: X (8)

      // Jump to step 1
      const step1State = jumpToStep(state, 1);
      expect(step1State.currentStep).toBe(1);
      expect(step1State.board[0]).toBe('X');
      expect(step1State.board[4]).toBeNull();
      expect(step1State.board[8]).toBeNull();
      expect(step1State.currentPlayer).toBe('O');
      expect(step1State.focusedCellIndex).toBe(0);

      // Jump to step 2
      const step2State = jumpToStep(state, 2);
      expect(step2State.currentStep).toBe(2);
      expect(step2State.board[0]).toBe('X');
      expect(step2State.board[4]).toBe('O');
      expect(step2State.board[8]).toBeNull();
      expect(step2State.currentPlayer).toBe('X');
      expect(step2State.focusedCellIndex).toBe(4);
    });

    it('should throw RangeError for out of range jump steps', () => {
      const state = createInitialGameState();
      expect(() => jumpToStep(state, -1)).toThrow(RangeError);
      expect(() => jumpToStep(state, 1)).toThrow(RangeError);
      expect(() => jumpToStep(state, 0.5)).toThrow(RangeError);
    });

    it('should truncate future history when making a move from a past step (branching)', () => {
      let state = createInitialGameState();
      state = makeMove(state, 0); // Step 1: X at 0
      state = makeMove(state, 1); // Step 2: O at 1
      state = makeMove(state, 2); // Step 3: X at 2

      expect(state.history).toHaveLength(3);

      // Time travel back to Step 1 (only X at 0)
      const pastState = jumpToStep(state, 1);
      expect(pastState.currentStep).toBe(1);

      // Now place move at 4 instead of 1 (branching new timeline)
      const branchedState = makeMove(pastState, 4);
      expect(branchedState.currentStep).toBe(2);
      expect(branchedState.history).toHaveLength(2);
      expect(branchedState.history[0]?.cellIndex).toBe(0);
      expect(branchedState.history[1]?.cellIndex).toBe(4);
      expect(branchedState.history[1]?.player).toBe('O');
      expect(branchedState.board[1]).toBeNull(); // Cell 1 from previous branch is not present
      expect(branchedState.board[4]).toBe('O');
    });
  });

  describe('Undo, Redo, Reset, and Focus Management', () => {
    it('should handle undo and redo properly', () => {
      let state = createInitialGameState();
      expect(canUndo(state)).toBe(false);
      expect(canRedo(state)).toBe(false);
      expect(undoMove(state)).toBe(state); // No-op
      expect(redoMove(state)).toBe(state); // No-op

      state = makeMove(state, 0);
      state = makeMove(state, 4);

      expect(canUndo(state)).toBe(true);
      expect(canRedo(state)).toBe(false);

      const undone1 = undoMove(state);
      expect(undone1.currentStep).toBe(1);
      expect(canRedo(undone1)).toBe(true);

      const undone2 = undoMove(undone1);
      expect(undone2.currentStep).toBe(0);
      expect(canUndo(undone2)).toBe(false);

      const redone1 = redoMove(undone2);
      expect(redone1.currentStep).toBe(1);

      const redone2 = redoMove(redone1);
      expect(redone2.currentStep).toBe(2);
      expect(canRedo(redone2)).toBe(false);
    });

    it('should reset game to initial state', () => {
      let state = createInitialGameState();
      state = makeMove(state, 0);
      state = makeMove(state, 4);

      const resetState = resetGame();
      expect(resetState).toEqual(createInitialGameState());
    });

    it('should update focused cell index with validation', () => {
      const state = createInitialGameState();
      const updated = setFocusedCellIndex(state, 5);
      expect(updated.focusedCellIndex).toBe(5);

      // Same index returns identical reference
      const same = setFocusedCellIndex(updated, 5);
      expect(same).toBe(updated);

      expect(() => setFocusedCellIndex(state, -1)).toThrow(RangeError);
      expect(() => setFocusedCellIndex(state, 9)).toThrow(RangeError);
    });
  });
});
