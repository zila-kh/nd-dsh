import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  CELL_POSITION_NAMES,
  TOTAL_CELLS,
  WINNING_COMBINATIONS,
  createEmptyBoard,
  isValidCellIndex,
  indexToCoordinates,
  coordinatesToIndex,
  calculateWinner,
  isBoardFull,
  isDraw,
  calculateGameStatus,
  getNextPlayer,
  isCellInWinningLine,
  countMarks,
  getAvailableMoves,
  getCellAriaLabel,
  createInitialGameState,
  validateMove,
  canMakeMove,
  makeMove,
  jumpToStep,
  canUndo,
  canRedo,
  undoMove,
  redoMove,
  resetGame,
  setFocusedCellIndex,
} from '../dist/src/index.js';
import { runComponentTests } from '../dist/tests/components.test.js';
import { runInteractionTests } from '../dist/tests/interaction.test.js';
import { runA11yAuditTests } from '../dist/tests/a11y-audit.test.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('\n=============================================================');
console.log('   TIC-TAC-TOE BETA ACCEPTANCE: AUTOMATED TEST & A11Y SUITE   ');
console.log('=============================================================\n');

// --- 1. Constants & Dimensions ---
console.log('1. Constants & Grid Definitions');
test('BOARD_SIZE is 3 and TOTAL_CELLS is 9', () => {
  assert.equal(BOARD_SIZE, 3);
  assert.equal(TOTAL_CELLS, 9);
});

test('createEmptyBoard creates a fresh 9-cell array of nulls', () => {
  const board = createEmptyBoard();
  assert.equal(board.length, 9);
  assert.deepEqual(board, [null, null, null, null, null, null, null, null, null]);
});

test('WINNING_COMBINATIONS contains exactly 8 winning lines with descriptions', () => {
  assert.equal(WINNING_COMBINATIONS.length, 8);
  const lines = WINNING_COMBINATIONS.map((c) => c.line);
  assert.deepEqual(lines, [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ]);
});

test('CELL_POSITION_NAMES covers all 9 positions', () => {
  assert.equal(CELL_POSITION_NAMES.length, 9);
  assert.equal(CELL_POSITION_NAMES[0], 'Top-Left');
  assert.equal(CELL_POSITION_NAMES[4], 'Center');
  assert.equal(CELL_POSITION_NAMES[8], 'Bottom-Right');
});

// --- 2. Coordinate & Index Conversion ---
console.log('\n2. Coordinate & Index Conversion');
test('isValidCellIndex checks bounds (0..8)', () => {
  for (let i = 0; i < 9; i++) {
    assert.equal(isValidCellIndex(i), true);
  }
  assert.equal(isValidCellIndex(-1), false);
  assert.equal(isValidCellIndex(9), false);
  assert.equal(isValidCellIndex(1.5), false);
  assert.equal(isValidCellIndex(NaN), false);
  assert.equal(isValidCellIndex(Infinity), false);
});

test('indexToCoordinates maps 0..8 to (1..3, 1..3)', () => {
  const expected = [
    { row: 1, col: 1, name: 'Top-Left' },
    { row: 1, col: 2, name: 'Top-Center' },
    { row: 1, col: 3, name: 'Top-Right' },
    { row: 2, col: 1, name: 'Middle-Left' },
    { row: 2, col: 2, name: 'Center' },
    { row: 2, col: 3, name: 'Middle-Right' },
    { row: 3, col: 1, name: 'Bottom-Left' },
    { row: 3, col: 2, name: 'Bottom-Center' },
    { row: 3, col: 3, name: 'Bottom-Right' },
  ];

  for (let i = 0; i < 9; i++) {
    assert.deepEqual(indexToCoordinates(i), expected[i]);
  }
});

test('indexToCoordinates throws RangeError for out of bounds index', () => {
  assert.throws(() => indexToCoordinates(-1), RangeError);
  assert.throws(() => indexToCoordinates(9), RangeError);
  assert.throws(() => indexToCoordinates(3.14), RangeError);
});

