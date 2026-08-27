import { describe, it, expect } from 'vitest'
import {
  calculateSymbolPayout,
  calculateRoundSettlement,
  calculatePayout,
  settleBets,
  calculateNetBalanceChange,
  getSymbolMatchCount,
  getMultiplierBadge,
} from '../../src/core/payout'
import type { BetMap, DiceTuple, SymbolId } from '../../src/types'
import { EMPTY_BET_MAP, SYMBOL_IDS } from '../../src/constants'

describe('Kla-Klok Bet Settlement & Payout Engine', () => {
  describe('getSymbolMatchCount', () => {
    it('accurately counts symbol occurrences in 3 dice', () => {
      const dice: DiceTuple = ['tiger', 'tiger', 'fish']
      expect(getSymbolMatchCount(dice, 'tiger')).toBe(2)
      expect(getSymbolMatchCount(dice, 'fish')).toBe(1)
      expect(getSymbolMatchCount(dice, 'gourd')).toBe(0)
      expect(getSymbolMatchCount(dice, 'crab')).toBe(0)
      expect(getSymbolMatchCount(dice, 'shrimp')).toBe(0)
      expect(getSymbolMatchCount(dice, 'rooster')).toBe(0)
    })

    it('counts triple matches (3:1)', () => {
      const dice: DiceTuple = ['crab', 'crab', 'crab']
      expect(getSymbolMatchCount(dice, 'crab')).toBe(3)
      expect(getSymbolMatchCount(dice, 'tiger')).toBe(0)
    })
  })

  describe('Full Symbol × Match Count Multiplier Matrix (100% Symbol Coverage)', () => {
    // Verify each of the 6 symbols across all 4 match states: 0 matches (loss), 1 match (single 1:1), 2 matches (double 2:1), 3 matches (triple 3:1)
    const stakesToTest = [10, 25, 50, 100, 250, 500]

    SYMBOL_IDS.forEach((symbolId: SymbolId, idx: number) => {
      const stake = stakesToTest[idx % stakesToTest.length]

      describe(`Symbol: ${symbolId} (Stake $${stake})`, () => {
        it(`0 Matches (Loss): $${stake} wagered -> 0 gross return, -$${stake} net profit, forfeited stake`, () => {
          const result = calculateSymbolPayout(symbolId, stake, 0)
          expect(result.symbolId).toBe(symbolId)
          expect(result.stake).toBe(stake)
          expect(result.matchCount).toBe(0)
          expect(result.payoutMultiplier).toBe(0)
          expect(result.payoutReturn).toBe(0)
          expect(result.grossPayout).toBe(0)
          expect(result.netProfit).toBe(-stake)
          expect(result.profit).toBe(-stake)
          expect(result.lostStake).toBe(stake)
          expect(result.wonStake).toBe(0)
          expect(result.status).toBe('loss')
        })

        it(`1 Match (Single 1:1): $${stake} wagered -> $${stake * 2} gross return, +$${stake} net profit, stake returned`, () => {
          const result = calculateSymbolPayout(symbolId, stake, 1)
          expect(result.symbolId).toBe(symbolId)
          expect(result.stake).toBe(stake)
          expect(result.matchCount).toBe(1)
          expect(result.payoutMultiplier).toBe(1)
          expect(result.payoutReturn).toBe(stake * 2)
          expect(result.grossPayout).toBe(stake * 2)
          expect(result.netProfit).toBe(stake)
          expect(result.profit).toBe(stake)
          expect(result.lostStake).toBe(0)
          expect(result.wonStake).toBe(stake)
          expect(result.status).toBe('single')
        })

        it(`2 Matches (Double 2:1): $${stake} wagered -> $${stake * 3} gross return, +$${stake * 2} net profit, stake returned`, () => {
          const result = calculateSymbolPayout(symbolId, stake, 2)
          expect(result.symbolId).toBe(symbolId)
          expect(result.stake).toBe(stake)
          expect(result.matchCount).toBe(2)
          expect(result.payoutMultiplier).toBe(2)
          expect(result.payoutReturn).toBe(stake * 3)
          expect(result.grossPayout).toBe(stake * 3)
          expect(result.netProfit).toBe(stake * 2)
          expect(result.profit).toBe(stake * 2)
          expect(result.lostStake).toBe(0)
          expect(result.wonStake).toBe(stake)
          expect(result.status).toBe('double')
        })

        it(`3 Matches (Triple Jackpot 3:1): $${stake} wagered -> $${stake * 4} gross return, +$${stake * 3} net profit, stake returned`, () => {
          const result = calculateSymbolPayout(symbolId, stake, 3)
          expect(result.symbolId).toBe(symbolId)
          expect(result.stake).toBe(stake)
          expect(result.matchCount).toBe(3)
          expect(result.payoutMultiplier).toBe(3)
          expect(result.payoutReturn).toBe(stake * 4)
          expect(result.grossPayout).toBe(stake * 4)
          expect(result.netProfit).toBe(stake * 3)
          expect(result.profit).toBe(stake * 3)
          expect(result.lostStake).toBe(0)
          expect(result.wonStake).toBe(stake)
          expect(result.status).toBe('triple')
        })
      })
    })

    it('handles $0 bet cleanly with correct status classification', () => {
      const res0 = calculateSymbolPayout('gourd', 0, 0)
      expect(res0.stake).toBe(0)
      expect(res0.grossPayout).toBe(0)
      expect(res0.netProfit).toBe(0)
      expect(res0.status).toBe('loss')

      const res1 = calculateSymbolPayout('gourd', 0, 1)
      expect(res1.stake).toBe(0)
      expect(res1.grossPayout).toBe(0)
      expect(res1.status).toBe('single')

      const res2 = calculateSymbolPayout('gourd', 0, 2)
      expect(res2.stake).toBe(0)
      expect(res2.grossPayout).toBe(0)
      expect(res2.status).toBe('double')

      const res3 = calculateSymbolPayout('gourd', 0, 3)
      expect(res3.stake).toBe(0)
      expect(res3.grossPayout).toBe(0)
      expect(res3.status).toBe('triple')
    })

    it('handles negative, fractional cents, and non-finite stakes safely', () => {
      const resNeg = calculateSymbolPayout('shrimp', -50, 1)
      expect(resNeg.stake).toBe(0)
      expect(resNeg.grossPayout).toBe(0)
      expect(resNeg.netProfit).toBe(0)

      const resNaN = calculateSymbolPayout('fish', NaN, 2)
      expect(resNaN.stake).toBe(0)
      expect(resNaN.grossPayout).toBe(0)

      const resInf = calculateSymbolPayout('crab', Infinity, 3)
      expect(resInf.stake).toBe(0)
      expect(resInf.grossPayout).toBe(0)

      // Cents precision
      const resCents = calculateSymbolPayout('tiger', 25.556, 1)
      expect(resCents.stake).toBe(25.55)
      expect(resCents.grossPayout).toBe(51.1)
      expect(resCents.netProfit).toBe(25.55)
    })
  })

  describe('Complex Multi-Symbol Betting & Settlement Combinations', () => {
    it('Edge Case: No bets placed (empty BetMap)', () => {
      const bets: BetMap = { ...EMPTY_BET_MAP }
      const dice: DiceTuple = ['tiger', 'gourd', 'fish']
      const settlement = calculateRoundSettlement(1, bets, dice)

      expect(settlement.totalStake).toBe(0)
      expect(settlement.totalReturn).toBe(0)
      expect(settlement.grossPayout).toBe(0)
      expect(settlement.netProfit).toBe(0)
      expect(settlement.profit).toBe(0)
      expect(settlement.lostStakes).toBe(0)
      expect(settlement.wonStakes).toBe(0)
      expect(settlement.isWin).toBe(false)
      expect(settlement.isNetProfit).toBe(false)
      expect(settlement.hasTriple).toBe(false)
    })

    it('Specification Worked Example: Tiger $100, Gourd $50, Crab $50 with roll [Tiger, Tiger, Fish]', () => {
      // Scenario from docs:
      // Player bets: Tiger $100, Gourd $50, Crab $50 (Total stake $200)
      // Roll: [Tiger, Tiger, Fish]
      // Outcome:
      // Tiger (2 matches) -> Gross Payout $300 (Profit $200, Lost Stake $0, Won Stake $100)
      // Gourd (0 matches) -> Gross Payout $0 (Profit -$50, Lost Stake $50, Won Stake $0)
      // Crab (0 matches) -> Gross Payout $0 (Profit -$50, Lost Stake $50, Won Stake $0)
      // Total Gross Payout: $300
      // Total Lost Stakes: $100
      // Total Won Stakes: $100
      // Net Profit: $300 - $200 = +$100
      const bets: BetMap = {
        ...EMPTY_BET_MAP,
        tiger: 100,
        gourd: 50,
        crab: 50,
      }
      const dice: DiceTuple = ['tiger', 'tiger', 'fish']

      const settlement = calculatePayout(bets, dice, 1)

      expect(settlement.totalStake).toBe(200)
      expect(settlement.totalReturn).toBe(300)
      expect(settlement.grossPayout).toBe(300)
      expect(settlement.netProfit).toBe(100)
      expect(settlement.profit).toBe(100)
      expect(settlement.lostStakes).toBe(100)
      expect(settlement.wonStakes).toBe(100)
      expect(settlement.isWin).toBe(true)
      expect(settlement.isNetProfit).toBe(true)
      expect(settlement.hasTriple).toBe(false)
      expect(settlement.highestMultiplier).toBe(2)

      expect(settlement.breakdown.tiger.grossPayout).toBe(300)
      expect(settlement.breakdown.tiger.profit).toBe(200)
      expect(settlement.breakdown.tiger.lostStake).toBe(0)
      expect(settlement.breakdown.tiger.wonStake).toBe(100)

      expect(settlement.breakdown.gourd.grossPayout).toBe(0)
      expect(settlement.breakdown.gourd.profit).toBe(-50)
      expect(settlement.breakdown.gourd.lostStake).toBe(50)
      expect(settlement.breakdown.gourd.wonStake).toBe(0)

      expect(settlement.breakdown.crab.grossPayout).toBe(0)
      expect(settlement.breakdown.crab.profit).toBe(-50)
      expect(settlement.breakdown.crab.lostStake).toBe(50)
      expect(settlement.breakdown.crab.wonStake).toBe(0)

      expect(settlement.breakdown.fish.grossPayout).toBe(0) // No bet placed on fish
    })

    it('Multi-bet: 6-symbol full board spread with mixed outcomes', () => {
      // Wager on all 6 symbols with distinct amounts:
      // Tiger: $10, Gourd: $20, Shrimp: $30, Fish: $40, Crab: $50, Rooster: $60 (Total Stake $210)
      // Roll: [Fish, Crab, Crab] -> Fish (1 match), Crab (2 matches), Tiger/Gourd/Shrimp/Rooster (0 matches)
      const bets: BetMap = {
        tiger: 10,
        gourd: 20,
        shrimp: 30,
        fish: 40,
        crab: 50,
        rooster: 60,
      }
      const dice: DiceTuple = ['fish', 'crab', 'crab']
      const settlement = calculateRoundSettlement(10, bets, dice)

      expect(settlement.totalStake).toBe(210)
      // Fish: 1 match -> $40 * 2 = $80 return ($40 profit)
      // Crab: 2 matches -> $50 * 3 = $150 return ($100 profit)
      // Losses: Tiger $10 + Gourd $20 + Shrimp $30 + Rooster $60 = $120 lost stakes
      // Total Return: $80 + $150 = $230
      // Net Profit: $230 - $210 = +$20
      expect(settlement.grossPayout).toBe(230)
      expect(settlement.netProfit).toBe(20)
      expect(settlement.lostStakes).toBe(120)
      expect(settlement.wonStakes).toBe(90) // 40 + 50
      expect(settlement.isWin).toBe(true)
      expect(settlement.isNetProfit).toBe(true)
      expect(settlement.highestMultiplier).toBe(2)
      expect(settlement.winningSymbols).toEqual(['fish', 'crab'])
    })

    it('Multi-bet: 6-symbol full board spread with triple jackpot on Rooster', () => {
      // Wager on all 6 symbols:
      // Tiger: $50, Gourd: $50, Shrimp: $50, Fish: $50, Crab: $50, Rooster: $50 (Total Stake $300)
      // Roll: [Rooster, Rooster, Rooster] (Triple Jackpot)
      // Rooster: 3 matches -> $50 * 4 = $200 return ($150 profit)
      // Other 5 symbols: 0 matches -> $250 lost stakes
      // Total Return: $200
      // Net Profit: $200 - $300 = -$100 (Overall loss despite jackpot due to over-hedging)
      const bets: BetMap = {
        tiger: 50,
        gourd: 50,
        shrimp: 50,
        fish: 50,
        crab: 50,
        rooster: 50,
      }
      const dice: DiceTuple = ['rooster', 'rooster', 'rooster']
      const settlement = settleBets(bets, dice, 11)

      expect(settlement.totalStake).toBe(300)
      expect(settlement.grossPayout).toBe(200)
      expect(settlement.profit).toBe(-100)
      expect(settlement.lostStakes).toBe(250)
      expect(settlement.wonStakes).toBe(50)
      expect(settlement.isWin).toBe(true) // totalReturn > 0
      expect(settlement.isNetProfit).toBe(false) // net loss
      expect(settlement.hasTriple).toBe(true)
      expect(settlement.highestMultiplier).toBe(3)
      expect(settlement.winningSymbols).toEqual(['rooster'])
    })

    it('Multi-bet: 3-way distinct win across 3 active bets (1:1 each)', () => {
      // Player bets: Tiger $50, Gourd $50, Shrimp $50 (Total stake $150)
      // Roll: [Tiger, Gourd, Shrimp] -> 3 distinct matches (1 each)
      // Tiger: $50 * 2 = $100
      // Gourd: $50 * 2 = $100
      // Shrimp: $50 * 2 = $100
      // Total Return: $300, Net Profit: +$150, Lost Stakes: $0
      const bets: BetMap = {
        ...EMPTY_BET_MAP,
        tiger: 50,
        gourd: 50,
        shrimp: 50,
      }
      const dice: DiceTuple = ['tiger', 'gourd', 'shrimp']
      const settlement = calculateRoundSettlement(12, bets, dice)

      expect(settlement.totalStake).toBe(150)
      expect(settlement.grossPayout).toBe(300)
      expect(settlement.profit).toBe(150)
      expect(settlement.lostStakes).toBe(0)
      expect(settlement.wonStakes).toBe(150)
      expect(settlement.isWin).toBe(true)
      expect(settlement.isNetProfit).toBe(true)
      expect(settlement.highestMultiplier).toBe(1)
      expect(settlement.winningSymbols).toEqual(['tiger', 'gourd', 'shrimp'])
    })

    it('Multi-bet: Break-even round (Gross Payout equals Total Stake)', () => {
      // Player bets: Tiger $100, Fish $100 (Total stake $200)
      // Roll: [Tiger, Gourd, Crab] -> Tiger (1 match), Fish (0 matches)
      // Tiger: $100 * 2 = $200 return
      // Fish: $0 return, $100 lost stake
      // Total Return: $200, Net Profit: $0
      const bets: BetMap = {
        ...EMPTY_BET_MAP,
        tiger: 100,
        fish: 100,
      }
      const dice: DiceTuple = ['tiger', 'gourd', 'crab']
      const settlement = calculateRoundSettlement(13, bets, dice)

      expect(settlement.totalStake).toBe(200)
      expect(settlement.grossPayout).toBe(200)
      expect(settlement.profit).toBe(0)
      expect(settlement.netProfit).toBe(0)
      expect(settlement.lostStakes).toBe(100)
      expect(settlement.wonStakes).toBe(100)
      expect(settlement.isWin).toBe(true)
      expect(settlement.isNetProfit).toBe(false)
    })

    it('Complete loss when all placed bets miss', () => {
      const bets: BetMap = {
        ...EMPTY_BET_MAP,
        tiger: 50,
        gourd: 50,
      }
      const dice: DiceTuple = ['fish', 'crab', 'rooster']
      const settlement = settleBets(bets, dice, 14)

      expect(settlement.totalStake).toBe(100)
      expect(settlement.grossPayout).toBe(0)
      expect(settlement.profit).toBe(-100)
      expect(settlement.lostStakes).toBe(100)
      expect(settlement.wonStakes).toBe(0)
      expect(settlement.isWin).toBe(false)
      expect(settlement.isNetProfit).toBe(false)
      expect(settlement.winningSymbols).toEqual(['fish', 'crab', 'rooster'])
    })
  })

  describe('Wallet Credit/Debit Balance Simulation Across Complex Game Rounds', () => {
    it('accurately tracks sequential wallet balances over 5 distinct multi-bet rounds', () => {
      let walletBalance = 1000 // Starting balance

      // Round 1: Place $200 total (Tiger $100, Gourd $50, Crab $50) -> Roll: [Tiger, Tiger, Fish] (Double on Tiger)
      // Net Profit: +$100. New balance = 1000 + 100 = 1100
      const round1Bets: BetMap = { ...EMPTY_BET_MAP, tiger: 100, gourd: 50, crab: 50 }
      const round1Res = calculateNetBalanceChange(walletBalance, round1Bets, ['tiger', 'tiger', 'fish'], 1)
      expect(round1Res.previousBalance).toBe(1000)
      expect(round1Res.totalStake).toBe(200)
      expect(round1Res.grossPayout).toBe(300)
      expect(round1Res.profit).toBe(100)
      expect(round1Res.newBalance).toBe(1100)
      walletBalance = round1Res.newBalance

      // Round 2: Place $300 total (Shrimp $100, Rooster $200) -> Roll: [Crab, Fish, Gourd] (Complete Loss)
      // Net Profit: -$300. New balance = 1100 - 300 = 800
      const round2Bets: BetMap = { ...EMPTY_BET_MAP, shrimp: 100, rooster: 200 }
      const round2Res = calculateNetBalanceChange(walletBalance, round2Bets, ['crab', 'fish', 'gourd'], 2)
      expect(round2Res.previousBalance).toBe(1100)
      expect(round2Res.totalStake).toBe(300)
      expect(round2Res.grossPayout).toBe(0)
      expect(round2Res.profit).toBe(-300)
      expect(round2Res.newBalance).toBe(800)
      walletBalance = round2Res.newBalance

      // Round 3: Place $250 on Gourd -> Roll: [Gourd, Gourd, Gourd] (Triple Jackpot!)
      // Gross Payout: $250 * 4 = $1000. Profit: +$750. New balance = 800 + 750 = 1550
      const round3Bets: BetMap = { ...EMPTY_BET_MAP, gourd: 250 }
      const round3Res = calculateNetBalanceChange(walletBalance, round3Bets, ['gourd', 'gourd', 'gourd'], 3)
      expect(round3Res.previousBalance).toBe(800)
      expect(round3Res.totalStake).toBe(250)
      expect(round3Res.grossPayout).toBe(1000)
      expect(round3Res.profit).toBe(750)
      expect(round3Res.newBalance).toBe(1550)
      walletBalance = round3Res.newBalance

      // Round 4: Place $500 total (Fish $250, Crab $250) -> Roll: [Fish, Tiger, Rooster] (1 match on Fish)
      // Fish return = $250 * 2 = $500, Crab return = $0. Total return = $500. Profit = $0 (Break-even).
      // New balance = 1550 + 0 = 1550
      const round4Bets: BetMap = { ...EMPTY_BET_MAP, fish: 250, crab: 250 }
      const round4Res = calculateNetBalanceChange(walletBalance, round4Bets, ['fish', 'tiger', 'rooster'], 4)
      expect(round4Res.previousBalance).toBe(1550)
      expect(round4Res.totalStake).toBe(500)
      expect(round4Res.grossPayout).toBe(500)
      expect(round4Res.profit).toBe(0)
      expect(round4Res.newBalance).toBe(1550)
      walletBalance = round4Res.newBalance

      // Round 5: Go all-in $1550 on Tiger -> Roll: [Tiger, Tiger, Tiger] (Triple Jackpot All-in)
      // Gross Payout: $1550 * 4 = $6200. Profit: +$4650. New balance = 1550 + 4650 = 6200
      const round5Bets: BetMap = { ...EMPTY_BET_MAP, tiger: 1550 }
      const round5Res = calculateNetBalanceChange(walletBalance, round5Bets, ['tiger', 'tiger', 'tiger'], 5)
      expect(round5Res.previousBalance).toBe(1550)
      expect(round5Res.totalStake).toBe(1550)
      expect(round5Res.grossPayout).toBe(6200)
      expect(round5Res.profit).toBe(4650)
      expect(round5Res.newBalance).toBe(6200)
    })

    it('verifies exact balance consistency between pre-deduction and settlement credit', () => {
      const startingWallet = 500
      const bets: BetMap = {
        ...EMPTY_BET_MAP,
        shrimp: 100,
        fish: 50,
      }
      const totalWager = 150
      // When bet is placed, wallet balance temporarily debited
      const inFlightBalance = startingWallet - totalWager // 350

      // Roll: [Shrimp, Shrimp, Rooster] -> Shrimp 2 matches ($100 * 3 = $300 return), Fish 0 matches ($0 return)
      const settlement = calculateRoundSettlement(1, bets, ['shrimp', 'shrimp', 'rooster'])
      expect(settlement.grossPayout).toBe(300)
      expect(settlement.profit).toBe(150)

      // Post-round credited balance: inFlightBalance + grossPayout
      const endBalanceFromInFlight = inFlightBalance + settlement.grossPayout
      expect(endBalanceFromInFlight).toBe(650)

      // calculateNetBalanceChange starting from startingWallet
      const directBalanceResult = calculateNetBalanceChange(startingWallet, bets, ['shrimp', 'shrimp', 'rooster'])
      expect(directBalanceResult.newBalance).toBe(650)
      expect(directBalanceResult.newBalance).toBe(endBalanceFromInFlight)
    })
  })

  describe('getMultiplierBadge', () => {
    it('returns formatted string for English and Khmer', () => {
      expect(getMultiplierBadge(1, 'en')).toBe('1x (1:1)')
      expect(getMultiplierBadge(2, 'en')).toBe('2x (2:1)')
      expect(getMultiplierBadge(3, 'en')).toBe('3x (3:1)')
      expect(getMultiplierBadge(0, 'en')).toBe('')

      expect(getMultiplierBadge(1, 'km')).toBe('ត្រូវ ១ (សង ១:១)')
      expect(getMultiplierBadge(2, 'km')).toBe('ត្រូវ ២ (សង ២:១)')
      expect(getMultiplierBadge(3, 'km')).toBe('ត្រូវ ៣ (សង ៣:១)')
      expect(getMultiplierBadge(0, 'km')).toBe('')
    })
  })
})
