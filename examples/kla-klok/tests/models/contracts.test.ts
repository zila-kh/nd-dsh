import { describe, it, expect } from 'vitest'
import {
  SYMBOL_IDS,
  SYMBOLS_MAP,
  SYMBOLS_LIST,
  EMPTY_BET_MAP,
  CHIP_VALUES,
  CHIP_CONFIGS,
  GAME_CONFIG,
  TRANSLATIONS,
} from '../../src/constants'
import { calculateRoundSettlement } from '../../src/core/payout'
import type {
  Bet,
  BetMap,
  DiceTuple,
  DiceOutcome,
  RoundSettlement,
  WalletState,
  GameState,
} from '../../src/types'

describe('Kla-Klok TypeScript Models and Architecture Contracts', () => {
  it('defines and exposes exactly the 6 traditional Khmer symbols', () => {
    expect(SYMBOL_IDS).toEqual(['tiger', 'gourd', 'shrimp', 'fish', 'crab', 'rooster'])
    expect(SYMBOLS_LIST).toHaveLength(6)

    for (const symId of SYMBOL_IDS) {
      const sym = SYMBOLS_MAP[symId]
      expect(sym).toBeDefined()
      expect(sym.id).toBe(symId)
      expect(sym.khmerName).toBeTruthy()
      expect(sym.englishName).toBeTruthy()
      expect(sym.ipa).toBeTruthy()
      expect(sym.colorPalette).toBeDefined()
    }
  })

  it('verifies Bet and BetMap state representations', () => {
    const bet: Bet = {
      symbolId: 'tiger',
      amount: 100,
      timestamp: Date.now(),
    }
    expect(bet.amount).toBe(100)
    expect(bet.symbolId).toBe('tiger')

    const emptyBets: BetMap = EMPTY_BET_MAP
    expect(Object.keys(emptyBets)).toHaveLength(6)
    expect(emptyBets.tiger).toBe(0)
    expect(emptyBets.gourd).toBe(0)
  })

  it('verifies DiceOutcome and RoundSettlement structures', () => {
    const dice: DiceTuple = ['tiger', 'tiger', 'fish']
    const outcome: DiceOutcome = {
      dice,
      counts: { tiger: 2, fish: 1, gourd: 0, shrimp: 0, crab: 0, rooster: 0 },
      timestamp: Date.now(),
    }
    expect(outcome.dice).toHaveLength(3)
    expect(outcome.counts.tiger).toBe(2)

    const settlement: RoundSettlement = calculateRoundSettlement(
      1,
      { ...EMPTY_BET_MAP, tiger: 100 },
      dice,
    )
    expect(settlement.totalReturn).toBe(300)
    expect(settlement.grossPayout).toBe(300)
    expect(settlement.profit).toBe(200)
    expect(settlement.lostStakes).toBe(0)
    expect(settlement.wonStakes).toBe(100)
    expect(settlement.highestMultiplier).toBe(2)
  })

  it('verifies WalletState and GameState contracts', () => {
    const wallet: WalletState = {
      balance: 1000,
      startingBalance: 1000,
      totalWagered: 200,
      totalWon: 300,
      totalLost: 0,
      netEarnings: 100,
    }
    expect(wallet.balance).toBe(1000)

    const gameState: GameState = {
      phase: 'betting',
      roundNumber: 1,
      currentBets: EMPTY_BET_MAP,
      selectedChip: 25,
      lastBets: null,
      lastOutcome: null,
      lastSettlement: null,
      wallet,
      history: [],
      soundEnabled: true,
      language: 'km',
      highContrast: false,
      announcement: null,
    }
    expect(gameState.phase).toBe('betting')
    expect(gameState.selectedChip).toBe(25)
    expect(gameState.highContrast).toBe(false)
  })

  it('verifies chip values and configs', () => {
    expect(CHIP_VALUES).toEqual([1, 5, 10, 25, 50, 100, 500, 1000])
    for (const val of CHIP_VALUES) {
      const config = CHIP_CONFIGS[val]
      expect(config.value).toBe(val)
      expect(config.label).toBe(`$${val}`)
      expect(config.color).toBeDefined()
    }
  })

  it('verifies bilingual dictionaries (Khmer and English)', () => {
    expect(TRANSLATIONS.km).toBeDefined()
    expect(TRANSLATIONS.en).toBeDefined()

    expect(TRANSLATIONS.km['app.title']).toBe('ខ្លាឃ្លោក')
    expect(TRANSLATIONS.en['app.title']).toBe('Kla-Klok')
    expect(TRANSLATIONS.km['symbol.tiger']).toBe('ខ្លា')
    expect(TRANSLATIONS.en['symbol.tiger']).toBe('Tiger')
  })

  it('verifies game configuration defaults', () => {
    expect(GAME_CONFIG.INITIAL_WALLET_BALANCE).toBe(1000)
    expect(GAME_CONFIG.MIN_BET).toBe(1)
    expect(GAME_CONFIG.MAX_BET_PER_SYMBOL).toBe(1000)
  })
})
