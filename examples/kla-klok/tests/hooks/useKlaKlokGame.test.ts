import { describe, it, expect, beforeEach } from 'vitest'
import {
  calculateTotalBet,
  validateBetPlacement,
  placeBet as addBetToMap,
  doubleBets as doubleBetsUtil,
  hasActiveBets,
} from '../../src/core/betting'
import { createDiceOutcome } from '../../src/core/dice'
import { calculateRoundSettlement } from '../../src/core/payout'
import { EMPTY_BET_MAP } from '../../src/constants'
import type { GameState, GameAction } from '../../src/types'

function gameReducerTest(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SELECT_CHIP':
      return { ...state, selectedChip: action.chip }
    case 'PLACE_BET': {
      if (state.phase !== 'betting') return state
      const validation = validateBetPlacement(
        state.currentBets,
        action.symbolId,
        action.amount,
        state.wallet.balance,
      )
      if (!validation.isValid) return state
      const updatedBets = addBetToMap(state.currentBets, action.symbolId, action.amount)
      return {
        ...state,
        currentBets: updatedBets,
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance - action.amount,
        },
      }
    }
    case 'CLEAR_BETS': {
      if (state.phase !== 'betting') return state
      const totalRefund = calculateTotalBet(state.currentBets)
      return {
        ...state,
        currentBets: { ...EMPTY_BET_MAP },
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance + totalRefund,
        },
      }
    }
    case 'DOUBLE_BETS': {
      if (state.phase !== 'betting') return state
      const result = doubleBetsUtil(state.currentBets, state.wallet.balance)
      if (!result) return state
      return {
        ...state,
        currentBets: result.newBets,
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance - result.totalCost,
        },
      }
    }
    case 'START_ROLL': {
      if (state.phase !== 'betting' || !hasActiveBets(state.currentBets)) return state
      return { ...state, phase: 'rolling' }
    }
    case 'REVEAL_DICE': {
      return { ...state, phase: 'revealing', lastOutcome: action.outcome }
    }
    case 'SETTLE_ROUND': {
      if (!state.lastOutcome) return state
      const settlement = calculateRoundSettlement(
        state.roundNumber,
        state.currentBets,
        state.lastOutcome.dice,
      )
      return {
        ...state,
        phase: 'settled',
        lastBets: { ...state.currentBets },
        lastSettlement: settlement,
        wallet: {
          ...state.wallet,
          balance: state.wallet.balance + settlement.totalReturn,
          netEarnings: state.wallet.netEarnings + settlement.netProfit,
        },
        history: [settlement, ...state.history],
      }
    }
    case 'NEXT_ROUND': {
      return {
        ...state,
        phase: 'betting',
        roundNumber: state.roundNumber + 1,
        currentBets: { ...EMPTY_BET_MAP },
      }
    }
    case 'SET_LANGUAGE': {
      return {
        ...state,
        language: action.language,
      }
    }
    case 'TOGGLE_HIGH_CONTRAST': {
      return {
        ...state,
        highContrast: !state.highContrast,
      }
    }
    default:
      return state
  }
}

