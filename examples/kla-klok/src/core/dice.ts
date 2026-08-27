import type { SymbolId, DiceTuple, DiceOutcome } from '../types/index.js'
import { SYMBOL_IDS } from '../constants/index.js'

/**
 * Creates a deterministic, fast, 32-bit pseudo-random number generator (Mulberry32).
 * Returns a function that produces floating point values in [0, 1) upon each invocation.
 * Ideal for unit testing, reproducible simulations, and game replay verification.
 */
export function createSeededRng(seed: number): () => number {
  let s = Math.floor(seed) >>> 0
  return function seededRng(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Generates an unbiased random integer in [0, maxExclusive) using cryptographically secure
 * random values (`crypto.getRandomValues`) with rejection sampling to eliminate modulo bias.
 * If a custom RNG function is supplied, it is used instead (for testing/seeded sequences).
 * Falls back to Math.random() in legacy environments without Web Crypto API.
 *
 * @param maxExclusive Upper bound (exclusive), e.g. 6 for Kla-Klok dice.
 * @param customRng Optional custom or seeded RNG returning [0, 1).
 */
export function getSecureRandomInt(maxExclusive: number, customRng?: () => number): number {
  if (maxExclusive <= 1) return 0

  if (typeof customRng === 'function') {
    const raw = customRng()
    const clamped = Math.max(0, Math.min(0.9999999999999999, raw))
    return Math.floor(clamped * maxExclusive) % maxExclusive
  }

  // Use Web Crypto API when available in browser / Node.js
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const range = maxExclusive
    const maxUint32 = 0xffffffff
    // Rejection threshold: only accept values < (maxUint32 - (maxUint32 % range))
    // to guarantee perfectly uniform probability distribution across all residues.
    const limit = maxUint32 - (maxUint32 % range)
    const uint32Array = new Uint32Array(1)
    let value: number
    do {
      cryptoObj.getRandomValues(uint32Array)
      value = uint32Array[0]
    } while (value >= limit)
    return value % range
  }

  // Graceful fallback for environments lacking Web Crypto
  return Math.floor(Math.random() * maxExclusive)
}

/**
 * Rolls a single die and returns one of the 6 traditional Khmer symbols.
 * Uses cryptographically secure / unbiased PRNG by default, or an optional custom RNG.
 */
export function rollSingleDie(customRng?: () => number): SymbolId {
  const index = getSecureRandomInt(SYMBOL_IDS.length, customRng)
  return SYMBOL_IDS[index]
}

/**
 * Rolls 3 unbiased dice for a Kla-Klok round.
 * Returns a tuple of 3 SymbolIds: [SymbolId, SymbolId, SymbolId].
 */
export function rollDice(customRng?: () => number): DiceTuple {
  return [rollSingleDie(customRng), rollSingleDie(customRng), rollSingleDie(customRng)]
}

/**
 * Counts symbol occurrences in a 3-dice roll.
 * Returns a mapping of all 6 symbols to their frequency (0, 1, 2, or 3).
 */
export function countSymbolOccurrences(dice: DiceTuple): Record<SymbolId, number> {
  const counts: Record<SymbolId, number> = {
    tiger: 0,
    gourd: 0,
    shrimp: 0,
    fish: 0,
    crab: 0,
    rooster: 0,
  }

  for (const die of dice) {
    if (counts[die] !== undefined) {
      counts[die]++
    }
  }

  return counts
}

/**
 * Alias for `countSymbolOccurrences` to calculate symbol frequencies.
 */
export const calculateSymbolFrequencies = countSymbolOccurrences

/**
 * Checks if a 3-dice roll is a triple (jackpot) where all 3 dice show the exact same symbol.
 */
export function isTripleMatch(dice: DiceTuple): boolean {
  return dice[0] === dice[1] && dice[1] === dice[2]
}

/**
 * Checks if a 3-dice roll contains at least two matching dice (double or triple).
 */
export function isDoubleMatch(dice: DiceTuple): boolean {
  return dice[0] === dice[1] || dice[1] === dice[2] || dice[0] === dice[2]
}

/**
 * Returns the unique winning symbols present on the 3 dice.
 */
export function getWinningSymbols(dice: DiceTuple): SymbolId[] {
  const seen = new Set<SymbolId>()
  for (const die of dice) {
    seen.add(die)
  }
  return Array.from(seen)
}

/**
 * Creates a DiceOutcome object from an explicit roll or generates a new unbiased roll.
 */
export function createDiceOutcome(
  dice?: DiceTuple,
  timestamp: number = Date.now(),
  customRng?: () => number,
): DiceOutcome {
  const finalDice = dice || rollDice(customRng)
  const counts = countSymbolOccurrences(finalDice)
  return {
    dice: finalDice,
    counts,
    timestamp,
  }
}