test('coordinatesToIndex maps (1..3, 1..3) to 0..8', () => {
  assert.equal(coordinatesToIndex(1, 1), 0);
  assert.equal(coordinatesToIndex(1, 2), 1);
  assert.equal(coordinatesToIndex(1, 3), 2);
  assert.equal(coordinatesToIndex(2, 1), 3);
  assert.equal(coordinatesToIndex(2, 2), 4);
  assert.equal(coordinatesToIndex(2, 3), 5);
  assert.equal(coordinatesToIndex(3, 1), 6);
  assert.equal(coordinatesToIndex(3, 2), 7);
  assert.equal(coordinatesToIndex(3, 3), 8);
});

test('coordinatesToIndex throws RangeError for invalid row/col', () => {
  assert.throws(() => coordinatesToIndex(0, 1), RangeError);
  assert.throws(() => coordinatesToIndex(1, 0), RangeError);
  assert.throws(() => coordinatesToIndex(4, 1), RangeError);
  assert.throws(() => coordinatesToIndex(1, 4), RangeError);
  assert.throws(() => coordinatesToIndex(1.5, 2), RangeError);
  assert.throws(() => coordinatesToIndex(2, 2.5), RangeError);
});

// --- 3. Winning Line Detection (All 8 Lines for X and O) ---
console.log('\n3. Winning Line Detection (All 8 Lines)');
test('calculateWinner returns null on empty board', () => {
  const board = createEmptyBoard();
  assert.equal(calculateWinner(board), null);
});

test('Row 1 win [0, 1, 2] for X and O', () => {
  const boardX = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [0, 1, 2],
    description: 'Top row (Row 1)',
  });

  const boardO = ['O', 'O', 'O', 'X', 'X', null, null, null, null];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [0, 1, 2],
    description: 'Top row (Row 1)',
  });
});

test('Row 2 win [3, 4, 5] for X and O', () => {
  const boardX = ['O', 'O', null, 'X', 'X', 'X', null, null, null];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [3, 4, 5],
    description: 'Middle row (Row 2)',
  });

  const boardO = ['X', 'X', null, 'O', 'O', 'O', 'X', null, null];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [3, 4, 5],
    description: 'Middle row (Row 2)',
  });
});

test('Row 3 win [6, 7, 8] for X and O', () => {
  const boardX = ['O', null, 'O', null, 'O', null, 'X', 'X', 'X'];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [6, 7, 8],
    description: 'Bottom row (Row 3)',
  });

  const boardO = ['X', null, 'X', null, 'X', null, 'O', 'O', 'O'];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [6, 7, 8],
    description: 'Bottom row (Row 3)',
  });
});

test('Column 1 win [0, 3, 6] for X and O', () => {
  const boardX = ['X', 'O', null, 'X', 'O', null, 'X', null, null];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [0, 3, 6],
    description: 'Left column (Column 1)',
  });

  const boardO = ['O', 'X', null, 'O', 'X', null, 'O', null, null];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [0, 3, 6],
    description: 'Left column (Column 1)',
  });
});

test('Column 2 win [1, 4, 7] for X and O', () => {
  const boardX = ['O', 'X', null, null, 'X', 'O', null, 'X', null];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [1, 4, 7],
    description: 'Middle column (Column 2)',
  });

  const boardO = ['X', 'O', null, null, 'O', 'X', null, 'O', null];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [1, 4, 7],
    description: 'Middle column (Column 2)',
  });
});

test('Column 3 win [2, 5, 8] for X and O', () => {
  const boardX = ['O', null, 'X', 'O', null, 'X', null, null, 'X'];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [2, 5, 8],
    description: 'Right column (Column 3)',
  });

  const boardO = ['X', null, 'O', 'X', null, 'O', null, null, 'O'];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [2, 5, 8],
    description: 'Right column (Column 3)',
  });
});

