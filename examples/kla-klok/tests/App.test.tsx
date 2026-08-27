import { describe, it, expect, beforeEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'
import { App } from '../src/App'
import { Header } from '../src/components/common/Header'
import { AriaLiveRegion } from '../src/components/common/AriaLiveRegion'
import { ShortcutsModal } from '../src/components/common/ShortcutsModal'
import { WalletBar } from '../src/components/wallet/WalletBar'
import { ChipSelector } from '../src/components/board/ChipSelector'
import { BettingBoard } from '../src/components/board/BettingBoard'
import { Die3D } from '../src/components/dice/Die3D'
import { ShakerCup } from '../src/components/dice/ShakerCup'
import { DiceArena } from '../src/components/dice/DiceArena'
import { createDiceOutcome } from '../src/core/dice'
import { EMPTY_BET_MAP } from '../src/constants'
import { km } from '../src/constants/i18n/km'
import { en } from '../src/constants/i18n/en'

describe('React Component Rendering and HTML Generation', () => {
  beforeEach(() => {
    // Clear in-memory localStorage polyfill if needed
  })

  it('renders the complete App component without throwing', () => {
    const html = renderToString(React.createElement(App))
    expect(html).toContain('ខ្លាឃ្លោក')
    expect(html).toContain('Khmer Dice')
    expect(html).toContain('data-testid="wallet-balance"')
    expect(html).toContain('data-testid="betting-board"')
  })

  it('renders Header with Khmer branding and navigation buttons', () => {
    const html = renderToString(
      React.createElement(Header, {
        language: 'km',
        onLanguageChange: () => {},
        soundEnabled: true,
        onToggleSound: () => {},
        onOpenRules: () => {},
        onOpenHistory: () => {},
        onResetGame: () => {},
        t: (k: any) => (km as any)[k] || k,
      }),
    )
    expect(html).toContain('ខ្លាឃ្លោក')
    expect(html).toContain('EN')
  })

  it('renders WalletBar with formatted balance and statistics', () => {
    const html = renderToString(
      React.createElement(WalletBar, {
        wallet: {
          balance: 1500,
          startingBalance: 1000,
          totalWagered: 500,
          totalWon: 1000,
          totalLost: 0,
          netEarnings: 500,
        },
        totalBet: 100,
        roundNumber: 5,
        t: (k: any) => (km as any)[k] || k,
      }),
    )
    expect(html).toContain('$1,500')
    expect(html).toContain('$100')
    expect(html).toContain('#5')
    expect(html).toContain('+$500')
  })

  it('renders ChipSelector with standard chip denominations ($1 to $500)', () => {
    const html = renderToString(
      React.createElement(ChipSelector, {
        selectedChip: 25,
        onSelectChip: () => {},
        walletBalance: 1000,
        t: (k: any) => (km as any)[k] || k,
      }),
    )
    expect(html).toContain('aria-label="Bet chip $1"')
    expect(html).toContain('aria-label="Bet chip $25"')
    expect(html).toContain('aria-label="Bet chip $100"')
    expect(html).toContain('aria-label="Bet chip $500"')
  })

  it('renders BettingBoard with all 6 traditional Khmer symbols', () => {
    const html = renderToString(
      React.createElement(BettingBoard, {
        currentBets: { ...EMPTY_BET_MAP, tiger: 100 },
        settlement: null,
        phase: 'betting',
        language: 'km',
        onPlaceBet: () => {},
        onRemoveBet: () => {},
      }),
    )
    expect(html).toContain('data-testid="symbol-tile-tiger"')
    expect(html).toContain('data-testid="symbol-tile-gourd"')
    expect(html).toContain('data-testid="symbol-tile-shrimp"')
    expect(html).toContain('data-testid="symbol-tile-fish"')
    expect(html).toContain('data-testid="symbol-tile-crab"')
    expect(html).toContain('data-testid="symbol-tile-rooster"')
    expect(html).toContain('$100')
  })

  it('renders 3D Die and Shaker Cup components in various states', () => {
    const dieHtml = renderToString(
      React.createElement(Die3D, { symbol: 'tiger', index: 0, phase: 'settled', isWinning: true }),
    )
    expect(dieHtml).toContain('data-testid="die-item-0"')
    expect(dieHtml).toContain('ខ្លា')
    expect(dieHtml).toContain('animate-win-glow')
    expect(dieHtml).toContain('data-testid="die-win-badge-0"')

    const shakerHtml = renderToString(React.createElement(ShakerCup, { isRolling: true }))
    expect(shakerHtml).toContain('Khmer traditional dice cup')
    expect(shakerHtml).toContain('animate-cup-shake')
    expect(shakerHtml).toContain('animate-vibration-ring')
  })

  it('renders DiceArena with shaking cup during rolling and tumbling dice during revealing', () => {
    const rollingArena = renderToString(
      React.createElement(DiceArena, {
        phase: 'rolling',
        lastOutcome: null,
        settlement: null,
        language: 'en',
        t: (k: any) => (en as any)[k] || k,
      }),
    )
    expect(rollingArena).toContain('data-testid="dice-arena"')
    expect(rollingArena).toContain('data-testid="shaker-cup"')
    expect(rollingArena).toContain('animate-cup-shake')

    const outcome = createDiceOutcome(['tiger', 'gourd', 'rooster'])
    const revealingArena = renderToString(
      React.createElement(DiceArena, {
        phase: 'revealing',
        lastOutcome: outcome,
        settlement: null,
        language: 'en',
        t: (k: any) => (en as any)[k] || k,
      }),
    )
    expect(revealingArena).toContain('data-testid="dice-arena"')
    expect(revealingArena).toContain('animate-cup-lift')
    expect(revealingArena).toContain('data-testid="die-item-0"')
    expect(revealingArena).toContain('data-testid="die-item-1"')
    expect(revealingArena).toContain('data-testid="die-item-2"')
  })

  it('renders AriaLiveRegion and live status announcements', () => {
    const politeHtml = renderToString(
      React.createElement(AriaLiveRegion, {
        announcement: {
          id: '1',
          message: 'Dice are rolling in the shaker cup... Shaking 3, 2, 1!',
          politeness: 'polite',
        },
      }),
    )
    expect(politeHtml).toContain('data-testid="aria-live-polite"')
    expect(politeHtml).toContain('Shaking 3, 2, 1!')

    const assertiveHtml = renderToString(
      React.createElement(AriaLiveRegion, {
        announcement: {
          id: '2',
          message: 'Insufficient balance',
          politeness: 'assertive',
        },
      }),
    )
    expect(assertiveHtml).toContain('data-testid="aria-live-assertive"')
    expect(assertiveHtml).toContain('Insufficient balance')
  })

  it('renders ShortcutsModal with full keyboard controls and accessibility documentation', () => {
    const shortcutsHtml = renderToString(
      React.createElement(ShortcutsModal, {
        isOpen: true,
        onClose: () => {},
        language: 'en',
        t: (k: any) => (en as any)[k] || k,
      }),
    )
    expect(shortcutsHtml).toContain('data-testid="shortcuts-modal"')
    expect(shortcutsHtml).toContain('Space / R')
    expect(shortcutsHtml).toContain('1 - 6')
    expect(shortcutsHtml).toContain('[  /  ]')
    expect(shortcutsHtml).toContain('L')
    expect(shortcutsHtml).toContain('H')
  })
})
