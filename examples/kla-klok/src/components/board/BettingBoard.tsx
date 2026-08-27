import React, { useCallback } from 'react'
import type { SymbolId, BetMap, RoundSettlement, Language, GamePhase } from '../../types/index.js'
import { SYMBOLS_LIST } from '../../constants/index.js'
import { calculateTotalBet } from '../../core/betting.js'
import { SymbolTile } from './SymbolTile.js'
import { KbachBorder } from '../../assets/icons/KbachBorder.js'
import { Coins, Trash2 } from 'lucide-react'

interface BettingBoardProps {
  currentBets: BetMap
  settlement: RoundSettlement | null
  phase: GamePhase
  language: Language
  onPlaceBet: (symbolId: SymbolId) => void
  onRemoveBet: (symbolId: SymbolId) => void
  onClearBets?: () => void
  disabled?: boolean
}

export const BettingBoard: React.FC<BettingBoardProps> = ({
  currentBets,
  settlement,
  phase,
  language,
  onPlaceBet,
  onRemoveBet,
  onClearBets,
  disabled = false,
}) => {
  const totalBet = calculateTotalBet(currentBets)
  const activeSymbolsCount = Object.values(currentBets).filter((amount) => (amount || 0) > 0).length
  const isBetting = phase === 'betting'

  const handleNavigateGrid = useCallback((currentIndex: number, direction: 'up' | 'down' | 'left' | 'right') => {
    let nextIndex = currentIndex
    if (direction === 'left') {
      nextIndex = (currentIndex - 1 + 6) % 6
    } else if (direction === 'right') {
      nextIndex = (currentIndex + 1) % 6
    } else if (direction === 'up') {
      nextIndex = (currentIndex - 3 + 6) % 6
    } else if (direction === 'down') {
      nextIndex = (currentIndex + 3) % 6
    }

    const nextSymbol = SYMBOLS_LIST[nextIndex]
    if (nextSymbol && typeof document !== 'undefined') {
      const tileEl = document.querySelector<HTMLElement>(`[data-testid="symbol-tile-${nextSymbol.id}"]`)
      tileEl?.focus()
    }
  }, [])

  return (
    <section
      className="w-full bg-stone-900/70 p-3 sm:p-5 rounded-3xl border border-stone-800/90 shadow-2xl backdrop-blur-md flex flex-col gap-3 sm:gap-4"
      data-testid="betting-board"
      aria-label={language === 'km' ? 'ក្ដារភ្នាល់ខ្លាឃ្លោក' : 'Kla-Klok Betting Board'}
    >
      {/* Traditional Khmer Kbach Decorative Border Accent */}
      <KbachBorder className="w-full h-3 text-amber-500/30 -mb-1" />

      {/* Dynamic Table Header: Active Bets, Total Sum on Table, and Quick Reset */}
      <div className="w-full flex items-center justify-between flex-wrap gap-2 px-1 py-1 sm:px-2 border-b border-stone-800/80 pb-2.5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-stone-950/80 border border-stone-700/70 text-xs sm:text-sm font-semibold text-stone-200">
            <Coins className="w-4 h-4 text-amber-400" />
            <span>
              {language === 'km' ? 'ការភ្នាល់សកម្ម៖' : 'Active Bets:'}{' '}
              <strong className="text-amber-400 font-bold">{activeSymbolsCount}</strong>/6
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-stone-950/80 border border-amber-500/40 text-xs sm:text-sm font-semibold text-amber-300"
            data-testid="table-total-bet"
          >
            <span>{language === 'km' ? 'ប្រាក់លើក្ដារ៖' : 'Total on Table:'}</span>
            <span className="font-extrabold font-mono text-amber-400">
              ${totalBet.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Quick Clear / Reset Table Button */}
        {onClearBets && isBetting && totalBet > 0 && (
          <button
            type="button"
            onClick={onClearBets}
            disabled={disabled}
            aria-label={language === 'km' ? 'សម្អាតក្ដារភ្នាល់ទាំងអស់' : 'Clear all bets on table'}
            data-testid="board-clear-all-button"
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-stone-800/80 hover:bg-red-600/90 text-stone-300 hover:text-white text-xs font-semibold transition-all cursor-pointer shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-red-400"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{language === 'km' ? 'លុបទាំងអស់' : 'Clear Table'}</span>
          </button>
        )}
      </div>

      {/* 2x3 Grid Displaying All 6 Kla-Klok Symbols */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4" role="region" aria-label="Six betting symbols grid">
        {SYMBOLS_LIST.map((symbol, idx) => {
          const betAmount = currentBets[symbol.id] || 0
          const payoutResult = settlement?.breakdown[symbol.id] || null

          return (
            <SymbolTile
              key={symbol.id}
              symbol={symbol}
              betAmount={betAmount}
              payoutResult={payoutResult}
              phase={phase}
              language={language}
              onPlaceBet={onPlaceBet}
              onRemoveBet={onRemoveBet}
              onNavigateGrid={(dir) => handleNavigateGrid(idx, dir)}
              disabled={disabled}
            />
          )
        })}
      </div>

      {/* Bottom Kbach accent */}
      <KbachBorder className="w-full h-3 text-amber-500/20 -mt-1" />
    </section>
  )
}