test('Main Diagonal win [0, 4, 8] for X and O', () => {
  const boardX = ['X', 'O', 'O', null, 'X', null, null, null, 'X'];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [0, 4, 8],
    description: 'Main diagonal (Top-left to bottom-right)',
  });

  const boardO = ['O', 'X', 'X', null, 'O', null, null, null, 'O'];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [0, 4, 8],
    description: 'Main diagonal (Top-left to bottom-right)',
  });
});

test('Anti-Diagonal win [2, 4, 6] for X and O', () => {
  const boardX = ['O', 'O', 'X', null, 'X', null, 'X', null, null];
  assert.deepEqual(calculateWinner(boardX), {
    winner: 'X',
    line: [2, 4, 6],
    description: 'Anti-diagonal (Top-right to bottom-left)',
  });

  const boardO = ['X', 'X', 'O', null, 'O', null, 'O', null, null];
  assert.deepEqual(calculateWinner(boardO), {
    winner: 'O',
    line: [2, 4, 6],
    description: 'Anti-diagonal (Top-right to bottom-left)',
  });
});

// --- 4. Draw & Board State Detection ---
console.log('\n4. Draw & Board Full Detection');
test('isBoardFull correctly determines full/partial boards', () => {
  assert.equal(isBoardFull(createEmptyBoard()), false);
  assert.equal(isBoardFull(['X', 'O', 'X', null, null, null, null, null, null]), false);
  assert.equal(isBoardFull(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']), true);
});

test('isDraw detects stalemate accurately', () => {
  const drawBoard = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
  assert.equal(isDraw(drawBoard), true);
  assert.deepEqual(calculateGameStatus(drawBoard), {
    status: 'draw',
    winResult: null,
  });
});

test('calculateGameStatus reports "won" if board is full but has a winning line', () => {
  const winFullBoard = ['X', 'X', 'X', 'O', 'O', 'X', 'O', 'X', 'O'];
  assert.equal(isDraw(winFullBoard), false);
  const status = calculateGameStatus(winFullBoard);
  assert.equal(status.status, 'won');
  assert.equal(status.winResult?.winner, 'X');
});

test('calculateGameStatus reports "in_progress" for partial boards without winner', () => {
  const midBoard = ['X', 'O', null, null, 'X', null, null, null, null];
  assert.deepEqual(calculateGameStatus(midBoard), {
    status: 'in_progress',
    winResult: null,
  });
});

// --- 5. Utilities ---
console.log('\n5. Game Utilities & ARIA Labels');
test('getNextPlayer alternates between X and O', () => {
  assert.equal(getNextPlayer('X'), 'O');
  assert.equal(getNextPlayer('O'), 'X');
});

test('isCellInWinningLine identifies winning cells', () => {
  const win = {
    winner: 'X',
    line: [0, 4, 8],
    description: 'Main diagonal',
  };
  assert.equal(isCellInWinningLine(0, win), true);
  assert.equal(isCellInWinningLine(4, win), true);
  assert.equal(isCellInWinningLine(8, win), true);
  assert.equal(isCellInWinningLine(1, win), false);
  assert.equal(isCellInWinningLine(0, null), false);
});

test('countMarks counts marks correctly', () => {
  const board = ['X', 'O', 'X', null, 'O', null, null, null, null];
  assert.deepEqual(countMarks(board), { xCount: 2, oCount: 2, emptyCount: 5 });
});

test('getAvailableMoves lists empty cell indices', () => {
  const board = ['X', 'O', 'X', null, 'O', null, 'X', null, 'O'];
  assert.deepEqual(getAvailableMoves(board), [3, 5, 7]);
});

test('getCellAriaLabel generates accurate accessibility labels', () => {
  const board = ['X', 'X', 'X', 'O', 'O', null, null, null, null];
  const win = calculateWinner(board);

  assert.equal(getCellAriaLabel(0, board, win), 'Row 1, Column 1, X, Winning square');
  assert.equal(getCellAriaLabel(3, board, win), 'Row 2, Column 1, O');
  assert.equal(getCellAriaLabel(5, board, win), 'Row 2, Column 3, Empty');
  assert.equal(getCellAriaLabel(0, board, null), 'Row 1, Column 1, X');
});

// --- 6. Engine: Move Validation & Invalid Moves ---
console.log('\n6. Engine: Move Validation & Invalid Moves');
test('validateMove and canMakeMove allow valid moves', () => {
  const state = createInitialGameState();
  assert.equal(canMakeMove(state, 0), true);
  assert.deepEqual(validateMove(state, 0), { valid: true });
});

test('validateMove rejects out-of-bounds indices', () => {
  const state = createInitialGameState();
  assert.equal(canMakeMove(state, -1), false);
  assert.equal(validateMove(state, -1).reason, 'out_of_bounds');
  assert.equal(validateMove(state, 9).reason, 'out_of_bounds');
  assert.throws(() => makeMove(state, -1), /out of bounds/);
  assert.throws(() => makeMove(state, 9), /out of bounds/);
});

test('validateMove rejects occupied cells with detailed message', () => {
  let state = createInitialGameState();
  state = makeMove(state, 4); // X marks center (Row 2, Column 2)
  assert.equal(canMakeMove(state, 4), false);
  const result = validateMove(state, 4);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'cell_occupied');
  assert.equal(
    result.message,
    'Invalid move: Row 2, Column 2 is already occupied by X. Please select an empty square.'
  );
  assert.throws(() => makeMove(state, 4), /already occupied by X/);
});

test('validateMove rejects moves when game is won', () => {
  let state = createInitialGameState();
  state = makeMove(state, 0); // X
  state = makeMove(state, 3); // O
  state = makeMove(state, 1); // X
  state = makeMove(state, 4); // O
  state = makeMove(state, 2); // X wins!

  assert.equal(state.status, 'won');
  assert.equal(canMakeMove(state, 8), false);
  const result = validateMove(state, 8);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'game_over');
  assert.throws(() => makeMove(state, 8), /Game is over/);
});

