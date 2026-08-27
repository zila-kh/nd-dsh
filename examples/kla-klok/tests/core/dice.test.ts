import { describe, it, expect } from 'vitest'
import {
  countSymbolOccurrences,
  calculateSymbolFrequencies,
  rollSingleDie,
  rollDice,
  createDiceOutcome,
  getSecureRandomInt,
  createSeededRng,
  isTripleMatch,
  isDoubleMatch,
  getWinningSymbols,
} from '../../src/core/dice'
import { SYMBOL_IDS } from '../../src/constants'
import type { DiceTuple } from '../../src/types'

describe('Dice Logic & Rolling Engine', () => {
  describe('Cryptographically Secure & Robust PRNG', () => {
    it('generates secure random integers in the valid range [0, 6)', () => {
      for (let i = 0; i < 100; i++) {
        const val = getSecureRandomInt(6)
        expect(val).toBeGreaterThanOrEqual(0)
        expect(val).toBeLessThan(6)
        expect(Number.isInteger(val)).toBe(true)
      }
    })

    it('supports deterministic seeded RNG generation via Mulberry32', () => {
      const rng1 = createSeededRng(12345)
      const rng2 = createSeededRng(12345)

      const seq1 = [rng1(), rng1(), rng1(), rng1()]
      const seq2 = [rng2(), rng2(), rng2(), rng2()]

      expect(seq1).toEqual(seq2)
    })

    it('rolls deterministic dice using custom seeded RNG', () => {
      const rng = createSeededRng(42)
      const dice1 = rollDice(rng)
      const dice2 = rollDice(rng)

      expect(dice1).toHaveLength(3)
      expect(dice2).toHaveLength(3)
      for (const d of [...dice1, ...dice2]) {
        expect(SYMBOL_IDS).toContain(d)
      }
    })

    it('shows unbiased distribution across many rolls', () => {
      const iterations = 6000
      const counts: Record<string, number> = {
        tiger: 0,
        gourd: 0,
        shrimp: 0,
        fish: 0,
        crab: 0,
        rooster: 0,
      }

      for (let i = 0; i < iterations; i++) {
        const sym = rollSingleDie()
        counts[sym]++
      }

      // Expected ~1000 each (1/6 = ~16.67%). Tolerable range [750, 1250] for 6000 iterations.
      for (const sym of SYMBOL_IDS) {
        expect(counts[sym]).toBeGreaterThan(750)
        expect(counts[sym]).toBeLessThan(1250)
      }
    })
  })

  describe('Symbol Frequency & Analysis', () => {
    it('rolls a valid single symbol from the 6 symbols', () => {
      for (let i = 0; i < 30; i++) {
        const sym = rollSingleDie()
        expect(SYMBOL_IDS).toContain(sym)
      }
    })

    it('rolls a 3-dice tuple with valid symbols', () => {
      const dice = rollDice()
      expect(dice).toHaveLength(3)
      expect(SYMBOL_IDS).toContain(dice[0])
      expect(SYMBOL_IDS).toContain(dice[1])
      expect(SYMBOL_IDS).toContain(dice[2])
    })

    it('correctly counts symbol occurrences and frequencies', () => {
      const counts = countSymbolOccurrences(['tiger', 'tiger', 'crab'])
      expect(counts.tiger).toBe(2)
      expect(counts.crab).toBe(1)
      expect(counts.fish).toBe(0)
      expect(counts.gourd).toBe(0)
      expect(counts.shrimp).toBe(0)
      expect(counts.rooster).toBe(0)

      const freq = calculateSymbolFrequencies(['gourd', 'gourd', 'gourd'])
      expect(freq.gourd).toBe(3)
      expect(freq.tiger).toBe(0)
    })

    it('detects triple jackpot matches', () => {
      expect(isTripleMatch(['crab', 'crab', 'crab'])).toBe(true)
      expect(isTripleMatch(['tiger', 'tiger', 'tiger'])).toBe(true)
      expect(isTripleMatch(['tiger', 'tiger', 'fish'])).toBe(false)
      expect(isTripleMatch(['fish', 'crab', 'rooster'])).toBe(false)
    })

    it('detects double matches', () => {
      expect(isDoubleMatch(['tiger', 'tiger', 'fish'])).toBe(true)
      expect(isDoubleMatch(['tiger', 'fish', 'tiger'])).toBe(true)
      expect(isDoubleMatch(['fish', 'tiger', 'tiger'])).toBe(true)
      expect(isDoubleMatch(['tiger', 'tiger', 'tiger'])).toBe(true)
      expect(isDoubleMatch(['fish', 'crab', 'rooster'])).toBe(false)
    })

    it('returns unique winning symbols on dice', () => {
      const diceTriple: DiceTuple = ['tiger', 'tiger', 'tiger']
      expect(getWinningSymbols(diceTriple)).toEqual(['tiger'])

      const diceDouble: DiceTuple = ['tiger', 'fish', 'tiger']
      expect(getWinningSymbols(diceDouble)).toEqual(['tiger', 'fish'])

      const diceDistinct: DiceTuple = ['crab', 'gourd', 'shrimp']
      expect(getWinningSymbols(diceDistinct)).toEqual(['crab', 'gourd', 'shrimp'])
    })

    it('creates a complete DiceOutcome object', () => {
      const outcome = createDiceOutcome(['shrimp', 'fish', 'rooster'])
      expect(outcome.dice).toEqual(['shrimp', 'fish', 'rooster'])
      expect(outcome.counts.shrimp).toBe(1)
      expect(outcome.counts.fish).toBe(1)
      expect(outcome.counts.rooster).toBe(1)
      expect(typeof outcome.timestamp).toBe('number')
    })
  })
})
