import React from 'react'
import type { GamePhase } from '../../types/index.js'
import { getVisualChipStack } from '../../constants/chips.js'
import { ChipIcon } from '../../assets/icons/ChipIcon.js'
import { Trash2 } from 'lucide-react'

interface BetStackIndicatorProps {
  amount: number
  symbolName: string
  symbolId?: string
  phase: GamePhase
  disabled?: boolean
  onRemove?: () => void
}

export const BetStackIndicator: React.FC<BetStackIndicatorProps> = ({
  amount,
  symbolName,
  symbolId,
  phase,
  disabled = false,
  onRemove,
}) => {
  if (amount <= 0) return null

  const isBetting = phase === 'betting'
  const { visibleChips } = getVisualChipStack(amount, 4)

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering onPlaceBet on parent tile
    if (!disabled && isBetting && onRemove) {
      onRemove()
    }
  }

  const handleRemoveKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation()
      e.preventDefault()
      if (!disabled && isBetting && onRemove) {
        onRemove()
      }
    }
  }

  return (
    <div
      className="absolute bottom-2 right-2 z-20 flex items-center gap-1.5 p-1 rounded-2xl bg-stone-950/90 border border-amber-400/90 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-90 duration-200"
      data-testid={symbolId ? `bet-badge-${symbolId}` : 'bet-stack-indicator'}
      aria-label={`Active bet on ${symbolName}: $${amount}`}
    >
      {/* 3D Visual Chip Stack Representation */}
      <div
        className="relative flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 select-none"
        aria-hidden="true"
      >
        {visibleChips.map((chipVal, index) => {
          // Bottom-up 3D layer offset
          const offsetY = (visibleChips.length - 1 - index) * -2.5
          const isTop = index === 0

          return (
            <div
              key={`${chipVal}-${index}`}
              className="absolute transition-transform duration-150"
              style={{
                transform: `translateY(${offsetY}px)`,
                zIndex: 10 + (visibleChips.length - index),
              }}
            >
              <ChipIcon
                value={chipVal}
                size={isTop ? 28 : 26}
                asButton={false}
                className="drop-shadow-md"
              />
            </div>
          )
        })}
      </div>

      {/* Numerical Bet Amount */}
      <div className="flex flex-col pr-1 text-left">
        <span className="text-[10px] uppercase font-bold text-amber-400/80 leading-none">
          Bet
        </span>
        <span className="text-xs sm:text-sm font-black text-amber-300 tabular-nums leading-tight">
          ${amount.toLocaleString()}
        </span>
      </div>

      {/* Touch-Friendly & Accessible Clear/Remove Individual Bet Button */}
      {isBetting && !disabled && onRemove && (
        <button
          type="button"
          onClick={handleRemoveClick}
          onKeyDown={handleRemoveKeyDown}
          aria-label={`Clear bet on ${symbolName}`}
          title={`Clear bet on ${symbolName}`}
          data-testid={symbolId ? `clear-bet-${symbolId}` : 'clear-bet-button'}
          className="ml-0.5 p-1.5 rounded-xl bg-stone-800/90 hover:bg-red-600/90 active:bg-red-700 text-stone-300 hover:text-white transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 shadow-sm"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