test('validateMove rejects moves when game is drawn', () => {
  let state = createInitialGameState();
  const moves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  for (const m of moves) {
    state = makeMove(state, m);
  }
  assert.equal(state.status, 'draw');
  assert.equal(canMakeMove(state, 0), false);
  assert.equal(validateMove(state, 0).reason, 'game_over');
});

// --- 7. Engine: State Progression, History & Time Travel ---
console.log('\n7. Engine: State Progression, History & Time Travel');
test('makeMove records move history and preserves state immutability', () => {
  const s0 = createInitialGameState();
  const s1 = makeMove(s0, 0);

  // Immutability check
  assert.equal(s0.board[0], null);
  assert.equal(s0.history.length, 0);
  assert.equal(s0.currentStep, 0);

  assert.equal(s1.board[0], 'X');
  assert.equal(s1.currentPlayer, 'O');
  assert.equal(s1.currentStep, 1);
  assert.equal(s1.history.length, 1);
  assert.deepEqual(s1.history[0], {
    step: 1,
    player: 'X',
    cellIndex: 0,
    row: 1,
    col: 1,
    boardSnapshot: s1.board,
  });

  const s2 = makeMove(s1, 4);
  assert.equal(s2.board[4], 'O');
  assert.equal(s2.currentPlayer, 'X');
  assert.equal(s2.currentStep, 2);
  assert.equal(s2.history.length, 2);
});

test('jumpToStep allows jumping to step 0 and intermediate steps', () => {
  let state = createInitialGameState();
  state = makeMove(state, 0); // X (0)
  state = makeMove(state, 4); // O (4)
  state = makeMove(state, 8); // X (8)

  // Jump to step 0
  const atStart = jumpToStep(state, 0);
  assert.equal(atStart.currentStep, 0);
  assert.equal(atStart.currentPlayer, 'X');
  assert.equal(atStart.board.every((c) => c === null), true);
  assert.equal(atStart.history.length, 3); // Preserves history

  // Jump to step 1
  const atStep1 = jumpToStep(state, 1);
  assert.equal(atStep1.currentStep, 1);
  assert.equal(atStep1.currentPlayer, 'O');
  assert.equal(atStep1.board[0], 'X');
  assert.equal(atStep1.board[4], null);
  assert.equal(atStep1.board[8], null);

  // Jump to step 2
  const atStep2 = jumpToStep(state, 2);
  assert.equal(atStep2.currentStep, 2);
  assert.equal(atStep2.currentPlayer, 'X');
  assert.equal(atStep2.board[0], 'X');
  assert.equal(atStep2.board[4], 'O');
  assert.equal(atStep2.board[8], null);
});

