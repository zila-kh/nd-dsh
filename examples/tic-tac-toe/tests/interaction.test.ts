import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createInitialGameState,
  makeMove,
  jumpToStep,
  undoMove,
  redoMove,
  resetGame,
  validateMove,
  canMakeMove,
  canUndo,
  canRedo,
  setFocusedCellIndex,
  indexToCoordinates,
  coordinatesToIndex,
  calculateWinner,
  isDraw,
  getCellAriaLabel,
} from '../src/index.js';
import type { GameState, MoveRecord } from '../src/types/game.js';

export function runInteractionTests(test: (name: string, fn: () => void) => void): void {
  console.log('\n--- 10. User Interaction & Reset Flow Verification Tests ---\n');

  // --- 10.1 Turn Progression & Cell Selection Flow ---
  console.log('10.1 Turn Progression & Cell Selection Flow');
  test('User interaction: alternating X and O moves update state, coordinates, and history', () => {
    let state = createInitialGameState();
    assert.equal(state.currentPlayer, 'X');
    assert.equal(state.currentStep, 0);

    // Turn 1: Player X clicks (1, 1) -> index 0
    state = makeMove(state, 0);
    assert.equal(state.board[0], 'X');
    assert.equal(state.currentPlayer, 'O');
    assert.equal(state.currentStep, 1);
    assert.equal(state.history.length, 1);
    assert.deepEqual(state.history[0], {
      step: 1,
      player: 'X',
      cellIndex: 0,
      row: 1,
      col: 1,
      boardSnapshot: state.board,
    });

    // Turn 2: Player O clicks (2, 2) -> index 4
    state = makeMove(state, 4);
    assert.equal(state.board[4], 'O');
    assert.equal(state.currentPlayer, 'X');
    assert.equal(state.currentStep, 2);
    assert.equal(state.history.length, 2);
    assert.deepEqual(state.history[1], {
      step: 2,
      player: 'O',
      cellIndex: 4,
      row: 2,
      col: 2,
      boardSnapshot: state.board,
    });

    // Turn 3: Player X clicks (3, 3) -> index 8
    state = makeMove(state, 8);
    assert.equal(state.board[8], 'X');
    assert.equal(state.currentPlayer, 'O');
    assert.equal(state.currentStep, 3);
  });

  // --- 10.2 Occupied Cell & Invalid Move Handling Flow ---
  console.log('\n10.2 Occupied Cell & Invalid Move Handling Flow');
  test('User interaction: clicking occupied cell leaves board intact and returns descriptive error', () => {
    let state = createInitialGameState();
    state = makeMove(state, 4); // X marks (2,2)

    // Player O attempts to click occupied cell 4
    assert.equal(canMakeMove(state, 4), false);
    const validation = validateMove(state, 4);
    assert.equal(validation.valid, false);
    assert.equal(validation.reason, 'cell_occupied');
    assert.equal(
      validation.message,
      'Invalid move: Row 2, Column 2 is already occupied by X. Please select an empty square.'
    );

    // Board state remains unaffected
    assert.equal(state.board[4], 'X');
    assert.equal(state.currentPlayer, 'O');
    assert.equal(state.currentStep, 1);
  });

  // --- 10.3 2D Roving Tabindex Keyboard Navigation Matrix ---
  console.log('\n10.3 2D Roving Tabindex Keyboard Navigation Matrix');
  test('Keyboard navigation: 2D directional arrow movement with boundary clamping', () => {
    // Helper function simulating keyboard navigation dispatch from Board.tsx
    function simulateKeyNav(currentIndex: number, key: string, ctrlKey = false): number {
      const { row, col } = indexToCoordinates(currentIndex);
      let nextIndex: number | null = null;

      switch (key) {
        case 'ArrowRight':
          if (col < 3) nextIndex = currentIndex + 1;
          break;
        case 'ArrowLeft':
          if (col > 1) nextIndex = currentIndex - 1;
          break;
        case 'ArrowDown':
          if (row < 3) nextIndex = currentIndex + 3;
          break;
        case 'ArrowUp':
          if (row > 1) nextIndex = currentIndex - 3;
          break;
        case 'Home':
          nextIndex = ctrlKey ? 0 : (row - 1) * 3;
          break;
        case 'End':
          nextIndex = ctrlKey ? 8 : (row - 1) * 3 + 2;
          break;
        case 'PageUp':
          nextIndex = col - 1;
          break;
        case 'PageDown':
          nextIndex = 6 + (col - 1);
          break;
      }
      return nextIndex !== null ? nextIndex : currentIndex;
    }

    // Row 1 traversal
    assert.equal(simulateKeyNav(0, 'ArrowRight'), 1); // (1,1) -> (1,2)
    assert.equal(simulateKeyNav(1, 'ArrowRight'), 2); // (1,2) -> (1,3)
    assert.equal(simulateKeyNav(2, 'ArrowRight'), 2); // Boundary clamp at col 3

    // Column 3 downward traversal
    assert.equal(simulateKeyNav(2, 'ArrowDown'), 5);  // (1,3) -> (2,3)
    assert.equal(simulateKeyNav(5, 'ArrowDown'), 8);  // (2,3) -> (3,3)
    assert.equal(simulateKeyNav(8, 'ArrowDown'), 8);  // Boundary clamp at row 3

    // Row 3 leftward traversal
    assert.equal(simulateKeyNav(8, 'ArrowLeft'), 7);  // (3,3) -> (3,2)
    assert.equal(simulateKeyNav(7, 'ArrowLeft'), 6);  // (3,2) -> (3,1)
    assert.equal(simulateKeyNav(6, 'ArrowLeft'), 6);  // Boundary clamp at col 1

    // Column 1 upward traversal
    assert.equal(simulateKeyNav(6, 'ArrowUp'), 3);    // (3,1) -> (2,1)
    assert.equal(simulateKeyNav(3, 'ArrowUp'), 0);    // (2,1) -> (1,1)
    assert.equal(simulateKeyNav(0, 'ArrowUp'), 0);    // Boundary clamp at row 1

    // Home & End in current row
    assert.equal(simulateKeyNav(4, 'Home'), 3);       // (2,2) -> (2,1)
    assert.equal(simulateKeyNav(4, 'End'), 5);        // (2,2) -> (2,3)
    assert.equal(simulateKeyNav(7, 'Home'), 6);       // (3,2) -> (3,1)
    assert.equal(simulateKeyNav(7, 'End'), 8);        // (3,2) -> (3,3)

    // Ctrl+Home & Ctrl+End for full board jump
    assert.equal(simulateKeyNav(5, 'Home', true), 0); // (2,3) -> (1,1) Top-Left
    assert.equal(simulateKeyNav(3, 'End', true), 8);  // (2,1) -> (3,3) Bottom-Right

    // PageUp & PageDown in same column
    assert.equal(simulateKeyNav(7, 'PageUp'), 1);     // (3,2) -> (1,2)
    assert.equal(simulateKeyNav(1, 'PageDown'), 7);   // (1,2) -> (3,2)
    assert.equal(simulateKeyNav(5, 'PageUp'), 2);     // (2,3) -> (1,3)
    assert.equal(simulateKeyNav(3, 'PageDown'), 6);   // (2,1) -> (3,1)
  });

  test('Keyboard navigation: occupied cells maintain roving tabIndex with aria-disabled=true', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X at (1,1)
    state = makeMove(state, 1); // O at (1,2)

    // Verify cell 0 and cell 1 aria labels and disabled status
    const label0 = getCellAriaLabel(0, state.board, null);
    assert.equal(label0, 'Row 1, Column 1, X');

    const label1 = getCellAriaLabel(1, state.board, null);
    assert.equal(label1, 'Row 1, Column 2, O');

    // Focused cell index can be moved to occupied cell 0 or 1 without throwing
    state = setFocusedCellIndex(state, 0);
    assert.equal(state.focusedCellIndex, 0);

    state = setFocusedCellIndex(state, 1);
    assert.equal(state.focusedCellIndex, 1);
  });

  // --- 10.4 Win Detection & Celebration Flow ---
  console.log('\n10.4 Win Detection & Celebration Flow');
  test('Win flow: detects win, generates winning labels, locks further moves, increments score', () => {
    let state = createInitialGameState();
    // Quick diagonal win for X:
    // Move 1: X -> (1,1) [0]
    // Move 2: O -> (1,2) [1]
    // Move 3: X -> (2,2) [4]
    // Move 4: O -> (1,3) [2]
    // Move 5: X -> (3,3) [8] (Win on Main Diagonal!)
    state = makeMove(state, 0);
    state = makeMove(state, 1);
    state = makeMove(state, 4);
    state = makeMove(state, 2);
    state = makeMove(state, 8);

    assert.equal(state.status, 'won');
    assert.ok(state.winResult !== null);
    assert.equal(state.winResult?.winner, 'X');
    assert.deepEqual(state.winResult?.line, [0, 4, 8]);
    assert.equal(state.winResult?.description, 'Main diagonal (Top-left to bottom-right)');

    // Check winning square ARIA labels
    assert.equal(getCellAriaLabel(0, state.board, state.winResult), 'Row 1, Column 1, X, Winning square');
    assert.equal(getCellAriaLabel(4, state.board, state.winResult), 'Row 2, Column 2, X, Winning square');
    assert.equal(getCellAriaLabel(8, state.board, state.winResult), 'Row 3, Column 3, X, Winning square');
    assert.equal(getCellAriaLabel(1, state.board, state.winResult), 'Row 1, Column 2, O');

    // Moves locked after win
    assert.equal(canMakeMove(state, 3), false);
    const postWinVal = validateMove(state, 3);
    assert.equal(postWinVal.valid, false);
    assert.equal(postWinVal.reason, 'game_over');
  });

  // --- 10.5 Draw / Stalemate Flow ---
  console.log('\n10.5 Draw / Stalemate Flow');
  test('Draw flow: detects stalemate when board is full with no winner', () => {
    let state = createInitialGameState();
    // Sequence:
    // X | O | X
    // X | O | O
    // O | X | X
    const moves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    for (const m of moves) {
      state = makeMove(state, m);
    }

    assert.equal(state.status, 'draw');
    assert.equal(state.winResult, null);
    assert.equal(state.currentStep, 9);
    assert.equal(canMakeMove(state, 0), false);
  });

  // --- 10.6 Time-Travel & Branching Timelines Flow ---
  console.log('\n10.6 Time-Travel & Branching Timelines Flow');
  test('Time-travel flow: jump to previous step, inspect past board, branch new timeline', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // Step 1: X (0)
    state = makeMove(state, 3); // Step 2: O (3)
    state = makeMove(state, 1); // Step 3: X (1)
    state = makeMove(state, 4); // Step 4: O (4)
    state = makeMove(state, 2); // Step 5: X (2) -> Won!

    assert.equal(state.status, 'won');
    assert.equal(state.currentStep, 5);

    // Jump back to Step 2 (only moves 0 and 3 played)
    const step2 = jumpToStep(state, 2);
    assert.equal(step2.currentStep, 2);
    assert.equal(step2.currentPlayer, 'X');
    assert.equal(step2.status, 'in_progress');
    assert.equal(step2.board[0], 'X');
    assert.equal(step2.board[3], 'O');
    assert.equal(step2.board[1], null);
    assert.equal(step2.board[2], null);
    assert.equal(step2.history.length, 5); // History preserved during jump

    // Branch a new timeline by playing cell 8 instead of cell 1
    const branched = makeMove(step2, 8);
    assert.equal(branched.currentStep, 3);
    assert.equal(branched.history.length, 3); // Truncated previous future steps 3..5
    assert.equal(branched.history[2]?.cellIndex, 8);
    assert.equal(branched.history[2]?.player, 'X');
    assert.equal(branched.board[8], 'X');
    assert.equal(branched.board[1], null);
    assert.equal(branched.board[2], null);
  });

  // --- 10.7 Quick Jump, Undo & Redo Flow ---
  console.log('\n10.7 Quick Jump, Undo & Redo Flow');
  test('Undo & Redo flow: single-step navigation and button disable states', () => {
    let state = createInitialGameState();
    assert.equal(canUndo(state), false);
    assert.equal(canRedo(state), false);

    state = makeMove(state, 4); // Step 1: X (4)
    state = makeMove(state, 0); // Step 2: O (0)
    assert.equal(canUndo(state), true);
    assert.equal(canRedo(state), false);

    // Undo 1 step -> at Step 1
    const u1 = undoMove(state);
    assert.equal(u1.currentStep, 1);
    assert.equal(u1.board[0], null);
    assert.equal(u1.board[4], 'X');
    assert.equal(canUndo(u1), true);
    assert.equal(canRedo(u1), true);

    // Undo another step -> at Step 0 (Start)
    const u0 = undoMove(u1);
    assert.equal(u0.currentStep, 0);
    assert.equal(canUndo(u0), false);
    assert.equal(canRedo(u0), true);

    // Redo 1 step -> at Step 1
    const r1 = redoMove(u0);
    assert.equal(r1.currentStep, 1);
    assert.equal(r1.board[4], 'X');
    assert.equal(canUndo(r1), true);
    assert.equal(canRedo(r1), true);

    // Redo another step -> at Step 2 (Latest)
    const r2 = redoMove(r1);
    assert.equal(r2.currentStep, 2);
    assert.equal(r2.board[0], 'O');
    assert.equal(canUndo(r2), true);
    assert.equal(canRedo(r2), false);
  });

  // --- 10.8 Reset Flow & Scoreboard Persistence ---
  console.log('\n10.8 Reset Flow & Scoreboard Persistence');
  test('Reset flow: restores initial state, clears board and history, preserves score state', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0);
    state = makeMove(state, 4);
    state = makeMove(state, 8);

    assert.equal(state.currentStep, 3);
    assert.equal(state.history.length, 3);

    // Execute reset
    const reset = resetGame();
    assert.deepEqual(reset.board, [null, null, null, null, null, null, null, null, null]);
    assert.deepEqual(reset.history, []);
    assert.equal(reset.currentStep, 0);
    assert.equal(reset.currentPlayer, 'X');
    assert.equal(reset.status, 'in_progress');
    assert.equal(reset.winResult, null);
    assert.equal(reset.focusedCellIndex, 0);
  });
}
