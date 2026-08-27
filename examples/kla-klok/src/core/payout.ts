import type {
  SymbolId,
  BetMap,
  DiceTuple,
  SymbolPayoutResult,
  RoundSettlement,
  BalanceSettlementResult,
  PayoutMatchStatus,
  Language,
} from '../types/index.js'
import { SYMBOL_IDS } from '../constants/index.js'
import { countSymbolOccurrences, isTripleMatch } from './dice.js'

/**
 * Counts how many times a given symbol appears among the 3 dice.
 */
export function getSymbolMatchCount(dice: DiceTuple, symbolId: SymbolId): number {
  let count = 0
  for (const die of dice) {
    if (die === symbolId) {
      count++
    }
  }
  return count
}

/**
 * Calculates the payout for a single symbol bet given its match count.
 * Traditional Khmer Kla-Klok Rules:
 * - Match 0: Loss, Gross Payout = $0, Profit = -stake, Lost Stake = stake, Won Stake = 0
 * - Match 1: 1:1, Gross Payout = stake * (1 + 1) = 2x stake, Profit = +1x stake, Lost Stake = 0, Won Stake = stake
 * - Match 2: 2:1, Gross Payout = stake * (2 + 1) = 3x stake, Profit = +2x stake, Lost Stake = 0, Won Stake = stake
 * - Match 3: 3:1, Gross Payout = stake * (3 + 1) = 4x stake, Profit = +3x stake, Lost Stake = 0, Won Stake = stake
 *
 * @param symbolId The symbol identifier
 * @param stake Amount wagered on this symbol (sanitized to non-negative number)
 * @param matchCount Number of dice showing this symbol (0, 1, 2, or 3)
 */
export function calculateSymbolPayout(
  symbolId: SymbolId,
  stake: number,
  matchCount: number,
): SymbolPayoutResult {
  const safeStake = Number.isFinite(stake) && stake > 0 ? Math.floor(stake * 100) / 100 : 0
  const safeMatchCount = Math.max(0, Math.min(3, Math.floor(matchCount || 0)))

  if (safeStake <= 0) {
    return {
      symbolId,
      stake: 0,
      matchCount: safeMatchCount,
      payoutMultiplier: safeMatchCount,
      payoutReturn: 0,
      grossPayout: 0,
      netProfit: 0,
      profit: 0,
      lostStake: 0,
      wonStake: 0,
      status:
        safeMatchCount === 0
          ? 'loss'
          : safeMatchCount === 1
            ? 'single'
            : safeMatchCount === 2
              ? 'double'
              : 'triple',
    }
  }

  let status: PayoutMatchStatus = 'loss'
  let payoutMultiplier = 0
  let payoutReturn = 0
  let netProfit = -safeStake
  let lostStake = safeStake
  let wonStake = 0

  if (safeMatchCount === 1) {
    status = 'single'
    payoutMultiplier = 1
    payoutReturn = safeStake * 2 // stake returned + 1x stake profit
    netProfit = safeStake * 1
    lostStake = 0
    wonStake = safeStake
  } else if (safeMatchCount === 2) {
    status = 'double'
    payoutMultiplier = 2
    payoutReturn = safeStake * 3 // stake returned + 2x stake profit
    netProfit = safeStake * 2
    lostStake = 0
    wonStake = safeStake
  } else if (safeMatchCount === 3) {
    status = 'triple'
    payoutMultiplier = 3
    payoutReturn = safeStake * 4 // stake returned + 3x stake profit
    netProfit = safeStake * 3
    lostStake = 0
    wonStake = safeStake
  } else {
    status = 'loss'
    payoutMultiplier = 0
    payoutReturn = 0
    netProfit = -safeStake
    lostStake = safeStake
    wonStake = 0
  }

  return {
    symbolId,
    stake: safeStake,
    matchCount: safeMatchCount,
    payoutMultiplier,
    payoutReturn,
    grossPayout: payoutReturn,
    netProfit,
    profit: netProfit,
    lostStake,
    wonStake,
    status,
  }
}

/**
 * Deterministic calculation function taking placed bets and 3 dice outcomes
 * to compute full settlement including gross payout, net profit, and lost stakes.
 *
 * @param roundNumber The sequential round number (defaults to 1)
 * @param bets Map of symbolId to stake amount placed
 * @param dice Tuple of 3 rolled symbols [die0, die1, die2]
 * @param timestamp Optional timestamp of settlement (defaults to Date.now())
 */
