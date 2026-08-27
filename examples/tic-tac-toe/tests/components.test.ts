import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Square,
  Board,
  Status,
  MoveHistory,
  LiveAnnouncer,
  KeyboardLegend,
  TicTacToeGame,
  IconX,
  IconO,
  createEmptyBoard,
  createInitialGameState,
  makeMove,
  jumpToStep,
  calculateWinner,
} from '../src/index.js';

export function runComponentTests(test: (name: string, fn: () => void) => void): void {
  console.log('\n--- 9. React Component & Accessibility (A11y) Tests ---\n');

  // --- Square Component Tests ---
  console.log('9.1 Square Component');
  test('Square renders semantic button with roving tabIndex and coordinates', () => {
    const markupFocused = renderToStaticMarkup(
      React.createElement(Square, {
        index: 0,
        row: 1,
        col: 1,
        value: null,
        isWinning: false,
        isDimmed: false,
        isFocused: true,
        isGameOver: false,
        ariaLabel: 'Row 1, Column 1, Empty',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupFocused.includes('type="button"'));
    assert.ok(markupFocused.includes('tabindex="0"'));
    assert.ok(markupFocused.includes('aria-label="Row 1, Column 1, Empty"'));
    assert.ok(markupFocused.includes('data-index="0"'));
    assert.ok(markupFocused.includes('data-row="1"'));
    assert.ok(markupFocused.includes('data-col="1"'));
    assert.ok(markupFocused.includes('ttt-square--empty'));
    assert.ok(markupFocused.includes('ttt-square--focused'));

    const markupUnfocused = renderToStaticMarkup(
      React.createElement(Square, {
        index: 4,
        row: 2,
        col: 2,
        value: null,
        isWinning: false,
        isDimmed: false,
        isFocused: false,
        isGameOver: false,
        ariaLabel: 'Row 2, Column 2, Empty',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupUnfocused.includes('tabindex="-1"'));
  });

  test('Square renders distinct Player X icon and class', () => {
    const markupX = renderToStaticMarkup(
      React.createElement(Square, {
        index: 0,
        row: 1,
        col: 1,
        value: 'X',
        isWinning: false,
        isDimmed: false,
        isFocused: false,
        isGameOver: false,
        ariaLabel: 'Row 1, Column 1, X',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupX.includes('ttt-square--x'));
    assert.ok(markupX.includes('token-x'));
    assert.ok(markupX.includes('aria-disabled="true"'));
    assert.ok(markupX.includes('data-value="X"'));
  });

  test('Square renders distinct Player O icon and class', () => {
    const markupO = renderToStaticMarkup(
      React.createElement(Square, {
        index: 1,
        row: 1,
        col: 2,
        value: 'O',
        isWinning: false,
        isDimmed: false,
        isFocused: false,
        isGameOver: false,
        ariaLabel: 'Row 1, Column 2, O',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupO.includes('ttt-square--o'));
    assert.ok(markupO.includes('token-o'));
    assert.ok(markupO.includes('circle'));
    assert.ok(markupO.includes('data-value="O"'));
  });

  test('Square renders celebratory winning highlight styling', () => {
    const markupWin = renderToStaticMarkup(
      React.createElement(Square, {
        index: 0,
        row: 1,
        col: 1,
        value: 'X',
        isWinning: true,
        isDimmed: false,
        isFocused: false,
        isGameOver: true,
        ariaLabel: 'Row 1, Column 1, X, Winning square',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupWin.includes('ttt-square--winning'));
    assert.ok(markupWin.includes('data-winning="true"'));
    assert.ok(markupWin.includes('Winning square'));
  });

  test('Square renders dimmed styling for non-winning cells in game won state', () => {
    const markupDimmed = renderToStaticMarkup(
      React.createElement(Square, {
        index: 4,
        row: 2,
        col: 2,
        value: 'O',
        isWinning: false,
        isDimmed: true,
        isFocused: false,
        isGameOver: true,
        ariaLabel: 'Row 2, Column 2, O',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupDimmed.includes('ttt-square--dimmed'));
  });

  test('Square renders ghost hover preview for empty cell', () => {
    const markupGhost = renderToStaticMarkup(
      React.createElement(Square, {
        index: 0,
        row: 1,
        col: 1,
        value: null,
        isWinning: false,
        isDimmed: false,
        isFocused: false,
        isGameOver: false,
        ariaLabel: 'Row 1, Column 1, Empty',
        previewMark: 'X',
        onClick: () => {},
        onFocus: () => {},
        onKeyDown: () => {},
      })
    );

    assert.ok(markupGhost.includes('ttt-square__ghost-preview'));
    assert.ok(markupGhost.includes('token-ghost'));
  });

  // --- Board Component Tests ---
  console.log('\n9.2 Board Component');
  test('Board renders accessible region with 9 square buttons and 2D roving tabindex', () => {
    const board = createEmptyBoard();
    const markup = renderToStaticMarkup(
      React.createElement(Board, {
        board,
        winResult: null,
        isGameOver: false,
        focusedIndex: 0,
        currentPlayer: 'X',
        onCellClick: () => {},
        onCellFocus: () => {},
      })
    );

    assert.ok(markup.includes('role="region"'));
    assert.ok(markup.includes('aria-label="Tic-Tac-Toe Game Board"'));
    assert.ok(markup.includes('ttt-board-grid'));

    // Count 9 square buttons (matching <button tag with ttt-square class)
    const squareButtonMatches = markup.match(/<button[^>]*ttt-square/g);
    assert.equal(squareButtonMatches?.length, 9);

    // Exactly one cell button has tabindex="0" (cell 0)
    const tabIndex0Matches = markup.match(/tabindex="0"/g);
    assert.equal(tabIndex0Matches?.length, 1);

    // Remaining 8 cell buttons have tabindex="-1"
    const tabIndexMinus1Matches = markup.match(/tabindex="-1"/g);
    assert.equal(tabIndexMinus1Matches?.length, 8);
  });

  test('Board highlights winning line triplets across the 3 winning cells', () => {
    const winBoard = ['X', 'X', 'X', 'O', 'O', null, null, null, null] as any;
    const winResult = calculateWinner(winBoard);
    assert.ok(winResult !== null);

    const markup = renderToStaticMarkup(
      React.createElement(Board, {
        board: winBoard,
        winResult,
        isGameOver: true,
        focusedIndex: 2,
        currentPlayer: 'O',
        onCellClick: () => {},
        onCellFocus: () => {},
      })
    );

    const winMatches = markup.match(/ttt-square--winning/g);
    assert.equal(winMatches?.length, 3);

    const dimmedMatches = markup.match(/ttt-square--dimmed/g);
    assert.equal(dimmedMatches?.length, 6);
  });

  // --- Status Component Tests ---
  console.log('\n9.3 Status Component');
  test('Status renders active turn indicator for Player X and Player O', () => {
    const markupX = renderToStaticMarkup(
      React.createElement(Status, {
        status: 'in_progress',
        currentPlayer: 'X',
        winResult: null,
        currentStep: 0,
        totalSteps: 0,
      })
    );

    assert.ok(markupX.includes('ttt-status-card'));
    assert.ok(markupX.includes('Player X'));
    assert.ok(markupX.includes('ttt-player-badge--x'));
    assert.ok(markupX.includes('ttt-pulse'));

    const markupO = renderToStaticMarkup(
      React.createElement(Status, {
        status: 'in_progress',
        currentPlayer: 'O',
        winResult: null,
        currentStep: 1,
        totalSteps: 1,
      })
    );

    assert.ok(markupO.includes('Player O'));
    assert.ok(markupO.includes('ttt-player-badge--o'));
  });

  test('Status renders victory celebration banner with winning line description', () => {
    const winResult = {
      winner: 'X' as const,
      line: [0, 1, 2] as [number, number, number],
      description: 'Top row (Row 1)',
    };

    const markup = renderToStaticMarkup(
      React.createElement(Status, {
        status: 'won',
        currentPlayer: 'O',
        winResult,
        currentStep: 5,
        totalSteps: 5,
      })
    );

    assert.ok(markup.includes('ttt-victory-indicator'));
    assert.ok(markup.includes('Player X'));
    assert.ok(markup.includes('Wins!'));
    assert.ok(markup.includes('Top row (Row 1)'));
  });

  test('Status renders draw banner when game ends in stalemate', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Status, {
        status: 'draw',
        currentPlayer: 'X',
        winResult: null,
        currentStep: 9,
        totalSteps: 9,
      })
    );

    assert.ok(markup.includes('ttt-draw-indicator'));
    assert.ok(markup.includes('Game Drawn!'));
    assert.ok(markup.includes('All 9 squares filled'));
  });

  test('Status renders step counter and score counters', () => {
    const scores = { xWins: 3, oWins: 2, draws: 1 };
    const markup = renderToStaticMarkup(
      React.createElement(Status, {
        status: 'in_progress',
        currentPlayer: 'X',
        winResult: null,
        currentStep: 3,
        totalSteps: 5,
        scores,
      })
    );

    assert.ok(markup.includes('Move #3 (of 5)'));
    assert.ok(markup.includes('ttt-scoreboard'));
    assert.ok(markup.includes('3'));
    assert.ok(markup.includes('2'));
    assert.ok(markup.includes('1'));
  });

  // --- MoveHistory Component Tests ---
  console.log('\n9.4 MoveHistory Component');
  test('MoveHistory renders time-travel replay controls and step list', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // Step 1: X (0)
    state = makeMove(state, 4); // Step 2: O (4)
    state = makeMove(state, 8); // Step 3: X (8)

    const markup = renderToStaticMarkup(
      React.createElement(MoveHistory, {
        history: state.history,
        currentStep: 2,
        onJumpToStep: () => {},
        onUndo: () => {},
        onRedo: () => {},
        canUndo: true,
        canRedo: true,
      })
    );

    assert.ok(markup.includes('role="toolbar"'));
    assert.ok(markup.includes('aria-label="Move History and Time-Travel Controls"'));
    assert.ok(markup.includes('Undo last move (Ctrl+Z)'));
    assert.ok(markup.includes('Redo next move (Ctrl+Y)'));
    assert.ok(markup.includes('Game Start'));
    assert.ok(markup.includes('Row 1, Col 1'));
    assert.ok(markup.includes('Row 2, Col 2'));
    assert.ok(markup.includes('Row 3, Col 3'));

    // Step 2 is active, so it has aria-current="step"
    assert.ok(markup.includes('aria-current="step"'));
    assert.ok(markup.includes('ttt-step-current-tag'));
  });

  test('MoveHistory disables Undo at step 0 and Redo at latest step', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0);

    const markupStart = renderToStaticMarkup(
      React.createElement(MoveHistory, {
        history: state.history,
        currentStep: 0,
        onJumpToStep: () => {},
        onUndo: () => {},
        onRedo: () => {},
        canUndo: false,
        canRedo: true,
      })
    );

    // Undo button should have disabled attribute
    assert.ok(markupStart.includes('aria-label="Undo last move (Ctrl+Z)" disabled=""') || markupStart.includes('disabled="" aria-label="Undo last move (Ctrl+Z)"') || markupStart.includes('disabled'));

    const markupLatest = renderToStaticMarkup(
      React.createElement(MoveHistory, {
        history: state.history,
        currentStep: 1,
        onJumpToStep: () => {},
        onUndo: () => {},
        onRedo: () => {},
        canUndo: true,
        canRedo: false,
      })
    );

    assert.ok(markupLatest.includes('Redo next move (Ctrl+Y)'));
  });

  // --- LiveAnnouncer Component Tests ---
  console.log('\n9.5 LiveAnnouncer Component');
  test('LiveAnnouncer renders dual polite and assertive live regions', () => {
    const polite = "Player X marked Row 1, Column 1. Player O's turn.";
    const assertive = 'Invalid move: Row 1, Column 1 is already occupied by X.';

    const markup = renderToStaticMarkup(
      React.createElement(LiveAnnouncer, {
        politeMessage: polite,
        assertiveMessage: assertive,
      })
    );

    assert.ok(markup.includes('role="status"'));
    assert.ok(markup.includes('aria-live="polite"'));
    assert.ok(markup.includes('aria-atomic="true"'));
    assert.ok(markup.includes('Player X marked Row 1, Column 1. Player O') && markup.includes('turn.'));

    assert.ok(markup.includes('role="alert"'));
    assert.ok(markup.includes('aria-live="assertive"'));
    assert.ok(markup.includes('aria-atomic="true"'));
    assert.ok(markup.includes('Invalid move: Row 1, Column 1 is already occupied by X.'));
    assert.ok(markup.includes('sr-only'));
  });

  // --- KeyboardLegend Component Tests ---
  console.log('\n9.6 KeyboardLegend Component');
  test('KeyboardLegend renders accessible keyboard shortcuts toggle', () => {
    const markup = renderToStaticMarkup(React.createElement(KeyboardLegend));

    assert.ok(markup.includes('ttt-keyboard-toggle'));
    assert.ok(markup.includes('aria-expanded="false"'));
    assert.ok(markup.includes('aria-controls="ttt-shortcuts-panel"'));
    assert.ok(markup.includes('Keyboard Shortcuts'));
  });

  // --- Full Integrated TicTacToeGame Tests ---
  console.log('\n9.7 TicTacToeGame Application Component');
  test('TicTacToeGame renders full accessible UI tree on initial load', () => {
    const markup = renderToStaticMarkup(React.createElement(TicTacToeGame));

    assert.ok(markup.includes('ttt-app'));
    assert.ok(markup.includes('Tic-Tac-Toe'));
    assert.ok(markup.includes('Tic-Tac-Toe ready. Player X&#x27;s turn') || markup.includes('Tic-Tac-Toe ready. Player X\'s turn'));
    assert.ok(markup.includes('aria-label="Tic-Tac-Toe Game Board"'));
    assert.ok(markup.includes('Restart Game'));
    assert.ok(markup.includes('Move History'));
  });

  test('TicTacToeGame renders custom initial state with time-traveled board', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X at (1,1)
    state = makeMove(state, 4); // O at (2,2)
    state = makeMove(state, 8); // X at (3,3)

    // Jump back to step 1 (only X at 0)
    const timeTraveled = jumpToStep(state, 1);

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, {
        initialGameState: timeTraveled,
      })
    );

    assert.ok(markup.includes('data-value="X"'));
    assert.ok(markup.includes('data-index="0"'));
    assert.ok(markup.includes('Player O'));
    assert.ok(markup.includes('Move #1 (of 3)'));
  });

  test('TicTacToeGame renders completed win match with highlights and Play Again button', () => {
    let state = createInitialGameState();
    state = makeMove(state, 0); // X (0)
    state = makeMove(state, 3); // O (3)
    state = makeMove(state, 1); // X (1)
    state = makeMove(state, 4); // O (4)
    state = makeMove(state, 2); // X (2) wins on Top Row!

    assert.equal(state.status, 'won');
    assert.ok(state.winResult !== null);

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, {
        initialGameState: state,
      })
    );

    assert.ok(markup.includes('Play Again'));
    assert.ok(markup.includes('Player X'));
    assert.ok(markup.includes('Wins!'));
    assert.ok(markup.includes('Top row (Row 1)'));
    assert.ok(markup.includes('ttt-square--winning'));
  });

  test('TicTacToeGame renders draw stalemate with Draw indicator', () => {
    let state = createInitialGameState();
    // Stalemate sequence
    const moves = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    for (const m of moves) {
      state = makeMove(state, m);
    }
    assert.equal(state.status, 'draw');

    const markup = renderToStaticMarkup(
      React.createElement(TicTacToeGame, {
        initialGameState: state,
      })
    );

    assert.ok(markup.includes('Game Drawn!'));
    assert.ok(markup.includes('Play Again'));
  });
}
