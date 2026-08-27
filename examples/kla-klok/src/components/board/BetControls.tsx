import React from 'react'
import type { GamePhase } from '../../types/index.js'
import { Play, Trash2, Copy, RotateCcw, ArrowRight } from 'lucide-react'

interface BetControlsProps {
  phase: GamePhase
  hasBets: boolean
  canDouble: boolean
  canRebet: boolean
  onRoll: () => void
  onClear: () => void
  onDouble: () => void
  onRebet: () => void
  onNextRound: () => void
  t: (key: any, params?: Record<string, string | number>) => string
}

export const BetControls: React.FC<BetControlsProps> = ({
  phase,
  hasBets,
  canDouble,
  canRebet,
  onRoll,
  onClear,
  onDouble,
  onRebet,
  onNextRound,
  t,
}) => {
  const isBetting = phase === 'betting'
  const isRolling = phase === 'rolling' || phase === 'revealing'
  const isSettled = phase === 'settled'

  return (
    <div
      className="w-full flex flex-wrap items-center justify-between gap-3 bg-stone-900/80 border border-stone-800 rounded-3xl p-3 sm:p-4 shadow-xl backdrop-blur-sm"
      data-testid="bet-controls"
      role="toolbar"
      aria-label="Game and betting actions"
    >
      {/* Secondary Actions (Clear, Double, Rebet) */}
      <div className="flex items-center flex-wrap gap-2">
        <button
          type="button"
          onClick={onClear}
          disabled={!isBetting || !hasBets}
          data-testid="clear-bets-button"
          aria-keyshortcuts="KeyC"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-stone-200 text-xs sm:text-sm font-medium transition cursor-pointer disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          aria-label={`${t('bet.clear')} (Hotkey: C)`}
        >
          <Trash2 className="w-4 h-4 text-red-400" />
          <span className="font-khmer">{t('bet.clear')}</span>
          <kbd className="hidden sm:inline text-[10px] font-mono bg-stone-900 px-1.5 py-0.5 rounded text-stone-400 border border-stone-700 font-bold">
            C
          </kbd>
        </button>

        <button
          type="button"
          onClick={onDouble}
          disabled={!isBetting || !canDouble}
          data-testid="double-bets-button"
          aria-keyshortcuts="KeyD"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-stone-200 text-xs sm:text-sm font-medium transition cursor-pointer disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          aria-label={`${t('bet.double')} (Hotkey: D)`}
        >
          <Copy className="w-4 h-4 text-amber-400" />
          <span className="font-khmer">{t('bet.double')}</span>
          <kbd className="hidden sm:inline text-[10px] font-mono bg-stone-900 px-1.5 py-0.5 rounded text-stone-400 border border-stone-700 font-bold">
            D
          </kbd>
        </button>

        <button
          type="button"
          onClick={onRebet}
          disabled={!isBetting || !canRebet}
          data-testid="rebet-button"
          aria-keyshortcuts="KeyB"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-stone-800 hover:bg-stone-700 disabled:opacity-40 disabled:hover:bg-stone-800 text-stone-200 text-xs sm:text-sm font-medium transition cursor-pointer disabled:cursor-not-allowed focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
          aria-label={`${t('bet.rebet')} (Hotkey: B)`}
        >
          <RotateCcw className="w-4 h-4 text-sky-400" />
          <span className="font-khmer">{t('bet.rebet')}</span>
          <kbd className="hidden sm:inline text-[10px] font-mono bg-stone-900 px-1.5 py-0.5 rounded text-stone-400 border border-stone-700 font-bold">
            B
          </kbd>
        </button>
      </div>

      {/* Primary Action Button (Roll Dice or Next Round) */}
      <div>
        {isSettled ? (
          <button
            type="button"
            onClick={onNextRound}
            data-testid="next-round-button"
            aria-keyshortcuts="Space KeyR"
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-stone-950 font-bold text-sm sm:text-base shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400"
            aria-label={`${t('action.new_round')} (Hotkey: Space or R)`}
          >
            <span className="font-khmer">{t('action.new_round')}</span>
            <ArrowRight className="w-5 h-5" />
            <kbd className="hidden sm:inline text-[10px] font-mono bg-amber-600/60 px-1.5 py-0.5 rounded text-stone-950 font-bold">
              R
            </kbd>
          </button>
        ) : (
          <button
            type="button"
            onClick={onRoll}
            disabled={!isBetting || !hasBets || isRolling}
            data-testid="roll-button"
            aria-keyshortcuts="Space KeyR"
            aria-label={`${isRolling ? t('action.rolling') : t('action.roll')} (Hotkey: Space or R)`}
            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-2xl font-bold text-sm sm:text-base transition-all select-none cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${
              isRolling
                ? 'bg-amber-600/50 text-amber-200 animate-pulse cursor-wait'
                : hasBets
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-stone-950 shadow-lg shadow-amber-500/30 hover:scale-105 active:scale-95'
                  : 'bg-stone-800 text-stone-500 cursor-not-allowed opacity-50'
            }`}
          >
            <Play className="w-5 h-5 fill-current" />
            <span className="font-khmer">{isRolling ? t('action.rolling') : t('action.roll')}</span>
            {hasBets && !isRolling && (
              <kbd className="hidden sm:inline text-[10px] font-mono bg-amber-600/60 px-1.5 py-0.5 rounded text-stone-950 font-bold">
                R
              </kbd>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
export default BetControls
