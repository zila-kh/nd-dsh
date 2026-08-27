import React from 'react'
import type { SymbolInfo, SymbolPayoutResult, Language, GamePhase } from '../../types/index.js'
import { renderSymbolIcon } from '../../assets/icons/index.js'
import { getMultiplierBadge } from '../../core/payout.js'
import { BetStackIndicator } from './BetStackIndicator.js'

interface SymbolTileProps {
  symbol: SymbolInfo
  betAmount: number
  payoutResult?: SymbolPayoutResult | null
  phase: GamePhase
  language: Language
  onPlaceBet: (symbolId: SymbolInfo['id']) => void
  onRemoveBet: (symbolId: SymbolInfo['id']) => void
  onNavigateGrid?: (direction: 'up' | 'down' | 'left' | 'right') => void
  disabled?: boolean
}

export const SymbolTile: React.FC<SymbolTileProps> = ({
  symbol,
  betAmount,
  payoutResult,
  phase,
  language,
  onPlaceBet,
  onRemoveBet,
  onNavigateGrid,
  disabled = false,
}) => {
  const isSettled = phase === 'settled'
  const isRolling = phase === 'rolling' || phase === 'revealing'
  const isBetting = phase === 'betting'
  const hasBet = betAmount > 0
  const matchCount = payoutResult?.matchCount || 0
  const isWinner = isSettled && matchCount > 0
  const isLoser = isSettled && hasBet && matchCount === 0

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!disabled && hasBet && isBetting) {
      onRemoveBet(symbol.id)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || isRolling) return

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPlaceBet(symbol.id)
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '-') {
      e.preventDefault()
      if (hasBet) {
        onRemoveBet(symbol.id)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onNavigateGrid?.('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onNavigateGrid?.('right')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onNavigateGrid?.('up')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      onNavigateGrid?.('down')
    }
  }

  const localizedName = language === 'km' ? symbol.khmerName : symbol.englishName

  return (
    <div
      role="button"
      tabIndex={disabled || isRolling ? -1 : 0}
      onClick={() => {
        if (!disabled && !isRolling && isBetting) {
          onPlaceBet(symbol.id)
        }
      }}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      aria-label={`${symbol.khmerName} (${symbol.englishName}), Key ${symbol.gridOrder + 1}. Current bet: $${betAmount}.${
        isSettled && matchCount > 0 ? ` Won ${matchCount} match payout!` : ''
      }`}
      aria-pressed={hasBet}
      aria-disabled={disabled || isRolling}
      data-testid={`symbol-tile-${symbol.id}`}
      data-symbol-id={symbol.id}
      className={`group relative rounded-3xl p-3.5 sm:p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 select-none cursor-pointer overflow-hidden shadow-xl min-h-[175px] sm:min-h-[205px] focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 ${
        symbol.colorPalette.bgClass
      } ${
        isWinner
          ? 'ring-4 ring-amber-400 border-amber-300 scale-[1.03] shadow-2xl shadow-amber-500/50 animate-pulse z-10'
          : isLoser
            ? 'opacity-60 border-stone-800'
            : hasBet
              ? 'border-amber-400 ring-2 ring-amber-400/60 shadow-2xl scale-[1.01]'
              : symbol.colorPalette.borderClass
      } ${
        disabled || isRolling
          ? 'cursor-default'
          : 'hover:scale-[1.02] hover:shadow-2xl hover:border-amber-400/90 active:scale-[0.98]'
      }`}
    >
      {/* Background Radial Glow Accent */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none group-hover:opacity-35 transition-opacity"
        style={{
          background: `radial-gradient(circle at 50% 40%, ${symbol.colorPalette.primary}, transparent 70%)`,
        }}
      />

      {/* Khmer traditional corner bracket decor */}
      <div
        className="absolute top-2 left-2 text-stone-600/30 group-hover:text-amber-400/40 text-[10px] font-mono pointer-events-none transition-colors"
        aria-hidden="true"
      >
        ✦
      </div>
      <div
        className="absolute top-2 right-2 text-stone-600/30 group-hover:text-amber-400/40 text-[10px] font-mono pointer-events-none transition-colors"
        aria-hidden="true"
      >
        ✦
      </div>

      {/* Top row: IPA badge or Winning Match Multiplier Badge */}
      <div className="w-full flex items-center justify-between z-10 gap-2">
        <span className="text-[10px] sm:text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-stone-950/80 border border-stone-700/60 text-stone-300 shadow-sm">
          {symbol.ipa}
        </span>

        {isSettled && matchCount > 0 ? (
          <span
            className="text-xs sm:text-sm font-extrabold px-2.5 py-0.5 rounded-full bg-amber-400 text-stone-950 border border-amber-200 shadow-lg animate-bounce"
            data-testid={`match-badge-${symbol.id}`}
          >
            {getMultiplierBadge(matchCount, language)}
          </span>
        ) : (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-stone-950/70 border border-stone-800 text-amber-400/80 uppercase tracking-widest font-mono">
            [{symbol.gridOrder + 1}]
          </span>
        )}
      </div>

      {/* Center: High-Contrast Dynamic SVG Icon Artwork */}
      <div className="my-1.5 sm:my-2 relative z-10 transition-transform duration-300 group-hover:scale-110">
        {renderSymbolIcon(symbol.id, { className: 'w-16 h-16 sm:w-20 sm:h-20 drop-shadow-2xl' })}
      </div>

      {/* Bottom Labels: Prominent Khmer Name & English Subtitle */}
      <div className="text-center z-10 w-full mb-1">
        <div className="text-2xl sm:text-3xl font-bold text-stone-100 tracking-wide font-khmer drop-shadow-md">
          {symbol.khmerName}
        </div>
        <div className="text-xs sm:text-sm font-bold text-stone-300/90 tracking-wider uppercase">
          {symbol.englishName}
        </div>
        <div className="text-[10px] text-stone-400/70 truncate hidden sm:block font-khmer">
          {symbol.description}
        </div>
      </div>

      {/* Dynamic Bet Stacking Indicator Overlay & Individual Clear Action */}
      {hasBet && (
        <BetStackIndicator
          amount={betAmount}
          symbolName={localizedName}
          symbolId={symbol.id}
          phase={phase}
          disabled={disabled}
          onRemove={() => onRemoveBet(symbol.id)}
        />
      )}
    </div>
  )
}
