import React from 'react'
import type { GamePhase, DiceOutcome, RoundSettlement, Language, SymbolId } from '../../types/index.js'
import { Die3D } from './Die3D.js'
import { ShakerCup } from './ShakerCup.js'
import { Sparkles, AlertCircle, Trophy, Flame } from 'lucide-react'

interface DiceArenaProps {
  phase: GamePhase
  lastOutcome: DiceOutcome | null
  settlement: RoundSettlement | null
  language: Language
  canRoll?: boolean
  onRoll?: () => void
  t: (key: any, params?: Record<string, string | number>) => string
}

export const DiceArena: React.FC<DiceArenaProps> = ({
  phase,
  lastOutcome,
  settlement,
  language,
  canRoll = false,
  onRoll,
  t,
}) => {
  const isRolling = phase === 'rolling'
  const isRevealing = phase === 'revealing'
  const isSettled = phase === 'settled'
  const isBetting = phase === 'betting'

  const dice = lastOutcome?.dice || (['tiger', 'gourd', 'rooster'] as [SymbolId, SymbolId, SymbolId])

  // Determine if each rolled die is a winning match for the player
  const isDieWinning = (symbol: SymbolId): boolean => {
    if (!isSettled || !settlement) return false
    const breakdown = settlement.breakdown[symbol]
    return !!breakdown && breakdown.wonStake > 0
  }

  const getDieMatchCount = (symbol: SymbolId): number => {
    if (!isSettled || !settlement) return 0
    return settlement.breakdown[symbol]?.matchCount || 0
  }

  return (
    <div
      className="w-full bg-gradient-to-b from-stone-900/95 via-stone-950/95 to-black border border-stone-800 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col items-center justify-center min-h-[260px] relative overflow-hidden"
      data-testid="dice-arena"
      aria-label="Kla-Klok Dice Arena"
    >
      {/* Background ambient lighting and traditional gold radial glow */}
      <div className="absolute inset-0 bg-radial from-amber-500/10 via-amber-600/5 to-transparent pointer-events-none" />

      {/* Traditional Wooden Lacquer Tray / Platter Rim Decoration */}
      <div className="absolute inset-2 sm:inset-3 rounded-2xl border border-amber-500/20 pointer-events-none" />

      {/* Stage Container */}
      <div className="flex flex-col items-center justify-center gap-4 w-full z-10">
        {/* Shaker Cup vs Tumbling / Resting Dice */}
        {isRolling ? (
          <div className="flex flex-col items-center justify-center gap-3 py-2 animate-in fade-in duration-300">
            <ShakerCup
              phase={phase}
              isRolling={true}
              canRoll={false}
              disabled={true}
              t={t}
            />
            <div className="text-amber-400 font-bold text-sm sm:text-base animate-pulse flex items-center gap-2 bg-amber-950/60 px-4 py-1.5 rounded-full border border-amber-500/30">
              <Sparkles className="w-4 h-4 text-amber-300 animate-spin" />
              <span className="font-khmer">{t('status.rolling')}</span>
            </div>
          </div>
        ) : isRevealing ? (
          <div className="flex flex-col items-center justify-center gap-3 py-2 relative w-full">
            {/* Shaker Cup Lifting Up to Reveal Dice */}
            <div className="absolute -top-6 z-20 pointer-events-none">
              <ShakerCup
                phase={phase}
                isRevealing={true}
                canRoll={false}
                disabled={true}
                t={t}
              />
            </div>

            {/* 3 Tumbling 3D Dice */}
            <div
              className="flex items-center justify-center gap-3 sm:gap-6 py-2"
              data-testid="dice-display-group"
            >
              <Die3D
                symbol={dice[0]}
                index={0}
                phase={phase}
                isRolling={true}
                language={language}
              />
              <Die3D
                symbol={dice[1]}
                index={1}
                phase={phase}
                isRolling={true}
                language={language}
              />
              <Die3D
                symbol={dice[2]}
                index={2}
                phase={phase}
                isRolling={true}
                language={language}
              />
            </div>

            <div className="text-amber-300 font-bold text-xs sm:text-sm animate-pulse font-khmer">
              {t('action.reveal')}
            </div>
          </div>
        ) : (
          /* Settled or Betting Resting State */
          <div className="flex flex-col items-center justify-center gap-4 w-full">
            {/* 3 Dice in resting position */}
            <div
              className="flex items-center justify-center gap-3 sm:gap-6 py-2"
              data-testid="dice-display-group"
            >
              <Die3D
                symbol={dice[0]}
                index={0}
                phase={phase}
                isWinning={isDieWinning(dice[0])}
                matchCount={getDieMatchCount(dice[0])}
                language={language}
              />
              <Die3D
                symbol={dice[1]}
                index={1}
                phase={phase}
                isWinning={isDieWinning(dice[1])}
                matchCount={getDieMatchCount(dice[1])}
                language={language}
              />
              <Die3D
                symbol={dice[2]}
                index={2}
                phase={phase}
                isWinning={isDieWinning(dice[2])}
                matchCount={getDieMatchCount(dice[2])}
                language={language}
              />
            </div>

            {/* Settlement Banner in Settled Phase */}
            {isSettled && settlement && (
              <div
                className={`w-full max-w-lg rounded-2xl p-3 sm:p-4 text-center border shadow-xl flex items-center justify-center gap-3.5 animate-in zoom-in-95 duration-300 ${
                  settlement.isWin
                    ? settlement.highestMultiplier >= 3
                      ? 'bg-gradient-to-r from-amber-950/90 via-yellow-950/90 to-amber-950/90 border-amber-300 text-amber-200 shadow-amber-500/30'
                      : settlement.highestMultiplier === 2
                        ? 'bg-gradient-to-r from-amber-950/80 to-stone-900/90 border-amber-400 text-amber-300 shadow-amber-500/20'
                        : 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-emerald-500/20'
                    : 'bg-stone-900/80 border-stone-700 text-stone-300'
                }`}
                data-testid="settlement-banner"
              >
                {settlement.isWin ? (
                  <>
                    <div className="p-2.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/30">
                      {settlement.highestMultiplier >= 3 ? (
                        <Flame className="w-6 h-6 text-yellow-300 animate-bounce" />
                      ) : settlement.highestMultiplier === 2 ? (
                        <Trophy className="w-6 h-6 animate-bounce" />
                      ) : (
                        <Sparkles className="w-6 h-6" />
                      )}
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-base sm:text-lg font-khmer flex items-center gap-2">
                        <span>
                          {settlement.highestMultiplier === 3
                            ? t('status.jackpot')
                            : settlement.highestMultiplier === 2
                              ? t('status.big_win')
                              : t('status.win')}
                        </span>
                        {settlement.highestMultiplier >= 2 && (
                          <span className="text-xs bg-amber-500 text-stone-950 font-sans font-extrabold px-1.5 py-0.5 rounded">
                            {settlement.highestMultiplier}x
                          </span>
                        )}
                      </div>
                      <div className="text-xs sm:text-sm font-medium">
                        <span className="text-emerald-400 font-bold">
                          {`+$${settlement.netProfit.toLocaleString()}`}
                        </span>{' '}
                        <span className="text-stone-300">
                          {`(${t('bet.payout')}: $${settlement.totalReturn.toLocaleString()})`}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-2.5 rounded-full bg-stone-800 text-stone-400 border border-stone-700">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <div className="font-bold text-base sm:text-lg font-khmer">
                        {t('status.loss')}
                      </div>
                      <div className="text-xs sm:text-sm text-red-400 font-medium">
                        {`-$${settlement.totalStake.toLocaleString()} `}{t('bet.stake')}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Waiting for bets helper text in Betting Phase */}
            {isBetting && !isSettled && (
              <div className="text-stone-400 text-xs sm:text-sm font-medium flex items-center gap-2 bg-stone-900/60 px-3.5 py-1.5 rounded-full border border-stone-800">
                {canRoll && onRoll ? (
                  <button
                    type="button"
                    onClick={onRoll}
                    className="text-amber-400 hover:text-amber-300 font-khmer cursor-pointer flex items-center gap-1.5 focus:outline-none focus-visible:underline"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t('action.roll')}</span>
                  </button>
                ) : (
                  <span className="font-khmer">{t('status.waiting_bets')}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
export default DiceArena
