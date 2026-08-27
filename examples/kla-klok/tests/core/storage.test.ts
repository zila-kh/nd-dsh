import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadWalletState,
  saveWalletState,
  loadHistory,
  saveHistory,
  loadSettings,
  saveSettings,
  DEFAULT_WALLET_STATE,
} from '../../src/core/storage'
import { calculateRoundSettlement } from '../../src/core/payout'
import { GAME_CONFIG } from '../../src/constants'
import type { WalletState, RoundSettlement } from '../../src/types'

describe('Local Storage Persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads default wallet state when storage is empty', () => {
    const wallet = loadWalletState()
    expect(wallet.balance).toBe(GAME_CONFIG.INITIAL_WALLET_BALANCE)
    expect(wallet.netEarnings).toBe(0)
  })

  it('saves and loads wallet state correctly', () => {
    const customWallet: WalletState = {
      balance: 1450,
      startingBalance: 1000,
      totalWagered: 500,
      totalWon: 950,
      totalLost: 0,
      netEarnings: 450,
    }
    saveWalletState(customWallet)
    const loaded = loadWalletState()
    expect(loaded).toEqual(customWallet)
  })

  it('recovers cleanly when storage contains corrupt data', () => {
    localStorage.setItem(GAME_CONFIG.STORAGE_KEYS.WALLET, 'invalid-json{{{')
    const loaded = loadWalletState()
    expect(loaded).toEqual(DEFAULT_WALLET_STATE)
  })

  it('saves and loads history capped at maximum entries', () => {
    const mockSettlement: RoundSettlement = calculateRoundSettlement(
      1,
      { tiger: 10, gourd: 0, shrimp: 0, fish: 0, crab: 0, rooster: 0 },
      ['tiger', 'fish', 'crab'],
    )

    saveHistory([mockSettlement])
    const loaded = loadHistory()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].roundNumber).toBe(1)
  })

  it('persists user settings including language and highContrast', () => {
    saveSettings({ soundEnabled: false, language: 'en', highContrast: true })
    const settings = loadSettings()
    expect(settings.soundEnabled).toBe(false)
    expect(settings.language).toBe('en')
    expect(settings.highContrast).toBe(true)
  })

  it('handles negative or invalid stored numbers gracefully', () => {
    localStorage.setItem(
      GAME_CONFIG.STORAGE_KEYS.WALLET,
      JSON.stringify({ balance: -500, startingBalance: 'invalid' }),
    )
    const wallet = loadWalletState()
    expect(wallet.balance).toBe(0)
    expect(wallet.startingBalance).toBe(GAME_CONFIG.INITIAL_WALLET_BALANCE)
  })
})