describe('GameState Reducer Architecture', () => {
  let initialState: GameState

  beforeEach(() => {
    initialState = {
      phase: 'betting',
      roundNumber: 1,
      currentBets: { ...EMPTY_BET_MAP },
      selectedChip: 10,
      lastBets: null,
      lastOutcome: null,
      lastSettlement: null,
      wallet: {
        balance: 1000,
        startingBalance: 1000,
        totalWagered: 0,
        totalWon: 0,
        totalLost: 0,
        netEarnings: 0,
      },
      history: [],
      soundEnabled: true,
      language: 'km',
      highContrast: false,
      announcement: null,
    }
  })

  it('updates selected chip denomination', () => {
    const s1 = gameReducerTest(initialState, { type: 'SELECT_CHIP', chip: 50 })
    expect(s1.selectedChip).toBe(50)
  })

  it('places a valid bet and updates balance', () => {
    const s1 = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 50 })
    expect(s1.currentBets.tiger).toBe(50)
    expect(s1.wallet.balance).toBe(950)
  })

  it('rejects bets with insufficient balance', () => {
    const s1 = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 1500 })
    expect(s1.currentBets.tiger).toBe(0)
    expect(s1.wallet.balance).toBe(1000)
  })

  it('clears bets and restores wallet balance', () => {
    let s = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 50 })
    s = gameReducerTest(s, { type: 'PLACE_BET', symbolId: 'fish', amount: 25 })
    expect(s.wallet.balance).toBe(925)

    s = gameReducerTest(s, { type: 'CLEAR_BETS' })
    expect(s.wallet.balance).toBe(1000)
    expect(s.currentBets.tiger).toBe(0)
    expect(s.currentBets.fish).toBe(0)
  })

  it('doubles active bets when balance allows', () => {
    let s = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 50 })
    s = gameReducerTest(s, { type: 'DOUBLE_BETS' })
    expect(s.currentBets.tiger).toBe(100)
    expect(s.wallet.balance).toBe(900)
  })

  it('preserves active bets and wallet state on language toggle and high contrast change', () => {
    let s = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 100 })
    expect(s.currentBets.tiger).toBe(100)
    expect(s.wallet.balance).toBe(900)

    // Switch language to English
    s = gameReducerTest(s, { type: 'SET_LANGUAGE', language: 'en' })
    expect(s.language).toBe('en')
    expect(s.currentBets.tiger).toBe(100)
    expect(s.wallet.balance).toBe(900)
    expect(s.roundNumber).toBe(1)
    expect(s.selectedChip).toBe(10)

    // Toggle high contrast
    s = gameReducerTest(s, { type: 'TOGGLE_HIGH_CONTRAST' })
    expect(s.highContrast).toBe(true)
    expect(s.currentBets.tiger).toBe(100)
    expect(s.wallet.balance).toBe(900)

    // Toggle high contrast off
    s = gameReducerTest(s, { type: 'TOGGLE_HIGH_CONTRAST' })
    expect(s.highContrast).toBe(false)

    // Switch language back to Khmer
    s = gameReducerTest(s, { type: 'SET_LANGUAGE', language: 'km' })
    expect(s.language).toBe('km')
    expect(s.currentBets.tiger).toBe(100)
    expect(s.wallet.balance).toBe(900)
  })

  it('executes the full game lifecycle: betting -> rolling -> revealing -> settled', () => {
    let s = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 100 })
    s = gameReducerTest(s, { type: 'START_ROLL' })
    expect(s.phase).toBe('rolling')

    const outcome = createDiceOutcome(['tiger', 'tiger', 'fish'])
    s = gameReducerTest(s, { type: 'REVEAL_DICE', outcome })
    expect(s.phase).toBe('revealing')
    expect(s.lastOutcome?.dice).toEqual(['tiger', 'tiger', 'fish'])

    s = gameReducerTest(s, { type: 'SETTLE_ROUND' })
    expect(s.phase).toBe('settled')
    expect(s.wallet.balance).toBe(1200) // $900 remaining + $300 return
    expect(s.wallet.netEarnings).toBe(200)
    expect(s.history).toHaveLength(1)

    s = gameReducerTest(s, { type: 'NEXT_ROUND' })
    expect(s.phase).toBe('betting')
    expect(s.roundNumber).toBe(2)
    expect(s.currentBets.tiger).toBe(0)
  })

  it('generates screen reader announcements for roll countdown, dice reveal, and settlement win/loss', () => {
    let s = gameReducerTest(initialState, { type: 'PLACE_BET', symbolId: 'tiger', amount: 100 })
    s = gameReducerTest(s, { type: 'START_ROLL' })
    expect(s.announcement?.message).toContain('៣, ២, ១!')
    expect(s.announcement?.politeness).toBe('polite')

    // Reveal
    const outcome = createDiceOutcome(['tiger', 'tiger', 'fish'])
    s = gameReducerTest(s, { type: 'REVEAL_DICE', outcome })
    expect(s.announcement?.message).toContain('លទ្ធផលគ្រាប់ឡុកឡាក់')
    expect(s.announcement?.message).toContain('ខ្លា')

    // Settle Win
    s = gameReducerTest(s, { type: 'SETTLE_ROUND' })
    expect(s.announcement?.message).toContain('សូមអបអរសាទរ')
    expect(s.announcement?.message).toContain('300')
    expect(s.announcement?.message).toContain('200')
  })
})
