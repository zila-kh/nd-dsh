import type { ChipValue, ChipConfig } from '../types/index.js'

export const CHIP_VALUES: readonly ChipValue[] = [1, 5, 10, 25, 50, 100, 500, 1000] as const

export const CHIP_CONFIGS: Record<ChipValue, ChipConfig> = {
  1: {
    value: 1,
    label: '$1',
    color: {
      bg: 'bg-stone-100',
      border: 'border-stone-400',
      text: 'text-stone-900',
      accent: 'bg-stone-300',
      glow: 'shadow-stone-200/50',
    },
  },
  5: {
    value: 5,
    label: '$5',
    color: {
      bg: 'bg-red-600',
      border: 'border-red-400',
      text: 'text-white',
      accent: 'bg-red-700',
      glow: 'shadow-red-500/50',
    },
  },
  10: {
    value: 10,
    label: '$10',
    color: {
      bg: 'bg-blue-600',
      border: 'border-blue-400',
      text: 'text-white',
      accent: 'bg-blue-700',
      glow: 'shadow-blue-500/50',
    },
  },
  25: {
    value: 25,
    label: '$25',
    color: {
      bg: 'bg-emerald-600',
      border: 'border-emerald-400',
      text: 'text-white',
      accent: 'bg-emerald-700',
      glow: 'shadow-emerald-500/50',
    },
  },
  50: {
    value: 50,
    label: '$50',
    color: {
      bg: 'bg-purple-600',
      border: 'border-purple-400',
      text: 'text-white',
      accent: 'bg-purple-700',
      glow: 'shadow-purple-500/50',
    },
  },
  100: {
    value: 100,
    label: '$100',
    color: {
      bg: 'bg-stone-900',
      border: 'border-amber-400',
      text: 'text-amber-400',
      accent: 'bg-stone-800',
      glow: 'shadow-amber-400/50',
    },
  },
  500: {
    value: 500,
    label: '$500',
    color: {
      bg: 'bg-amber-600',
      border: 'border-amber-300',
      text: 'text-stone-950 font-black',
      accent: 'bg-amber-700',
      glow: 'shadow-amber-500/50',
    },
  },
  1000: {
    value: 1000,
    label: '$1000',
    color: {
      bg: 'bg-gradient-to-r from-amber-400 to-yellow-300',
      border: 'border-amber-200',
      text: 'text-stone-950 font-black',
      accent: 'bg-yellow-500',
      glow: 'shadow-yellow-400/70',
    },
  },
}

/**
 * Decomposes a total bet amount into an optimal array of chip denominations using a greedy algorithm.
 */
export function getChipStackBreakdown(amount: number): ChipValue[] {
  if (amount <= 0 || !Number.isFinite(amount)) return []
  const availableChips: ChipValue[] = [1000, 500, 100, 50, 25, 10, 5, 1]
  const stack: ChipValue[] = []
  let remaining = Math.floor(amount)

  for (const chip of availableChips) {
    while (remaining >= chip) {
      stack.push(chip)
      remaining -= chip
    }
  }
  return stack
}

/**
 * Returns a capped list of chips for visual 3D stacking (up to maxVisualChips).
 */
export function getVisualChipStack(
  amount: number,
  maxVisualChips: number = 5,
): {
  visibleChips: ChipValue[]
  totalChipsCount: number
} {
  const allChips = getChipStackBreakdown(amount)
  const totalChipsCount = allChips.length
  const visibleChips = allChips.slice(0, maxVisualChips)
  return {
    visibleChips,
    totalChipsCount,
  }
}
