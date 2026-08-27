import React from 'react';
import type { MoveRecord } from '../types/game.js';
import { IconX, IconO } from './Square.js';

export interface MoveHistoryProps {
  /** Historical list of moves played so far */
  history: readonly MoveRecord[];
  /** Current time-travel active step number (0 = start) */
  currentStep: number;
  /** Jump directly to a specific step */
  onJumpToStep: (step: number) => void;
  /** Step back 1 move */
  onUndo: () => void;
  /** Step forward 1 move */
  onRedo: () => void;
  /** Whether undo is currently possible */
  canUndo: boolean;
  /** Whether redo is currently possible */
  canRedo: boolean;
}

/**
 * MoveHistory component implementing time-travel replay controls.
 *
 * Provides:
 * - Quick Jump controls (Undo, Redo, Start, Latest)
 * - Accessible `<nav aria-label="Move History">` with `<ol>` step timeline
 * - Active step highlighted with `aria-current="step"`
 */
export function MoveHistory({
  history,
  currentStep,
  onJumpToStep,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: MoveHistoryProps): React.JSX.Element {
  const totalMoves = history.length;

  return (
    <nav className="ttt-history-panel" aria-label="Move History and Time-Travel Controls">
      <div className="ttt-history-header">
        <h2 className="ttt-history-title">Move History</h2>
        <span className="ttt-history-badge">
          {totalMoves === 0 ? '0 moves' : `${totalMoves} ${totalMoves === 1 ? 'move' : 'moves'}`}
        </span>
      </div>

      {/* Quick Time-Travel Action Buttons */}
      <div className="ttt-history-actions" role="toolbar" aria-label="Time-travel quick actions">
        <button
          type="button"
          className="ttt-btn ttt-btn--secondary ttt-btn--sm"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo last move (Ctrl+Z)"
          title="Undo last move (Ctrl+Z)"
        >
          <span className="ttt-btn-icon" aria-hidden="true">↩</span>
          <span>Undo</span>
        </button>

        <button
          type="button"
          className="ttt-btn ttt-btn--secondary ttt-btn--sm"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo next move (Ctrl+Y)"
          title="Redo next move (Ctrl+Y)"
        >
          <span className="ttt-btn-icon" aria-hidden="true">↪</span>
          <span>Redo</span>
        </button>

        <button
          type="button"
          className="ttt-btn ttt-btn--ghost ttt-btn--sm"
          onClick={() => onJumpToStep(0)}
          disabled={currentStep === 0}
          aria-label="Jump to game start"
          title="Jump to game start"
        >
          <span>Start</span>
        </button>

        <button
          type="button"
          className="ttt-btn ttt-btn--ghost ttt-btn--sm"
          onClick={() => onJumpToStep(totalMoves)}
          disabled={currentStep === totalMoves}
          aria-label="Jump to latest move"
          title="Jump to latest move"
        >
          <span>Latest</span>
        </button>
      </div>

      {/* Step by Step Timeline */}
      <div className="ttt-history-scroll-container">
        <ol className="ttt-history-list">
          {/* Step 0: Game Start */}
          <li className="ttt-history-item">
            <button
              type="button"
              className={`ttt-history-btn ${currentStep === 0 ? 'ttt-history-btn--active' : ''}`}
              onClick={() => onJumpToStep(0)}
              aria-current={currentStep === 0 ? 'step' : undefined}
              aria-label="Step 0: Game Start, Empty Board"
            >
              <span className="ttt-step-number">0</span>
              <span className="ttt-step-desc">Game Start</span>
              {currentStep === 0 && (
                <span className="ttt-step-current-tag" aria-hidden="true">Current</span>
              )}
            </button>
          </li>

          {/* History Steps 1..N */}
          {history.map((record) => {
            const isCurrent = record.step === currentStep;
            const isFuture = record.step > currentStep;
            const ariaLabel = `Move ${record.step}: Player ${record.player} at Row ${record.row}, Column ${record.col}${isCurrent ? ', Current Step' : ''}`;

            return (
              <li key={record.step} className={`ttt-history-item ${isFuture ? 'ttt-history-item--future' : ''}`}>
                <button
                  type="button"
                  className={`ttt-history-btn ${isCurrent ? 'ttt-history-btn--active' : ''}`}
                  onClick={() => onJumpToStep(record.step)}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={ariaLabel}
                >
                  <span className="ttt-step-number">{record.step}</span>
                  <span className="ttt-step-player-icon" aria-hidden="true">
                    {record.player === 'X' ? (
                      <IconX className="token-icon token-mini token-x" />
                    ) : (
                      <IconO className="token-icon token-mini token-o" />
                    )}
                  </span>
                  <span className="ttt-step-desc">
                    Row {record.row}, Col {record.col}
                  </span>
                  {isCurrent && (
                    <span className="ttt-step-current-tag" aria-hidden="true">Current</span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