export function calculateRoundSettlement(
  roundNumber: number = 1,
  bets: BetMap,
  dice: DiceTuple,
  timestamp: number = Date.now(),
): RoundSettlement {
  const counts = countSymbolOccurrences(dice)
  let totalStake = 0
  let totalReturn = 0
  let lostStakes = 0
  let wonStakes = 0
  let highestMultiplier = 0
  const breakdown = {} as Record<SymbolId, SymbolPayoutResult>
  const winningSymbols: SymbolId[] = []

  for (const symbolId of SYMBOL_IDS) {
    const rawStake = bets ? bets[symbolId] : 0
    const stake = Number.isFinite(rawStake) && rawStake > 0 ? rawStake : 0
    const matchCount = counts[symbolId] || 0
    totalStake += stake

    if (matchCount > 0) {
      winningSymbols.push(symbolId)
      if (matchCount > highestMultiplier) {
        highestMultiplier = matchCount
      }
    }

    const result = calculateSymbolPayout(symbolId, stake, matchCount)
    breakdown[symbolId] = result
    totalReturn += result.payoutReturn
    lostStakes += result.lostStake
    wonStakes += result.wonStake
  }

  // Round currency to 2 decimal places to avoid floating point issues
  totalStake = Math.round(totalStake * 100) / 100
  totalReturn = Math.round(totalReturn * 100) / 100
  lostStakes = Math.round(lostStakes * 100) / 100
  wonStakes = Math.round(wonStakes * 100) / 100

  const netProfit = Math.round((totalReturn - totalStake) * 100) / 100
  const isWin = totalReturn > 0
  const isNetProfit = netProfit > 0
  const hasTriple = isTripleMatch(dice)

  return {
    roundNumber,
    bets: { ...bets },
    dice,
    totalStake,
    totalReturn,
    grossPayout: totalReturn,
    netProfit,
    profit: netProfit,
    lostStakes,
    wonStakes,
    breakdown,
    isWin,
    isNetProfit,
    hasTriple,
    highestMultiplier,
    winningSymbols,
    timestamp,
  }
}

/**
 * Pure deterministic calculation function taking placed bets and 3 dice outcomes.
 * Alias for `calculateRoundSettlement` with flexible parameter signatures.
 */
export function calculatePayout(
  bets: BetMap,
  dice: DiceTuple,
  roundNumber: number = 1,
  timestamp: number = Date.now(),
): RoundSettlement {
  return calculateRoundSettlement(roundNumber, bets, dice, timestamp)
}

/**
 * Settle bets for a round. Convenience pure function returning the complete RoundSettlement.
 */
export function settleBets(
  bets: BetMap,
  dice: DiceTuple,
  roundNumber: number = 1,
  timestamp: number = Date.now(),
): RoundSettlement {
  return calculateRoundSettlement(roundNumber, bets, dice, timestamp)
}

/**
 * Pure calculation function that computes the exact net balance changes,
 * wallet transitions, gross payout, profit, and lost stakes from a dice roll.
 *
 * @param currentBalance Current wallet balance before round settlement
 * @param bets Placed bets map
 * @param dice 3-dice roll outcome
 * @param roundNumber Round identifier
 */
export function calculateNetBalanceChange(
  currentBalance: number,
  bets: BetMap,
  dice: DiceTuple,
  roundNumber: number = 1,
): BalanceSettlementResult {
  const settlement = calculateRoundSettlement(roundNumber, bets, dice)
  // If bets were already deducted from wallet at placement time:
  // newBalance = currentBalance + settlement.grossPayout
  // If computing from pre-bet balance:
  // newBalance = currentBalance - settlement.totalStake + settlement.grossPayout = currentBalance + settlement.profit
  const newBalance = Math.round((currentBalance - settlement.totalStake + settlement.grossPayout) * 100) / 100

  return {
    previousBalance: currentBalance,
    totalStake: settlement.totalStake,
    grossPayout: settlement.grossPayout,
    profit: settlement.profit,
    lostStakes: settlement.lostStakes,
    wonStakes: settlement.wonStakes,
    newBalance,
    settlement,
  }
}

/**
 * Formats a multiplier label for UI badges.
 */
export function getMultiplierBadge(multiplier: number, lang: Language = 'en'): string {
  if (multiplier === 3) {
    return lang === 'km' ? 'ត្រូវ ៣ (សង ៣:១)' : '3x (3:1)'
  }
  if (multiplier === 2) {
    return lang === 'km' ? 'ត្រូវ ២ (សង ២:១)' : '2x (2:1)'
  }
  if (multiplier === 1) {
    return lang === 'km' ? 'ត្រូវ ១ (សង ១:១)' : '1x (1:1)'
  }
  return ''
}
