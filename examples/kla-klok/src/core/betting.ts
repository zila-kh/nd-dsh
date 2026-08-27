import type { SymbolId, BetMap, BetPlacementValidation } from '../types/index.js'
import { GAME_CONFIG } from '../constants/index.js'

/**
 * Calculates total active wager amount across all symbols.
 */
export function calculateTotalBet(bets: BetMap): number {
  return Object.values(bets).reduce((sum, amount) => sum + (amount || 0), 0)
}

/**
 * Checks if a player has enough balance to place an additional bet.
 */
export function canAffordBet(currentWalletBalance: number, amount: number): boolean {
  return currentWalletBalance >= amount && amount > 0
}

/**
 * Validates whether a bet of given amount can be placed on a symbol.
 */
export function validateBetPlacement(
  currentBets: BetMap,
  symbolId: SymbolId,
  amount: number,
  walletBalance: number,
): BetPlacementValidation {
  if (amount <= 0) {
    return {
      isValid: false,
      errorKey: 'bet.min',
      errorMessage: 'Bet amount must be greater than 0',
    }
  }

  if (walletBalance < amount) {
    return {
      isValid: false,
      errorKey: 'aria.insufficient_funds',
      errorMessage: 'Insufficient balance to place bet',
    }
  }

  const currentSymbolBet = currentBets[symbolId] || 0
  if (currentSymbolBet + amount > GAME_CONFIG.MAX_BET_PER_SYMBOL) {
    return {
      isValid: false,
      errorKey: 'aria.max_bet_exceeded',
      errorMessage: `Maximum bet limit of $${GAME_CONFIG.MAX_BET_PER_SYMBOL} exceeded on ${symbolId}`,
    }
  }

  const currentTotal = calculateTotalBet(currentBets)
  if (currentTotal + amount > GAME_CONFIG.MAX_TOTAL_BET) {
    return {
      isValid: false,
      errorKey: 'bet.max',
      errorMessage: `Total maximum bet limit of $${GAME_CONFIG.MAX_TOTAL_BET} exceeded`,
    }
  }

  return { isValid: true }
}

/**
 * Returns a new BetMap with the added bet amount.
 */
export function placeBet(bets: BetMap, symbolId: SymbolId, amount: number): BetMap {
  return {
    ...bets,
    [symbolId]: (bets[symbolId] || 0) + amount,
  }
}

/**
 * Removes bet amount or clears bet on a symbol.
 */
export function removeBet(bets: BetMap, symbolId: SymbolId, amount?: number): BetMap {
  if (amount === undefined || amount >= (bets[symbolId] || 0)) {
    return {
      ...bets,
      [symbolId]: 0,
    }
  }

  return {
    ...bets,
    [symbolId]: Math.max(0, (bets[symbolId] || 0) - amount),
  }
}

/**
 * Doubles all active bets if wallet balance permits.
 */
export function doubleBets(
  bets: BetMap,
  walletBalance: number,
): { newBets: BetMap; totalCost: number } | null {
  const currentTotal = calculateTotalBet(bets)
  if (currentTotal === 0 || walletBalance < currentTotal) {
    return null
  }

  const newBets: BetMap = { ...bets }
  for (const [symbol, amount] of Object.entries(bets)) {
    const sym = symbol as SymbolId
    if (amount > 0) {
      if (amount * 2 > GAME_CONFIG.MAX_BET_PER_SYMBOL) {
        return null // Exceeds symbol limit
      }
      newBets[sym] = amount * 2
    }
  }

  if (currentTotal * 2 > GAME_CONFIG.MAX_TOTAL_BET) {
    return null
  }

  return {
    newBets,
    totalCost: currentTotal,
  }
}

/**
 * Checks if there are any active bets placed.
 */
export function hasActiveBets(bets: BetMap): boolean {
  return calculateTotalBet(bets) > 0
}
