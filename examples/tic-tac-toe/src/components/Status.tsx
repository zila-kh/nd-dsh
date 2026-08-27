import React from 'react';
import type { GameStatus, Player, WinResult } from '../types/game.js';
import { IconX, IconO } from './Square.js';

export interface ScoreState {
  xWins: number;
  oWins: number;
  draws: number;
}

export interface StatusProps {
  /** Match status: 'in_progress' | 'won' | 'draw' */
  status: GameStatus;
  /** Player whose turn it currently is */
  currentPlayer: Player;
  /** Winning result if game has a winner */
  winResult: WinResult | null;
  /** Current move step number (0 = start) */
  currentStep: number;
  /** Total moves in history */
  totalSteps: number;
  /** Match scores (optional) */
  scores?: ScoreState;
}

/**
 * Status and Turn Indicator component.
 *
 * Displays:
 * - Turn status (Player X vs Player O) with distinct token visuals
 * - Victory celebration message with winning line name
 * - Draw stalemate message
 * - Step and score tracking
 */
export function Status({
  status,
  currentPlayer,
  winResult,
  currentStep,
  totalSteps,
  scores,
}: StatusProps): React.JSX.Element {
  return (
    <div className="ttt-status-card" role="region" aria-label="Game Status">
      {/* Primary Game Status Banner */}
      <div className={`ttt-status-banner ttt-status-banner--${status}`}>
        {status === 'in_progress' && (
          <div className="ttt-turn-indicator">
            <span className="ttt-turn-label">Current Turn:</span>
            <div className={`ttt-player-badge ttt-player-badge--${currentPlayer.toLowerCase()} ttt-pulse`}>
              {currentPlayer === 'X' ? (
                <IconX className="token-icon token-badge-icon token-x" />
              ) : (
                <IconO className="token-icon token-badge-icon token-o" />
              )}
              <span className="ttt-player-text">Player {currentPlayer}</span>
            </div>
          </div>
        )}

        {status === 'won' && winResult && (
          <div className="ttt-victory-indicator" role="status">
            <span className="ttt-celebration-emoji" aria-hidden="true">🎉</span>
            <div className="ttt-victory-details">
              <span className="ttt-victory-title">
                <strong>Player {winResult.winner}</strong> Wins!
              </span>
              <span className="ttt-victory-subtitle">
                Victory on {winResult.description}
              </span>
            </div>
          </div>
        )}

        {status === 'draw' && (
          <div className="ttt-draw-indicator" role="status">
            <span className="ttt-draw-emoji" aria-hidden="true">🤝</span>
            <div className="ttt-draw-details">
              <span className="ttt-draw-title">Game Drawn!</span>
              <span className="ttt-draw-subtitle">
                All 9 squares filled with no winner.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Step & Score Counters */}
      <div className="ttt-status-meta">
        <div className="ttt-step-counter">
          <span className="ttt-meta-label">Step:</span>
          <span className="ttt-meta-value">
            {currentStep === 0 ? 'Start' : `Move #${currentStep}`}
            {totalSteps > currentStep ? ` (of ${totalSteps})` : ''}
          </span>
        </div>

        {scores && (
          <div className="ttt-scoreboard" aria-label="Match Scoreboard">
            <div className="ttt-score-pill ttt-score-pill--x">
              <span className="ttt-score-tag">X</span>
              <span className="ttt-score-count">{scores.xWins}</span>
            </div>
            <div className="ttt-score-pill ttt-score-pill--draw">
              <span className="ttt-score-tag">Draw</span>
              <span className="ttt-score-count">{scores.draws}</span>
            </div>
            <div className="ttt-score-pill ttt-score-pill--o">
              <span className="ttt-score-tag">O</span>
              <span className="ttt-score-count">{scores.oWins}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
