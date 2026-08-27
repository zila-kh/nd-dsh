import type { SymbolId } from './symbol'
import type { BetMap } from './bet'

export interface DieResult {
  dieIndex: number // 0, 1, 2
  symbol: SymbolId
  rotation?: {
    x: number
    y: number
    z: number
  }
}

export type DiceTuple = [SymbolId, SymbolId, SymbolId]

export interface DiceOutcome {
  dice: DiceTuple
  counts: Record<SymbolId, number>
  timestamp: number
}

export type PayoutMatchStatus = 'loss' | 'single' | 'double' | 'triple'

export interface SymbolPayoutResult {
  symbolId: SymbolId
  stake: number
  matchCount: number // 0, 1, 2, 3
  payoutMultiplier: number // 0, 1, 2, 3
  payoutReturn: number // Total money returned (stake + net profit if win, 0 if loss)
  grossPayout: number // Total money returned (alias for payoutReturn)
  netProfit: number // Profit or loss (-stake for 0 matches, stake * matchCount for matches)
  profit: number // Profit or loss (alias for netProfit)
  lostStake: number // Stake forfeited (stake if matchCount === 0, else 0)
  wonStake: number // Stake won on (stake if matchCount > 0, else 0)
  status: PayoutMatchStatus
}

export interface RoundSettlement {
  roundNumber: number
  bets: BetMap
  dice: DiceTuple
  totalStake: number
  totalReturn: number // Total gross payout returned to player
  grossPayout: number // Total gross payout returned to player (alias for totalReturn)
  netProfit: number // Total return - total stake
  profit: number // Total net profit (alias for netProfit)
  lostStakes: number // Sum of stakes on losing symbols
  wonStakes: number // Sum of stakes on winning symbols
  breakdown: Record<SymbolId, SymbolPayoutResult>
  isWin: boolean // Whether gross payout > 0
  isNetProfit: boolean // Whether net profit > 0
  hasTriple: boolean // Whether any symbol appeared 3 times on the dice
  highestMultiplier: number
  winningSymbols: SymbolId[]
  timestamp: number
}

export interface BalanceSettlementResult {
  previousBalance: number
  totalStake: number
  grossPayout: number
  profit: number
  lostStakes: number
  wonStakes: number
  newBalance: number
  settlement: RoundSettlement
}