test('jumpToStep validates target step range', () => {
  const state = createInitialGameState();
  assert.throws(() => jumpToStep(state, -1), RangeError);
  assert.throws(() => jumpToStep(state, 1), RangeError);
  assert.throws(() => jumpToStep(state, 1.5), RangeError);
});

test('branching timeline: making a move after jumpToStep truncates subsequent history', () => {
  let state = createInitialGameState();
  state = makeMove(state, 0); // Step 1: X (0)
  state = makeMove(state, 1); // Step 2: O (1)
  state = makeMove(state, 2); // Step 3: X (2)

  assert.equal(state.history.length, 3);

  // Jump to step 1
  const pastState = jumpToStep(state, 1);
  assert.equal(pastState.currentStep, 1);

  // Branch with new move at 4
  const branched = makeMove(pastState, 4);
  assert.equal(branched.currentStep, 2);
  assert.equal(branched.history.length, 2);
  assert.equal(branched.history[1].cellIndex, 4);
  assert.equal(branched.history[1].player, 'O');
  assert.equal(branched.board[1], null); // old branch forgotten
  assert.equal(branched.board[4], 'O');
});

// --- 8. Engine: Undo, Redo, Reset & Focus ---
console.log('\n8. Engine: Undo, Redo, Reset & Focus');
test('canUndo and canRedo reflect state correctly', () => {
  let state = createInitialGameState();
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);

  state = makeMove(state, 0);
  assert.equal(canUndo(state), true);
  assert.equal(canRedo(state), false);

  const step0 = undoMove(state);
  assert.equal(step0.currentStep, 0);
  assert.equal(canUndo(step0), false);
  assert.equal(canRedo(step0), true);

  const step1 = redoMove(step0);
  assert.equal(step1.currentStep, 1);
  assert.equal(canUndo(step1), true);
  assert.equal(canRedo(step1), false);
});

test('undoMove and redoMove are no-ops when bounds are reached', () => {
  const state0 = createInitialGameState();
  assert.equal(undoMove(state0), state0);
  assert.equal(redoMove(state0), state0);
});

test('resetGame returns initial game state', () => {
  let state = createInitialGameState();
  state = makeMove(state, 0);
  state = makeMove(state, 4);

  const reset = resetGame();
  assert.deepEqual(reset, createInitialGameState());
});

test('setFocusedCellIndex updates focus and validates bounds', () => {
  const state0 = createInitialGameState();
  const state1 = setFocusedCellIndex(state0, 7);
  assert.equal(state1.focusedCellIndex, 7);

  const stateSame = setFocusedCellIndex(state1, 7);
  assert.equal(stateSame, state1);

  assert.throws(() => setFocusedCellIndex(state0, -1), RangeError);
  assert.throws(() => setFocusedCellIndex(state0, 9), RangeError);
  assert.throws(() => setFocusedCellIndex(state0, 3.5), RangeError);
});

// --- 9. React Component Tests ---
runComponentTests(test);

// --- 10. User Interaction & Reset Flow Verification Tests ---
runInteractionTests(test);

// --- 11. Automated axe-core & WCAG 2.1 AA Accessibility Audit Tests ---
runA11yAuditTests(test);

console.log(`\n=============================================================`);
console.log(`Test Results: ${passed}/${total} passed (100% SUCCESS)`);
console.log(`Zero WCAG / axe-core accessibility violations found.`);
console.log(`=============================================================\n`);
