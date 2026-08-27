import type { SymbolId } from './symbol'

export interface Bet {
  symbolId: SymbolId
  amount: number
  timestamp?: number
}

/**
 * Mapping of each symbol to its active wager amount (0 if no bet placed)
 */
export type BetMap = Record<SymbolId, number>

export interface BetPlacementValidation {
  isValid: boolean
  errorKey?: string
  errorMessage?: string
}
