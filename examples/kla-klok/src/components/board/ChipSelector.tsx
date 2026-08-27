import React, { useCallback } from 'react'
import type { ChipValue } from '../../types/index.js'
import { CHIP_VALUES } from '../../constants/index.js'
import { ChipIcon } from '../../assets/icons/index.js'
import { Sparkles } from 'lucide-react'

interface ChipSelectorProps {
  selectedChip: ChipValue
  onSelectChip: (chip: ChipValue) => void
  walletBalance: number
  disabled?: boolean
  t: (key: any, params?: Record<string, string | number>) => string
}

export const ChipSelector: React.FC<ChipSelectorProps> = ({
  selectedChip,
  onSelectChip,
  walletBalance,
  disabled = false,
  t,
}) => {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentValue: ChipValue) => {
      if (disabled) return
      const currentIndex = CHIP_VALUES.indexOf(currentValue)
      if (currentIndex === -1) return

      let nextIndex = currentIndex
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIndex = (currentIndex + 1) % CHIP_VALUES.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIndex = (currentIndex - 1 + CHIP_VALUES.length) % CHIP_VALUES.length
      }

      if (nextIndex !== currentIndex) {
        const nextVal = CHIP_VALUES[nextIndex]
        onSelectChip(nextVal)
        if (typeof document !== 'undefined') {
          const btn = document.querySelector<HTMLButtonElement>(`[data-testid="chip-button-${nextVal}"]`)
          btn?.focus()
        }
      }
    },
    [disabled, onSelectChip],
  )

  return (
    <div
      className="w-full bg-stone-900/80 border border-stone-800 rounded-3xl p-3 sm:p-4 shadow-xl backdrop-blur-sm"
      data-testid="chip-selector"
    >
      {/* Header bar: Title and active chip value indicator */}
      <div className="text-xs uppercase tracking-wider text-stone-400 font-semibold mb-2.5 flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 font-khmer">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-stone-200">{t('wallet.chips')}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-stone-400 hidden sm:inline font-khmer">
            {t('bet.place_bet')}
          </span>
          <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono">
            ${selectedChip} / tap
          </span>
        </div>
      </div>

      {/* Chip Denominations Selector Row with ARIA radiogroup */}
      <div
        className="flex items-center justify-center flex-wrap gap-2.5 sm:gap-4 py-1"
        role="radiogroup"
        aria-label={t('wallet.chips')}
      >
        {CHIP_VALUES.map((val) => {
          const canAfford = walletBalance >= val
          const isSelected = selectedChip === val

          return (
            <div
              key={val}
              className="flex flex-col items-center"
              onKeyDown={(e) => handleKeyDown(e, val)}
            >
              <ChipIcon
                value={val}
                size={54}
                isSelected={isSelected}
                onClick={() => onSelectChip(val)}
                disabled={disabled || !canAfford}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
export default ChipSelector
