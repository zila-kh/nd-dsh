import { describe, it, expect } from 'vitest'
import {
  calculateTotalBet,
  canAffordBet,
  validateBetPlacement,
  placeBet,
  removeBet,
  doubleBets,
  hasActiveBets,
} from '../../src/core/betting'
import { EMPTY_BET_MAP } from '../../src/constants'
import type { BetMap } from '../../src/types'

describe('Betting Validation & Calculations', () => {
  it('calculates total bet correctly', () => {
    const bets: BetMap = {
      ...EMPTY_BET_MAP,
      tiger: 10,
      fish: 25,
      crab: 50,
    }
    expect(calculateTotalBet(bets)).toBe(85)
  })

  it('determines if player can afford a bet', () => {
    expect(canAffordBet(100, 50)).toBe(true)
    expect(canAffordBet(50, 100)).toBe(false)
    expect(canAffordBet(50, 0)).toBe(false)
    expect(canAffordBet(50, -10)).toBe(false)
  })

  it('validates bet placement within balance and limits', () => {
    const bets = { ...EMPTY_BET_MAP }
    // Valid bet
    expect(validateBetPlacement(bets, 'tiger', 25, 100).isValid).toBe(true)

    // Insufficient funds
    const failFunds = validateBetPlacement(bets, 'tiger', 150, 100)
    expect(failFunds.isValid).toBe(false)
    expect(failFunds.errorKey).toBe('aria.insufficient_funds')

    // Zero or negative
    expect(validateBetPlacement(bets, 'tiger', 0, 100).isValid).toBe(false)

    // Exceeds max per symbol ($1000)
    const betsWith990: BetMap = { ...EMPTY_BET_MAP, tiger: 990 }
    const failSymbolMax = validateBetPlacement(betsWith990, 'tiger', 25, 2000)
    expect(failSymbolMax.isValid).toBe(false)
    expect(failSymbolMax.errorKey).toBe('aria.max_bet_exceeded')
  })

  it('adds and removes bets from the bet map', () => {
    let bets = { ...EMPTY_BET_MAP }
    bets = placeBet(bets, 'tiger', 25)
    bets = placeBet(bets, 'tiger', 25)
    expect(bets.tiger).toBe(50)

    bets = removeBet(bets, 'tiger', 20)
    expect(bets.tiger).toBe(30)

    bets = removeBet(bets, 'tiger') // clears completely
    expect(bets.tiger).toBe(0)
  })

  it('doubles active bets when balance allows', () => {
    const bets: BetMap = {
      ...EMPTY_BET_MAP,
      tiger: 25,
      fish: 50,
    }
    const result = doubleBets(bets, 200)
    expect(result).not.toBeNull()
    expect(result?.totalCost).toBe(75)
    expect(result?.newBets.tiger).toBe(50)
    expect(result?.newBets.fish).toBe(100)

    // Fails when balance is less than current bet
    const failResult = doubleBets(bets, 50)
    expect(failResult).toBeNull()
  })

  it('detects active bets', () => {
    expect(hasActiveBets(EMPTY_BET_MAP)).toBe(false)
    expect(hasActiveBets({ ...EMPTY_BET_MAP, rooster: 10 })).toBe(true)
  })
})
