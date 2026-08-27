import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState } from '../types/game.js';
import {
  createInitialGameState,
  makeMove,
  jumpToStep,
  undoMove,
  redoMove,
  resetGame,
  setFocusedCellIndex,
  validateMove,
  canUndo,
  canRedo,
} from '../game/engine.js';
import { indexToCoordinates } from '../game/evaluator.js';
import { Board } from './Board.js';
import { Status, type ScoreState } from './Status.js';
import { MoveHistory } from './MoveHistory.js';
import { LiveAnnouncer } from './LiveAnnouncer.js';
import { KeyboardLegend } from './KeyboardLegend.js';

export interface TicTacToeGameProps {
  /** Optional initial state for testing or hydration */
  initialGameState?: GameState;
  /** Optional callback triggered on match finish */
  onGameEnd?: (status: GameState['status'], winResult: GameState['winResult']) => void;
}

/**
 * Root TicTacToeGame application component.
 *
 * Coordinates:
 * - Pure engine state machine
 * - Dual ARIA live region screen reader announcements
 * - 2D roving tabindex keyboard navigation & global shortcuts
 * - Time-travel history replay and branch management
 * - Responsive UI layout with high-contrast accessibility compliance
 */
export function TicTacToeGame({
  initialGameState,
  onGameEnd,
}: TicTacToeGameProps): React.JSX.Element {
  const [gameState, setGameState] = useState<GameState>(
    () => initialGameState ?? createInitialGameState()
  );

  const [scores, setScores] = useState<ScoreState>({
    xWins: 0,
    oWins: 0,
    draws: 0,
  });

  const [politeMessage, setPoliteMessage] = useState<string>(
    "Tic-Tac-Toe ready. Player X's turn. Use arrow keys to navigate the 3 by 3 board, Space or Enter to place a mark."
  );
  const [assertiveMessage, setAssertiveMessage] = useState<string>('');

  // Keep track of previous status to update scores only once per completion
  const prevStatusRef = useRef<GameState['status']>(gameState.status);

  // Update scores and broadcast win/draw announcements when game concludes
  useEffect(() => {
    if (gameState.status !== 'in_progress' && prevStatusRef.current === 'in_progress') {
      if (gameState.status === 'won' && gameState.winResult) {
        setScores((prev) => ({
          ...prev,
          xWins: gameState.winResult?.winner === 'X' ? prev.xWins + 1 : prev.xWins,
          oWins: gameState.winResult?.winner === 'O' ? prev.oWins + 1 : prev.oWins,
        }));
        setAssertiveMessage(
          `Game Over! Player ${gameState.winResult.winner} wins with three in a row on ${gameState.winResult.description}! Press Restart or Alt+R to play again.`
        );
      } else if (gameState.status === 'draw') {
        setScores((prev) => ({ ...prev, draws: prev.draws + 1 }));
        setAssertiveMessage(
          "Game Over! It's a draw! All 9 squares are filled with no winner. Press Restart or Alt+R to play again."
        );
      }
      onGameEnd?.(gameState.status, gameState.winResult);
    }
    prevStatusRef.current = gameState.status;
  }, [gameState.status, gameState.winResult, onGameEnd]);

  // Handle cell click / keyboard move attempt
  const handleCellClick = useCallback(
    (index: number): void => {
      const validation = validateMove(gameState, index);
      if (!validation.valid) {
        // Broadcast accessible invalid move alert
        if (validation.message) {
          setAssertiveMessage(validation.message);
        }
        return;
      }

      const activePlayer = gameState.currentPlayer;
      const { row, col } = indexToCoordinates(index);
      const nextState = makeMove(gameState, index);
      setGameState(nextState);

      if (nextState.status === 'in_progress') {
        setPoliteMessage(
          `Player ${activePlayer} marked Row ${row}, Column ${col}. Player ${nextState.currentPlayer}'s turn.`
        );
      }
    },
    [gameState]
  );

  // Handle keyboard focus change inside the board
  const handleCellFocus = useCallback((index: number): void => {
    setGameState((prev) => setFocusedCellIndex(prev, index));
  }, []);

  // Time-travel jump to step
  const handleJumpToStep = useCallback(
    (targetStep: number): void => {
      try {
        const nextState = jumpToStep(gameState, targetStep);
        setGameState(nextState);

        if (targetStep === 0) {
          setPoliteMessage("Jumped to game start. Board cleared. Player X's turn.");
        } else {
          const move = gameState.history[targetStep - 1];
          if (move) {
            setPoliteMessage(
              `Jumped to Move ${move.step} (${move.player} at Row ${move.row}, Column ${move.col}). Board updated. Player ${nextState.currentPlayer}'s turn.`
            );
          }
        }
      } catch {
        // Ignore invalid step bounds
      }
    },
    [gameState]
  );

  // Undo move
  const handleUndo = useCallback((): void => {
    if (canUndo(gameState)) {
      handleJumpToStep(gameState.currentStep - 1);
    }
  }, [gameState, handleJumpToStep]);

  // Redo move
  const handleRedo = useCallback((): void => {
    if (canRedo(gameState)) {
      handleJumpToStep(gameState.currentStep + 1);
    }
  }, [gameState, handleJumpToStep]);

  // Restart match
  const handleRestart = useCallback((): void => {
    const fresh = resetGame();
    setGameState(fresh);
    setAssertiveMessage(
      "Game reset. New match started. Player X's turn. Focused on Row 1, Column 1."
    );
    setPoliteMessage("Player X's turn.");
  }, []);

  // Global Keyboard shortcuts (Alt+R, Ctrl+Z, Ctrl+Y, Cmd+Z, Cmd+Shift+Z)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      // Don't intercept if user is typing into an input/textarea
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Alt + R (Restart game)
      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        handleRestart();
        return;
      }

      // Undo: Ctrl + Z / Cmd + Z (without Shift)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Redo: Ctrl + Y / Cmd + Shift + Z / Ctrl + Shift + Z
      if (
        ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
      ) {
        e.preventDefault();
        handleRedo();
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [handleRestart, handleUndo, handleRedo]);

  const isGameOver = gameState.status !== 'in_progress';

  return (
    <div className="ttt-app">
      {/* Visually hidden Live Region announcer */}
      <LiveAnnouncer
        politeMessage={politeMessage}
        assertiveMessage={assertiveMessage}
      />

      <header className="ttt-header">
        <h1 className="ttt-title">Tic-Tac-Toe</h1>
        <p className="ttt-subtitle">Accessible & Responsive 3x3 Match</p>
      </header>

      <main className="ttt-main-layout">
        {/* Left Column: Status Card, Board & Controls */}
        <section className="ttt-board-section" aria-label="Game Play Area">
          <Status
            status={gameState.status}
            currentPlayer={gameState.currentPlayer}
            winResult={gameState.winResult}
            currentStep={gameState.currentStep}
            totalSteps={gameState.history.length}
            scores={scores}
          />

          <Board
            board={gameState.board}
            winResult={gameState.winResult}
            isGameOver={isGameOver}
            focusedIndex={gameState.focusedCellIndex}
            currentPlayer={gameState.currentPlayer}
            onCellClick={handleCellClick}
            onCellFocus={handleCellFocus}
          />

          {/* Primary Controls */}
          <div className="ttt-main-controls" role="toolbar" aria-label="Game Controls">
            <button
              type="button"
              className="ttt-btn ttt-btn--primary ttt-btn--restart"
              onClick={handleRestart}
              aria-label="Restart game (Alt+R)"
              title="Restart game (Alt+R)"
            >
              <span className="ttt-btn-icon" aria-hidden="true">↺</span>
              <span>{isGameOver ? 'Play Again' : 'Restart Game'}</span>
            </button>
          </div>
        </section>

        {/* Right Column: Move History Time-Travel Replay */}
        <aside className="ttt-sidebar-section" aria-label="Move History Sidebar">
          <MoveHistory
            history={gameState.history}
            currentStep={gameState.currentStep}
            onJumpToStep={handleJumpToStep}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo(gameState)}
            canRedo={canRedo(gameState)}
          />

          <KeyboardLegend />
        </aside>
      </main>
    </div>
  );
}
