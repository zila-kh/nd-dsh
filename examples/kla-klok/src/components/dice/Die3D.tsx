import React, { useState, useEffect, useRef } from 'react'
import type { SymbolId, GamePhase, Language } from '../../types/index.js'
import { SYMBOLS_MAP, SYMBOL_IDS } from '../../constants/index.js'
import { renderSymbolIcon } from '../../assets/icons/index.js'
import { Sparkles, Check } from 'lucide-react'

interface Die3DProps {
  symbol?: SymbolId | null
  isRolling?: boolean
  index: number
  phase?: GamePhase
  isWinning?: boolean
  matchCount?: number
  language?: Language
}

export const Die3D: React.FC<Die3DProps> = ({
  symbol = 'tiger',
  isRolling = false,
  index,
  phase = 'betting',
  isWinning = false,
  matchCount = 0,
  language = 'km',
}) => {
  const targetSymbol = symbol || 'tiger'
  const [displaySymbol, setDisplaySymbol] = useState<SymbolId>(targetSymbol)
  const isCurrentlyRolling = isRolling || phase === 'rolling' || phase === 'revealing'
  const isSettled = phase === 'settled'
  const cycleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Rapidly cycle symbols during active rolling/revealing animation to give tumbling realism
  useEffect(() => {
    if (isCurrentlyRolling) {
      let step = (index * 2) % SYMBOL_IDS.length
      cycleIntervalRef.current = setInterval(() => {
        step = (step + 1) % SYMBOL_IDS.length
        setDisplaySymbol(SYMBOL_IDS[step])
      }, 70 + index * 15)
    } else {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current)
        cycleIntervalRef.current = null
      }
      setDisplaySymbol(targetSymbol)
    }

    return () => {
      if (cycleIntervalRef.current) {
        clearInterval(cycleIntervalRef.current)
      }
    }
  }, [isCurrentlyRolling, targetSymbol, index])

  const symbolInfo = SYMBOLS_MAP[displaySymbol] || SYMBOLS_MAP.tiger
  const tumbleClass =
    index === 0 ? 'animate-tumble-0' : index === 1 ? 'animate-tumble-1' : 'animate-tumble-2'

  return (
    <div className="flex flex-col items-center justify-center relative perspective-1000">
      {/* 3D Die Cube Face Container */}
      <div
        className={`relative w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-3xl p-2.5 sm:p-3 flex flex-col items-center justify-between transition-all duration-300 select-none ${
          isCurrentlyRolling
            ? tumbleClass
            : isSettled && isWinning
              ? 'animate-win-glow bg-gradient-to-br from-amber-950/90 via-stone-900/90 to-amber-900/90 border-2 border-amber-400 shadow-2xl'
              : 'animate-die-settle bg-gradient-to-br from-stone-850 via-stone-900 to-stone-950 border-2 border-stone-700/80 shadow-2xl hover:scale-105'
        }`}
        data-testid={`die-item-${index}`}
        data-symbol={displaySymbol}
        aria-label={`Die ${index + 1}: ${symbolInfo.englishName} (${symbolInfo.khmerName})`}
      >
        {/* Subtle 3D Top Inner Gloss Sheen */}
        <div className="absolute inset-x-2 top-1.5 h-3 rounded-t-2xl bg-gradient-to-b from-white/15 to-transparent pointer-events-none" />

        {/* 4 Corner Brass Rivets / Pips */}
        <div
          className={`absolute top-2 left-2 w-1.5 h-1.5 rounded-full ${
            isWinning && isSettled ? 'bg-amber-400 shadow-[0_0_4px_#F59E0B]' : 'bg-stone-500/40'
          }`}
        />
        <div
          className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full ${
            isWinning && isSettled ? 'bg-amber-400 shadow-[0_0_4px_#F59E0B]' : 'bg-stone-500/40'
          }`}
        />
        <div
          className={`absolute bottom-2 left-2 w-1.5 h-1.5 rounded-full ${
            isWinning && isSettled ? 'bg-amber-400 shadow-[0_0_4px_#F59E0B]' : 'bg-stone-500/40'
          }`}
        />
        <div
          className={`absolute bottom-2 right-2 w-1.5 h-1.5 rounded-full ${
            isWinning && isSettled ? 'bg-amber-400 shadow-[0_0_4px_#F59E0B]' : 'bg-stone-500/40'
          }`}
        />

        {/* Winning Indicator Ribbon / Badge on Top */}
        {isSettled && isWinning && (
          <div
            className="absolute -top-3 px-2 py-0.5 rounded-full bg-amber-500 text-stone-950 font-bold text-[10px] sm:text-xs shadow-lg border border-amber-300 flex items-center gap-1 animate-bounce"
            data-testid={`die-win-badge-${index}`}
          >
            {matchCount >= 2 ? (
              <Sparkles className="w-3 h-3 fill-current" />
            ) : (
              <Check className="w-3 h-3 stroke-[3]" />
            )}
            <span>{language === 'km' ? 'ត្រូវ' : 'MATCH'}</span>
          </div>
        )}

        {/* Symbol Vector Icon */}
        <div className="w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center flex-1 transition-transform">
          {renderSymbolIcon(displaySymbol, {
            className: `w-full h-full drop-shadow-lg transition-transform ${
              isWinning && isSettled ? 'scale-110' : ''
            }`,
          })}
        </div>

        {/* Khmer and English Symbol Names */}
        <div className="text-center w-full mt-0.5">
          <span
            className={`block text-xs sm:text-sm font-bold font-khmer leading-none ${
              isWinning && isSettled ? 'text-amber-300' : 'text-stone-200'
            }`}
          >
            {symbolInfo.khmerName}
          </span>
          <span className="block text-[9px] sm:text-[10px] text-stone-400 font-medium leading-tight">
            {symbolInfo.englishName}
          </span>
        </div>
      </div>

      {/* Ground Contact Shadow under the die */}
      <div
        className={`w-16 sm:w-20 h-3 rounded-full bg-black/60 blur-[3px] mt-2 transition-all duration-300 ${
          isCurrentlyRolling ? 'animate-shadow-bounce' : 'scale-100 opacity-60'
        }`}
      />
    </div>
  )
}
export default Die3D
